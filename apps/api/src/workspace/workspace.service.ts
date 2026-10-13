import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { TeacherScope } from '../academic/access.service.js';
import {
  istInstant,
  istParts,
  istToday,
  parseDate,
  toIsoDate,
} from '../common/dates.js';
import { duplicateAsConflict } from '../common/unique-violation.js';
import {
  Prisma,
  type AssignmentType,
  type MaterialType,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FilesService } from '../storage/files.service.js';
import {
  ASSIGNMENT_TYPES,
  MATERIAL_TYPES,
  type AssignmentDto,
  type MaterialDto,
  type SubmissionDto,
  type WorkspaceQuery,
} from './workspace.dto.js';

type FileRow = { key: string; originalName: string; contentType: string; size: number };
type Db = Prisma.TransactionClient;

/** A unique file index decided a race: the file went to another record first. */
const fileClash = (names: string[]) =>
  names.some((n) => /fileId/i.test(n))
    ? 'That file is already attached to something else; upload it again'
    : 'Someone else saved this at the same time. Refresh and try again.';

/**
 * Locks the assignment row until the transaction ends. Edits take it FOR
 * UPDATE and grading FOR SHARE, so total marks and the scores checked against
 * them never change under each other (graders don't block one another).
 */
async function lockAssignment(tx: Db, schoolId: string, id: string, mode: 'UPDATE' | 'SHARE') {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Assignment" WHERE "id" = ${id} AND "schoolId" = ${schoolId} FOR ${Prisma.raw(mode)}`;
  if (rows.length === 0) throw new NotFoundException('Assignment not found');
}

const materialInclude = {
  batch: { select: { id: true, name: true } },
  faculty: { select: { id: true, name: true } },
  file: { select: { key: true, originalName: true, contentType: true, size: true } },
} as const;

const assignmentInclude = {
  batch: { select: { id: true, name: true } },
  faculty: { select: { id: true, name: true } },
  questionFile: { select: { key: true, originalName: true, contentType: true, size: true } },
  submissions: { select: { status: true } },
} as const;

type MaterialRow = Prisma.StudyMaterialGetPayload<{ include: typeof materialInclude }>;
type AssignmentRow = Prisma.AssignmentGetPayload<{ include: typeof assignmentInclude }>;

/**
 * The faculty Academic Workspace (PRD 5.9): study material, assignments and
 * grading. Teachers work only in their own batches and change only what they
 * created; admins can see and preview everything.
 */
