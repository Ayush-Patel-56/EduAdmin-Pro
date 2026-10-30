import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { istToday } from '../common/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { StudentFeedbackDto } from './public-feedback.dto.js';

/** A student can send feedback again this long after their last one. */
export const STUDENT_COOLDOWN_MS = 15 * 60_000;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const NOT_ACTIVE = "This feedback link isn't active";
const TEACHING = { not: 'INACTIVE' } as const;

/**
 * The student feedback form behind a batch's link (no login). Everything is
 * scoped by the link: its school and batch, never anything the student sends.
 * The form shows names only: no roll numbers, contacts or other students' feedback.
 */
@Injectable()
export class PublicFeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  async form(token: string) {
    const link = await this.link(token);
    const where = { schoolId: link.schoolId, batchId: link.batchId };
    const [students, teachers] = await Promise.all([
      this.prisma.student.findMany({ where: { ...where, status: 'ACTIVE' }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } }),
      this.prisma.facultyBatch.findMany({ where: { ...where, faculty: { status: TEACHING } }, select: { faculty: { select: { id: true, name: true, subjects: true } } } }),
    ]);
    return {
      schoolName: link.school.name,
      batchName: link.batch.name,
      cooldownMinutes: STUDENT_COOLDOWN_MS / 60_000,
      students: students.map((s) => ({ id: s.id, name: s.fullName })),
      teachers: teachers.map((t) => t.faculty).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /**
   * Stores one Student -> Teacher entry. The student's row is locked for the
   * transaction, so two submissions at once wait for each other and the second
   * sees the first in the cool-down check.
   */
  async submit(token: string, dto: StudentFeedbackDto, now = new Date()): Promise<{ ok: true; nextAllowedAt: string }> {
    await this.prisma.$transaction(async (tx) => {
      const link = await this.link(token, tx);
      const { schoolId, batchId } = link;
      const [student] = await tx.$queryRaw<{ id: string; fullName: string }[]>`
        SELECT "id", "fullName" FROM "Student"
        WHERE "id" = ${dto.studentId} AND "schoolId" = ${schoolId} AND "batchId" = ${batchId} AND "status" = 'ACTIVE'
        FOR UPDATE`;
      if (!student) throw new BadRequestException('Pick your name from the list');
      const teacher = await tx.facultyBatch.findFirst({
        where: { schoolId, batchId, facultyId: dto.facultyId, faculty: { status: TEACHING } },
        select: { faculty: { select: { name: true } } },
      });
      if (!teacher) throw new BadRequestException('Pick a teacher from the list');

      const last = await tx.feedback.findFirst({
        where: { schoolId, studentId: student.id, direction: 'STUDENT_TO_TEACHER' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      const remaining = last ? last.createdAt.getTime() + STUDENT_COOLDOWN_MS - now.getTime() : 0;
      if (remaining > 0) {
        const minutes = Math.ceil(remaining / 60_000);
        throw new HttpException(
          { message: `You can send feedback again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`, retryAfterSeconds: minutes * 60 },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      await tx.feedback.create({
        data: {
          schoolId,
          direction: 'STUDENT_TO_TEACHER',
          senderName: student.fullName,
          createdById: null,
          studentId: student.id,
          studentName: student.fullName,
          batchId,
          batchName: link.batch.name,
          toAllFaculty: false,
          targetFacultyId: dto.facultyId,
          targetName: teacher.faculty.name,
          rating: dto.rating,
          content: dto.comment,
          category: 'GENERAL',
          source: 'APP',
          feedbackDate: istToday(now),
          createdAt: now, // the cool-down is measured on this clock
        },
        select: { id: true },
      });
    });
    return { ok: true, nextAllowedAt: new Date(now.getTime() + STUDENT_COOLDOWN_MS).toISOString() };
  }

  /** The active link for a token; an unknown, replaced or switched-off one looks the same. */
  private async link(token: string, db: Pick<PrismaService, 'feedbackLink'> = this.prisma) {
    if (!TOKEN_SHAPE.test(token)) throw new NotFoundException(NOT_ACTIVE);
    const link = await db.feedbackLink.findUnique({
      where: { token },
      select: { schoolId: true, batchId: true, active: true, school: { select: { name: true } }, batch: { select: { name: true } } },
    });
    if (!link?.active) throw new NotFoundException(NOT_ACTIVE);
    return link;
  }
}
