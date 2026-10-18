import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { istToday, parseDate, toIsoDate } from '../common/dates.js';
import type { BatchDto } from './academic.dto.js';
import { duplicateAsConflict } from '../common/unique-violation.js';

type Tx = Prisma.TransactionClient;

/**
 * Work handed in but not graded yet, judged by what is there and not only by
 * status: a PENDING row can still carry the student's file.
 */
export const HANDED_IN_UNGRADED = {
  status: { not: 'GRADED' },
  OR: [{ status: { in: ['SUBMITTED', 'LATE'] } }, { fileId: { not: null } }],
} satisfies Prisma.AssignmentSubmissionWhereInput;

@Injectable()
export class BatchesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(schoolId: string, programId?: string) {
    const batches = await this.prisma.batch.findMany({
      where: { schoolId, ...(programId && { programId }) },
      orderBy: [{ startDate: 'desc' }, { name: 'asc' }],
      include: {
        program: { select: { id: true, name: true, themeColor: true } },
        coordinator: { select: { id: true, name: true } },
        _count: {
          select: {
            facultyBatches: true,
            syllabusItems: true,
            students: true,
            materials: true,
            assignments: true,
            calendarEvents: true,
            dailyReports: true,
          },
        },
      },
    });
    // Handed-in work not graded yet blocks the delete (see remove): the delete
    // confirmation says so up front.
    const handedIn = new Map<string, number>();
    if (batches.length > 0) {
      const assignments = await this.prisma.assignment.findMany({
        where: { schoolId, batchId: { in: batches.map((b) => b.id) } },
        select: { batchId: true, _count: { select: { submissions: { where: HANDED_IN_UNGRADED } } } },
      });
      for (const a of assignments) handedIn.set(a.batchId, (handedIn.get(a.batchId) ?? 0) + a._count.submissions);
    }
    return batches.map((b) => ({
      id: b.id,
      name: b.name,
      program: b.program,
      classLevel: b.classLevel,
      capacity: b.capacity,
      startDate: toIsoDate(b.startDate),
      endDate: toIsoDate(b.endDate),
      coordinator: b.coordinator,
      facultyCount: b._count.facultyBatches,
      chapterCount: b._count.syllabusItems,
      studentCount: b._count.students,
      materialCount: b._count.materials,
      assignmentCount: b._count.assignments,
      eventCount: b._count.calendarEvents,
      handedInCount: handedIn.get(b.id) ?? 0,
      reportCount: b._count.dailyReports,
    }));
  }

  async create(schoolId: string, dto: BatchDto) {
    const data = await this.validate(schoolId, dto);
    return duplicateAsConflict(
      () =>
        this.prisma.$transaction(async (tx) => {
          await lockProgram(tx, schoolId, data.programId);
          const batch = await tx.batch.create({ data: { schoolId, ...data } });
          if (data.coordinatorId)
            await assignFaculty(
              tx,
              schoolId,
              data.coordinatorId,
              batch.id,
              data.programId,
            );
          return { id: batch.id };
        }),
      batchClash(dto),
    );
  }

  async update(schoolId: string, batchId: string, dto: BatchDto) {
    const current = await this.find(schoolId, batchId);
    const data = await this.validate(schoolId, dto, batchId);
    return duplicateAsConflict(
      () =>
        this.prisma.$transaction(async (tx) => {
          if (data.programId !== current.programId) await lockProgram(tx, schoolId, data.programId);
          await tx.batch.update({ where: { id: batchId }, data });
          if (
            data.coordinatorId &&
            data.coordinatorId !== current.coordinatorId
          ) {
            await assignFaculty(
              tx,
              schoolId,
              data.coordinatorId,
              batchId,
              data.programId,
            );
          }
          if (data.programId !== current.programId) {
            // Teachers of a moved batch now teach in its new program as well.
            const teachers = await tx.facultyBatch.findMany({
              where: { batchId },
              select: { facultyId: true },
            });
            await tx.facultyProgram.createMany({
              data: teachers.map((t) => ({
                facultyId: t.facultyId,
                programId: data.programId,
                schoolId,
              })),
              skipDuplicates: true,
            });
            // ...and no longer in the old one unless another batch keeps them there.
            await pruneFacultyPrograms(
              tx,
              schoolId,
              current.programId,
              teachers.map((t) => t.facultyId),
            );
          }
          return { id: batchId };
        }),
      batchClash(dto),
    );
  }

  /**
   * Deleting a batch also removes its syllabus chapters, teacher assignments,
   * study material and assignments; its students stay in the program,
   * unassigned, and keep their batch history. A batch whose assignments have
   * recorded grades can't be deleted (they are records; end the batch instead).
   * The removed material's files are left to the abandoned-file cleanup.
   */
  async remove(schoolId: string, batchId: string) {
    const batch = await this.find(schoolId, batchId);
    await this.prisma.$transaction(async (tx) => {
      // The batch row first (new material or assignments for it wait), then its
      // assignments (a grade being saved finishes first), so the count is final.
      await tx.$queryRaw`SELECT 1 FROM "Batch" WHERE "id" = ${batchId} AND "schoolId" = ${schoolId} FOR UPDATE`;
      await tx.$queryRaw`SELECT 1 FROM "Assignment" WHERE "batchId" = ${batchId} AND "schoolId" = ${schoolId} FOR UPDATE`;
      const graded = await tx.assignmentSubmission.count({
        where: { schoolId, status: 'GRADED', assignment: { batchId } },
      });
      if (graded > 0) {
        throw new ConflictException(
          `${graded} grade${graded === 1 ? ' is' : 's are'} recorded in this batch's assignments. ` +
            'Set an end date for the batch instead, or have its teachers delete those assignments first.',
        );
      }
      // Work handed in but not graded yet is kept too: deleting the batch would
      // silently drop it (and its file) with the assignment. "Handed in" is by
      // what is there, not only by status: a PENDING row can still carry a file.
      const waiting = await tx.assignmentSubmission.count({
        where: { schoolId, assignment: { batchId }, ...HANDED_IN_UNGRADED },
      });
      if (waiting > 0) {
        throw new ConflictException(
          `${waiting} submission${waiting === 1 ? ' is' : 's are'} waiting to be graded in this batch's assignments. ` +
            'Set an end date for the batch instead, or have its teachers delete those assignments first.',
        );
      }
      // Fees scoped to the batch keep their dues and payments meaningful.
      const fees = await tx.feeStructure.count({ where: { schoolId, batchId } });
      if (fees > 0) {
        throw new ConflictException(
          `${fees} fee structure${fees === 1 ? ' is' : 's are'} set up for this batch. Move ${fees === 1 ? 'it' : 'them'} to another batch or program in Fee Management first.`,
        );
      }
      // Attendance is a record too, and nobody can delete it.
      const classesMarked = await tx.classOccurrence.count({ where: { schoolId, batchId } });
      if (classesMarked > 0) {
        throw new ConflictException(
          `Attendance is recorded for ${classesMarked} class${classesMarked === 1 ? '' : 'es'} of this batch. Set an end date for the batch instead.`,
        );
      }
      // So are its teachers' daily reports (a report being submitted waits on the batch lock).
      const reports = await tx.dailyReport.count({ where: { schoolId, batchId } });
      if (reports > 0) {
        throw new ConflictException(
          `${reports} daily report${reports === 1 ? ' is' : 's are'} recorded for this batch. Set an end date for the batch instead.`,
        );
      }
      // Test results too (saving results share-locks the batch, so none slip in); tests without results go with the batch.
      const results = await tx.testResult.count({ where: { schoolId, test: { batchId } } });
      if (results > 0) {
        throw new ConflictException(
          `${results} test result${results === 1 ? ' is' : 's are'} recorded for this batch. Set an end date for the batch instead.`,
        );
      }
      const teachers = await tx.facultyBatch.findMany({
        where: { batchId },
        select: { facultyId: true },
      });
      await tx.student.updateMany({
        where: { schoolId, batchId },
        data: { batchId: null },
      });
      // Their time in the batch ends today; the history keeps its name.
      await tx.studentEnrollment.updateMany({
        where: { schoolId, batchId, endedOn: null },
        data: { endedOn: istToday() },
      });
      await tx.batch.delete({ where: { id: batchId } });
      await pruneFacultyPrograms(
        tx,
        schoolId,
        batch.programId,
        teachers.map((t) => t.facultyId),
      );
    });
    return { ok: true };
  }

  private async find(schoolId: string, batchId: string) {
    const batch = await this.prisma.batch.findFirst({
      where: { id: batchId, schoolId },
    });
    if (!batch) throw new NotFoundException('Batch not found');
    return batch;
  }

  private async validate(schoolId: string, dto: BatchDto, exceptId?: string) {
    const startDate = parseDate(dto.startDate, 'Start date');
    const endDate = dto.endDate ? parseDate(dto.endDate, 'End date') : null;
    if (endDate && endDate < startDate)
      throw new BadRequestException(
        'End date must be on or after the start date',
      );

    // Both lookups are scoped to this school, so ids from another school fail here
    // (and the composite foreign keys would reject them anyway).
    const program = await this.prisma.program.findFirst({
      where: { id: dto.programId, schoolId },
      select: { id: true, name: true },
    });
    if (!program)
      throw new BadRequestException('Select a program from this school');
    if (dto.coordinatorId) {
      const coordinator = await this.prisma.faculty.findFirst({
        where: { id: dto.coordinatorId, schoolId },
        select: { id: true },
      });
      if (!coordinator)
        throw new BadRequestException(
          'Select a coordinator from this school’s faculty',
        );
    }
    const clash = await this.prisma.batch.findFirst({
      where: {
        programId: program.id,
        name: { equals: dto.name, mode: 'insensitive' },
        ...(exceptId && { id: { not: exceptId } }),
      },
      select: { id: true },
    });
    if (clash)
      throw new ConflictException(
        `${program.name} already has a batch named ${dto.name}`,
      );

    return {
      programId: program.id,
      name: dto.name,
      classLevel: dto.classLevel ?? null,
      capacity: dto.capacity,
      startDate,
      endDate,
      coordinatorId: dto.coordinatorId ?? null,
    };
  }
}