@Injectable()
export class WorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  // Study material

  async teacherMaterials(scope: TeacherScope, query: WorkspaceQuery) {
    const batchIds = this.batchFilter(scope, query.batchId);
    const rows = await this.prisma.studyMaterial.findMany({
      where: {
        schoolId: scope.schoolId,
        batchId: { in: batchIds },
        // Private material is seen only by the teacher who uploaded it.
        OR: [
          { isPublic: true },
          ...(scope.facultyId ? [{ facultyId: scope.facultyId }] : []),
        ],
        ...materialFilters(query),
      },
      orderBy: { createdAt: 'desc' },
      include: materialInclude,
    });
    return Promise.all(rows.map((m) => this.toMaterial(m, scope.facultyId)));
  }

  async adminMaterials(schoolId: string, query: WorkspaceQuery) {
    const rows = await this.prisma.studyMaterial.findMany({
      where: {
        schoolId,
        ...(query.batchId && { batchId: query.batchId }),
        ...materialFilters(query),
      },
      orderBy: { createdAt: 'desc' },
      include: materialInclude,
      take: 500,
    });
    return Promise.all(rows.map((m) => this.toMaterial(m, null)));
  }

  async createMaterial(scope: TeacherScope, userId: string, dto: MaterialDto) {
    const facultyId = this.requireTeacher(scope);
    this.requireBatch(scope, dto.batchId);
    await this.files.claim(scope.schoolId, dto.fileId, 'STUDY_MATERIAL', userId);
    const row = await duplicateAsConflict(
      () =>
        this.prisma.studyMaterial.create({
          data: { schoolId: scope.schoolId, facultyId, ...materialData(dto) },
          select: { id: true },
        }),
      fileClash,
    );
    return { id: row.id };
  }

  async updateMaterial(scope: TeacherScope, userId: string, id: string, dto: MaterialDto) {
    const current = await this.ownMaterial(scope, id);
    this.requireBatch(scope, dto.batchId);
    await this.files.claim(scope.schoolId, dto.fileId, 'STUDY_MATERIAL', userId, current.fileId);
    await duplicateAsConflict(
      () => this.prisma.studyMaterial.update({ where: { id }, data: materialData(dto) }),
      fileClash,
    );
    if (current.fileId !== dto.fileId) await this.files.discardQuietly([current.file]);
    return { id };
  }

  async deleteMaterial(scope: TeacherScope, id: string) {
    const current = await this.ownMaterial(scope, id);
    await this.prisma.studyMaterial.delete({ where: { id } });
    await this.files.discardQuietly([current.file]);
    return { ok: true };
  }

  // Assignments

  async teacherAssignments(scope: TeacherScope, query: WorkspaceQuery) {
    const batchIds = this.batchFilter(scope, query.batchId);
    const rows = await this.prisma.assignment.findMany({
      where: { schoolId: scope.schoolId, batchId: { in: batchIds }, ...assignmentFilters(query) },
      orderBy: { dueAt: 'desc' },
      include: assignmentInclude,
    });
    return this.withRates(rows, scope.facultyId);
  }

  async adminAssignments(schoolId: string, query: WorkspaceQuery) {
    const rows = await this.prisma.assignment.findMany({
      where: { schoolId, ...(query.batchId && { batchId: query.batchId }), ...assignmentFilters(query) },
      orderBy: { dueAt: 'desc' },
      include: assignmentInclude,
      take: 500,
    });
    return this.withRates(rows, null);
  }

  async createAssignment(scope: TeacherScope, userId: string, dto: AssignmentDto) {
    const facultyId = this.requireTeacher(scope);
    this.requireBatch(scope, dto.batchId);
    if (dto.questionFileId) {
      await this.files.claim(scope.schoolId, dto.questionFileId, 'ASSIGNMENT_SHEET', userId);
    }
    const row = await duplicateAsConflict(
      () =>
        this.prisma.assignment.create({
          data: { schoolId: scope.schoolId, facultyId, ...assignmentData(dto) },
          select: { id: true },
        }),
      fileClash,
    );
    return { id: row.id };
  }

  async updateAssignment(scope: TeacherScope, userId: string, id: string, dto: AssignmentDto) {
    this.requireBatch(scope, dto.batchId);
    const replaced = await duplicateAsConflict(
      () =>
        this.prisma.$transaction(async (tx) => {
          // Locked first: a grade saved meanwhile waits, then sees the new total.
          await lockAssignment(tx, scope.schoolId, id, 'UPDATE');
          const current = await this.ownAssignment(scope, id, tx);
          if (dto.batchId !== current.batchId && current._count.submissions > 0) {
            throw new BadRequestException(
              'Grades are already recorded for this assignment, so it stays with its batch',
            );
          }
          const highest = await tx.assignmentSubmission.aggregate({
            where: { assignmentId: id },
            _max: { score: true },
          });
          if (highest._max.score !== null && Number(highest._max.score) > dto.totalMarks) {
            throw new BadRequestException(
              `A student already scored ${Number(highest._max.score)}; total marks can't be lower`,
            );
          }
          if (dto.questionFileId) {
            await this.files.claim(scope.schoolId, dto.questionFileId, 'ASSIGNMENT_SHEET', userId, current.questionFileId);
          }
          await tx.assignment.update({ where: { id }, data: assignmentData(dto) });
          return current.questionFile && current.questionFileId !== (dto.questionFileId ?? null)
            ? current.questionFile
            : null;
        }),
      fileClash,
    );
    if (replaced) await this.files.discardQuietly([replaced]);
    return { id };
  }

  /** Deletes the assignment with its recorded submissions and their files. */
  async deleteAssignment(scope: TeacherScope, id: string) {
    const files = await this.prisma.$transaction(async (tx) => {
      // Locked, so no grade (and its file) is added after the files are listed.
      await lockAssignment(tx, scope.schoolId, id, 'UPDATE');
      const current = await this.ownAssignment(scope, id, tx);
      const submitted = await tx.fileObject.findMany({
        where: { submissions: { some: { assignmentId: id } } },
        select: { id: true, key: true },
      });
      await tx.assignment.delete({ where: { id } });
      return [...submitted, ...(current.questionFile ? [current.questionFile] : [])];
    });
    await this.files.discardQuietly(files);
    return { ok: true };
  }

  // Grading

  /** Every active student of the batch (and anyone already graded), with their submission. */
  async submissions(scope: TeacherScope, assignmentId: string) {
    const assignment = await this.visibleAssignment(scope, assignmentId);
    const [students, submissions] = await Promise.all([
      this.prisma.student.findMany({
        where: {
          schoolId: scope.schoolId,
          OR: [
            { batchId: assignment.batchId, status: 'ACTIVE' },
            { submissions: { some: { assignmentId } } },
          ],
        },
        orderBy: [{ rollNumber: 'asc' }, { fullName: 'asc' }],
        select: { id: true, fullName: true, rollNumber: true },
      }),
      this.prisma.assignmentSubmission.findMany({
        where: { assignmentId },
        include: { file: { select: { key: true, originalName: true, contentType: true, size: true } } },
      }),
    ]);
    const byStudent = new Map(submissions.map((s) => [s.studentId, s]));
    return {
      assignment: {
        id: assignment.id,
        title: assignment.title,
        totalMarks: assignment.totalMarks,
        dueAt: assignment.dueAt.toISOString(),
        batch: assignment.batch.name,
      },
      students: await Promise.all(
        students.map(async (student) => {
          const s = byStudent.get(student.id);
          return {
            student,
            submission: s
              ? {
                  status: s.status,
                  score: s.score === null ? null : Number(s.score),
                  feedback: s.feedback,
                  submittedOn: toIsoDate(s.submittedOn),
                  gradedAt: s.gradedAt?.toISOString() ?? null,
                  file: s.file ? await this.fileView(s.file) : null,
                  fileId: s.fileId,
                }
              : null,
          };
        }),
      ),
    };
  }

  /** Saves one student's submission; a score marks it graded. */
  async saveSubmission(
    scope: TeacherScope,
    userId: string,
    assignmentId: string,
    studentId: string,
    dto: SubmissionDto,
  ) {
    this.requireTeacher(scope);
    const score = dto.score ?? null;
    if (dto.status === 'GRADED' && score === null) {
      throw new BadRequestException('Enter a score to mark it graded');
    }
    const status = score !== null ? 'GRADED' : dto.status;
    const submittedOn = dto.submittedOn ? parseDate(dto.submittedOn, 'Submitted on') : null;
    if (submittedOn && submittedOn > istToday()) {
      throw new BadRequestException("Submitted on can't be in the future");
    }
    const replaced = await duplicateAsConflict(
      () =>
        this.prisma.$transaction(async (tx) => {
          // Total marks are read under the lock, so an edit can't lower them
          // below this score in the meantime.
          await lockAssignment(tx, scope.schoolId, assignmentId, 'SHARE');
          const assignment = await this.visibleAssignment(scope, assignmentId, tx);
          const [student, existing] = await Promise.all([
            tx.student.findFirst({
              where: {
                id: studentId,
                schoolId: scope.schoolId,
                OR: [{ batchId: assignment.batchId }, { submissions: { some: { assignmentId } } }],
              },
              select: { id: true },
            }),
            tx.assignmentSubmission.findUnique({
              where: { assignmentId_studentId: { assignmentId, studentId } },
              select: { fileId: true, file: { select: { id: true, key: true } } },
            }),
          ]);
          if (!student) throw new NotFoundException('That student isn’t in this assignment’s batch');
          if (score !== null && score > assignment.totalMarks) {
            throw new BadRequestException(`Score can be at most ${assignment.totalMarks}`);
          }
          if (dto.fileId) {
            await this.files.claim(scope.schoolId, dto.fileId, 'SUBMISSION', userId, existing?.fileId);
          }
          const data = {
            status,
            score,
            feedback: dto.feedback ?? null,
            submittedOn: status === 'PENDING' ? null : submittedOn,
            fileId: dto.fileId ?? null,
            gradedAt: status === 'GRADED' ? new Date() : null,
            gradedById: status === 'GRADED' ? userId : null,
          };
          await tx.assignmentSubmission.upsert({
            where: { assignmentId_studentId: { assignmentId, studentId } },
            create: { schoolId: scope.schoolId, assignmentId, studentId, ...data },
            update: data,
          });
          return existing?.file && existing.fileId !== data.fileId ? existing.file : null;
        }),
      fileClash,
    );
    if (replaced) await this.files.discardQuietly([replaced]);
    return { status, score };
  }

  // Helpers

  /** The teacher's batches, or the one asked for if it's theirs. */
  private batchFilter(scope: TeacherScope, batchId: string | null | undefined) {
    if (!scope.active) return [];
    if (!batchId) return scope.batchIds;
    if (!scope.batchIds.includes(batchId)) throw new ForbiddenException('That batch isn’t assigned to you');
    return [batchId];
  }

  private requireTeacher(scope: TeacherScope) {
    if (!scope.active || !scope.facultyId) {
      throw new ForbiddenException('Only active faculty can do this');
    }
    return scope.facultyId;
  }

  private requireBatch(scope: TeacherScope, batchId: string) {
    if (!scope.batchIds.includes(batchId)) {
      throw new ForbiddenException('Pick one of the batches assigned to you');
    }
  }

  /**
   * Material the teacher uploaded, in a batch that is still theirs: a teacher
   * taken off a batch no longer changes (or deletes) what is in it.
   */
  private async ownMaterial(scope: TeacherScope, id: string) {
    const facultyId = this.requireTeacher(scope);
    const row = await this.prisma.studyMaterial.findFirst({
      where: { id, schoolId: scope.schoolId },
      select: { facultyId: true, batchId: true, fileId: true, file: { select: { id: true, key: true } } },
    });
    if (!row) throw new NotFoundException('Study material not found');
    if (row.facultyId !== facultyId) throw new ForbiddenException('Only the teacher who uploaded it can change it');
    if (!scope.batchIds.includes(row.batchId)) {
      throw new ForbiddenException('That batch is no longer assigned to you');
    }
    return row;
  }

  /** Like `ownMaterial`: set by this teacher, in one of their batches. */
  private async ownAssignment(scope: TeacherScope, id: string, db: Db = this.prisma) {
    const facultyId = this.requireTeacher(scope);
    const row = await db.assignment.findFirst({
      where: { id, schoolId: scope.schoolId },
      select: {
        facultyId: true,
        batchId: true,
        questionFileId: true,
        questionFile: { select: { id: true, key: true } },
        _count: { select: { submissions: true } },
      },
    });
    if (!row) throw new NotFoundException('Assignment not found');
    if (row.facultyId !== facultyId) throw new ForbiddenException('Only the teacher who set it can change it');
    if (!scope.batchIds.includes(row.batchId)) {
      throw new ForbiddenException('That batch is no longer assigned to you');
    }
    return row;
  }

  /** Any assignment of the teacher's batches (all their teachers grade it). */
  private async visibleAssignment(scope: TeacherScope, id: string, db: Db = this.prisma) {
    const row = await db.assignment.findFirst({
      where: { id, schoolId: scope.schoolId, batchId: { in: scope.active ? scope.batchIds : [] } },
      include: { batch: { select: { name: true } } },
    });
    if (!row) throw new NotFoundException('Assignment not found');
    return row;
  }

  private async fileView(file: FileRow) {
    return { name: file.originalName, contentType: file.contentType, size: file.size, url: await this.files.url(file) };
  }

  private async toMaterial(m: MaterialRow, viewerFacultyId: string | null) {
    return {
      id: m.id,
      title: m.title,
      description: m.description,
      provider: m.provider,
      chapter: m.chapter,
      subject: m.subject,
      type: m.type,
      isPublic: m.isPublic,
      batch: m.batch,
      uploadedBy: m.faculty?.name ?? null,
      mine: !!viewerFacultyId && m.facultyId === viewerFacultyId,
      fileId: m.fileId,
      file: await this.fileView(m.file),
      createdAt: m.createdAt.toISOString(),
    };
  }

  /** Adds each assignment's submission rate: handed in / active students of the batch. */
  private async withRates(rows: AssignmentRow[], viewerFacultyId: string | null) {
    const batchIds = [...new Set(rows.map((r) => r.batchId))];
    const counts = await this.prisma.student.groupBy({
      by: ['batchId'],
      where: { batchId: { in: batchIds }, status: 'ACTIVE' },
      _count: { _all: true },
    });
    const students = new Map(counts.map((c) => [c.batchId, c._count._all]));
    return Promise.all(
      rows.map(async (a) => {
        const handedIn = a.submissions.filter((s) => s.status !== 'PENDING').length;
        const [dueDate, dueTime] = istParts(a.dueAt);
        return {
          id: a.id,
          title: a.title,
          description: a.description,
          chapter: a.chapter,
          subject: a.subject,
          type: a.type,
          batch: a.batch,
          dueAt: a.dueAt.toISOString(),
          dueDate,
          dueTime,
          totalMarks: a.totalMarks,
          setBy: a.faculty?.name ?? null,
          mine: !!viewerFacultyId && a.facultyId === viewerFacultyId,
          questionFileId: a.questionFileId,
          questionFile: a.questionFile ? await this.fileView(a.questionFile) : null,
          students: students.get(a.batchId) ?? 0,
          handedIn,
          graded: a.submissions.filter((s) => s.status === 'GRADED').length,
        };
      }),
    );
  }
}

