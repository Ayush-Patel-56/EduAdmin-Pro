import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/** What a teacher may see in their school: their own assignments only. */
export type TeacherScope = {
  schoolId: string;
  facultyId: string | null;
  batchIds: string[];
  programIds: string[];
};

/**
 * Resolves who may do what in a school. Every academic-planning endpoint goes
 * through here first, so a request can only ever touch rows of a school the
 * caller is an active member of.
 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** An ACTIVE admin of `schoolId`. */
  async assertAdmin(userId: string, schoolId: string) {
    const membership = await this.prisma.schoolMembership.findUnique({
      where: { userId_schoolId: { userId, schoolId } },
      include: { school: { select: { createdById: true } } },
    });
    if (!membership) throw new NotFoundException('School not found');
    if (membership.role !== 'ADMIN' || membership.status !== 'ACTIVE') {
      throw new ForbiddenException('Only admins of this school can do this');
    }
    return { isOwner: membership.school.createdById === userId };
  }

  /** Every school the user is an ACTIVE admin of (for views that span schools). */
  async adminSchoolIds(userId: string) {
    const memberships = await this.prisma.schoolMembership.findMany({
      where: { userId, role: 'ADMIN', status: 'ACTIVE' },
      select: { schoolId: true },
    });
    return memberships.map((m) => m.schoolId);
  }

  /** The admin who created the school: needed for edit, delete and Clear All Data. */
  async assertOwner(userId: string, schoolId: string) {
    const { isOwner } = await this.assertAdmin(userId, schoolId);
    if (!isOwner)
      throw new ForbiddenException('Only the school owner can do this');
  }

  /** The teacher's active school and the batches/programs assigned to them there. */
  async teacherScope(userId: string): Promise<TeacherScope> {
    const membership = await this.prisma.schoolMembership.findFirst({
      where: { userId, role: 'TEACHER', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { schoolId: true },
    });
    if (!membership)
      throw new ForbiddenException(
        'Join a school to see its academic planning',
      );
    const faculty = await this.prisma.faculty.findUnique({
      where: { schoolId_userId: { schoolId: membership.schoolId, userId } },
      select: {
        id: true,
        batchAssignments: { select: { batchId: true } },
        programAssignments: { select: { programId: true } },
      },
    });
    return {
      schoolId: membership.schoolId,
      facultyId: faculty?.id ?? null,
      batchIds: faculty?.batchAssignments.map((b) => b.batchId) ?? [],
      programIds: faculty?.programAssignments.map((p) => p.programId) ?? [],
    };
  }
}