/**
 * Puts a teacher on a batch (keeping an existing role) and on its program,
 * per the PRD: assigning a coordinator or a batch also assigns the program.
 */
export async function assignFaculty(
  tx: Tx,
  schoolId: string,
  facultyId: string,
  batchId: string,
  programId: string,
) {
  await tx.facultyBatch.upsert({
    where: { facultyId_batchId: { facultyId, batchId } },
    create: { facultyId, batchId, schoolId, role: 'PRIMARY' },
    update: {},
  });
  await tx.facultyProgram.upsert({
    where: { facultyId_programId: { facultyId, programId } },
    create: { facultyId, programId, schoolId },
    update: {},
  });
}

/**
 * Teachers get access to a program through its batches. Once none of a
 * teacher's batches is in `programId` any more, drop that program from them,
 * so access doesn't pile up as batches move or close.
 */
export async function pruneFacultyPrograms(
  tx: Tx,
  schoolId: string,
  programId: string,
  facultyIds: string[],
) {
  if (facultyIds.length === 0) return;
  const stillThere = await tx.facultyBatch.findMany({
    where: { facultyId: { in: facultyIds }, batch: { programId } },
    select: { facultyId: true },
  });
  const keep = new Set(stillThere.map((r) => r.facultyId));
  const drop = facultyIds.filter((id) => !keep.has(id));
  if (drop.length === 0) return;
  await tx.facultyProgram.deleteMany({
    where: { schoolId, programId, facultyId: { in: drop } },
  });
}

/** 409 message for a unique-index violation while saving a batch. */
export function batchClash(dto: { name: string }) {
  return (names: string[]) =>
    names.some((n) => n === 'name' || n.startsWith('Batch_'))
      ? `This program already has a batch named ${dto.name}`
      : 'Someone else changed this batch at the same time. Refresh and try again.';
}

/**
 * Locks the program a batch is joining (shared, so batches can still be added
 * side by side) and checks it still exists: a program being deleted holds it
 * FOR UPDATE, so this waits and then gets a clear 400 instead of a foreign-key 500.
 */
async function lockProgram(tx: Tx, schoolId: string, programId: string) {
  const rows = await tx.$queryRaw<unknown[]>`SELECT 1 FROM "Program" WHERE "id" = ${programId} AND "schoolId" = ${schoolId} FOR SHARE`;
  if (!rows.length) throw new BadRequestException('Select a program from this school');
}