function materialFilters(query: WorkspaceQuery): Prisma.StudyMaterialWhereInput {
  const q = query.q?.trim();
  return {
    ...(query.type && (MATERIAL_TYPES as readonly string[]).includes(query.type) && { type: query.type as MaterialType }),
    ...(q && {
      AND: [
        {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { chapter: { contains: q, mode: 'insensitive' } },
            { provider: { contains: q, mode: 'insensitive' } },
          ],
        },
      ],
    }),
  };
}

function assignmentFilters(query: WorkspaceQuery): Prisma.AssignmentWhereInput {
  const q = query.q?.trim();
  return {
    ...(query.type && (ASSIGNMENT_TYPES as readonly string[]).includes(query.type) && { type: query.type as AssignmentType }),
    ...(q && {
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { chapter: { contains: q, mode: 'insensitive' } },
      ],
    }),
  };
}

function materialData(dto: MaterialDto) {
  return {
    title: dto.title,
    description: dto.description ?? null,
    provider: dto.provider,
    chapter: dto.chapter ?? null,
    batchId: dto.batchId,
    subject: dto.subject,
    type: dto.type,
    isPublic: dto.isPublic,
    fileId: dto.fileId,
  };
}

function assignmentData(dto: AssignmentDto) {
  return {
    title: dto.title,
    description: dto.description ?? null,
    chapter: dto.chapter,
    batchId: dto.batchId,
    subject: dto.subject,
    type: dto.type,
    dueAt: istInstant(dto.dueDate, dto.dueTime, 'Due date'),
    totalMarks: dto.totalMarks,
    questionFileId: dto.questionFileId ?? null,
  };
}
