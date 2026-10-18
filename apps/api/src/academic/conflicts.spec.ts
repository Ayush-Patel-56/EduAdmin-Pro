import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { realUniqueError } from '../common/prisma-errors.fixture.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type {
  BatchDto,
  ProgramDto,
  SyllabusImportDto,
} from './academic.dto.js';
import { BatchesService, HANDED_IN_UNGRADED } from './batches.service.js';
import { ProgramsService } from './programs.service.js';
import { SyllabusService } from './syllabus.service.js';
import type { AccessService } from './access.service.js';
import type { AuthContext } from '../auth/session.guard.js';
import type { CreateSchoolDto } from '../schools/schools.dto.js';
import { SchoolsService } from '../schools/schools.service.js';

// #7: two requests can both pass the service's own duplicate check; the
// database's unique index then rejects one. That must be a 409, not a 500.

describe('ProgramsService: racing creates/updates are 409s', () => {
  const create = vi.fn();
  const update = vi.fn();
  const prisma = {
    program: {
      findFirst: vi.fn().mockResolvedValue(null), // the service check sees no clash
      create,
      update,
    },
  } as unknown as PrismaService;
  const programs = new ProgramsService(prisma);
  const dto = {
    name: 'Olympiad',
    code: 'OLY',
    targetExams: [],
  } as unknown as ProgramDto;

  it('create: a name race is a 409 naming the program', async () => {
    create.mockRejectedValueOnce(
      realUniqueError('Program_schoolId_lower_name_key', 'Program'),
    );
    await expect(programs.create('s1', dto)).rejects.toEqual(
      new ConflictException('A program named Olympiad already exists'),
    );
  });

  it('create: a code race says the code is taken', async () => {
    create.mockRejectedValueOnce(
      realUniqueError('Program_schoolId_code_key', 'Program'),
    );
    await expect(programs.create('s1', dto)).rejects.toEqual(
      new ConflictException('Code OLY is already used by another program'),
    );
  });

  it('update: a race is a 409', async () => {
    (prisma.program.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'p1' }) // find()
      .mockResolvedValueOnce(null); // assertUnique()
    update.mockRejectedValueOnce(
      realUniqueError('Program_schoolId_name_key', 'Program'),
    );
    await expect(programs.update('s1', 'p1', dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('other errors are not turned into 409s', async () => {
    create.mockRejectedValueOnce(new Error('db down'));
    await expect(programs.create('s1', dto)).rejects.toThrow('db down');
  });
});

describe('BatchesService: racing creates/updates are 409s', () => {
  const tx = { batch: { create: vi.fn(), update: vi.fn() }, $queryRaw: vi.fn().mockResolvedValue([{}]) };
  const prisma = {
    program: {
      findFirst: vi.fn().mockResolvedValue({ id: 'p1', name: 'JEE' }),
    },
    batch: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    faculty: { findFirst: vi.fn() },
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaService;
  const batches = new BatchesService(prisma);
  const dto = {
    name: 'Morning',
    programId: 'p1',
    startDate: '2026-04-01',
  } as BatchDto;

  it('create: the unique index rejecting the second batch is a 409', async () => {
    tx.batch.create.mockRejectedValueOnce(
      realUniqueError('Batch_programId_lower_name_key', 'Batch'),
    );
    await expect(batches.create('s1', dto)).rejects.toEqual(
      new ConflictException('This program already has a batch named Morning'),
    );
  });

  it('update: same', async () => {
    (prisma.batch.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'b1',
      programId: 'p1',
      coordinatorId: null,
    });
    tx.batch.update.mockRejectedValueOnce(
      realUniqueError('Batch_programId_name_key', 'Batch'),
    );
    await expect(batches.update('s1', 'b1', dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('SyllabusService.import: honest counts when another import wins a race', () => {
  const createManyAndReturn = vi.fn();
  const prisma = {
    school: { findUniqueOrThrow: vi.fn().mockResolvedValue({ name: 'S' }) },
    batch: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { id: 'b1', name: 'B1', programId: 'p1', program: { name: 'JEE' } },
        ]),
    },
    program: { findFirst: vi.fn() },
    syllabusItem: {
      findMany: vi.fn().mockResolvedValue([]), // nothing exists when we look
      createManyAndReturn,
      update: vi.fn(),
    },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  } as unknown as PrismaService;
  const syllabus = new SyllabusService(prisma);
  const dto = {
    dryRun: false,
    defaults: { batchId: 'b1', subject: 'Physics' },
    rows: [{ title: 'Kinematics' }, { title: 'Optics' }],
  } as unknown as SyllabusImportDto;

  it('a row the unique index skipped is reported, not counted as created', async () => {
    // A concurrent import created "Optics" between our read and our write.
    createManyAndReturn.mockResolvedValueOnce([
      { batchId: 'b1', subject: 'Physics', title: 'Kinematics' },
    ]);
    const result = await syllabus.import('s1', null, 'u1', dto);
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.rows[1]).toMatchObject({
      action: 'error',
      errors: [expect.stringMatching(/added by someone else/)],
    });
    expect(createManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it('counts every row when nothing raced', async () => {
    createManyAndReturn.mockResolvedValueOnce([
      { batchId: 'b1', subject: 'Physics', title: 'Kinematics' },
      { batchId: 'b1', subject: 'Physics', title: 'optics' },
    ]);
    const result = await syllabus.import('s1', null, 'u1', dto);
    expect(result).toMatchObject({ created: 2, skipped: 0 });
  });
});

describe('SchoolsService.updateSchool: a program added concurrently is a 409', () => {
  it('maps the createMany unique violation to a 409', async () => {
    const tx = {
      program: {
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi
          .fn()
          .mockRejectedValue(
            realUniqueError('Program_schoolId_lower_name_key', 'Program'),
          ),
        deleteMany: vi.fn(),
      },
      curriculumChapter: {
        updateMany: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      school: { update: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaService;
    const access = { assertOwner: vi.fn() } as unknown as AccessService;
    const schools = new SchoolsService(prisma, access, {} as never, {} as never);
    await expect(
      schools.updateSchool({ userId: 'u1' } as AuthContext, 's1', {
        name: 'S',
        board: 'CBSE',
        classes: ['11th'],
        programs: ['Olympiad'],
      } as CreateSchoolDto),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.school.update).not.toHaveBeenCalled();
  });
});

describe('BatchesService.list: handed-in work for the delete confirmation (#18 review)', () => {
  it('counts ungraded handed-in submissions per batch, the same way the delete guard does', async () => {
    const assignmentFindMany = vi.fn().mockResolvedValue([
      { batchId: 'b1', _count: { submissions: 2 } },
      { batchId: 'b1', _count: { submissions: 1 } },
      { batchId: 'b2', _count: { submissions: 0 } },
    ]);
    const batch = (id: string) => ({ id, name: id, program: null, classLevel: 11, capacity: 30, startDate: new Date('2026-04-01T00:00:00Z'), endDate: null, coordinator: null, _count: { facultyBatches: 0, syllabusItems: 0, students: 0, materials: 0, assignments: 1, calendarEvents: 0 } });
    const prisma = {
      batch: { findMany: vi.fn().mockResolvedValue([batch('b1'), batch('b2'), batch('b3')]) },
      assignment: { findMany: assignmentFindMany },
    } as unknown as PrismaService;
    const rows = await new BatchesService(prisma).list('s1');
    expect(rows.map((r) => [r.id, r.handedInCount])).toEqual([['b1', 3], ['b2', 0], ['b3', 0]]);
    expect(assignmentFindMany.mock.calls[0][0]).toEqual({
      where: { schoolId: 's1', batchId: { in: ['b1', 'b2', 'b3'] } },
      select: { batchId: true, _count: { select: { submissions: { where: HANDED_IN_UNGRADED } } } },
    });
    expect(HANDED_IN_UNGRADED).toEqual({ status: { not: 'GRADED' }, OR: [{ status: { in: ['SUBMITTED', 'LATE'] } }, { fileId: { not: null } }] });
  });
});

describe('BatchesService.remove: student history and grades', () => {
  const build = (graded: number, classesMarked = 0, fees = 0, reports = 0) => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      assignmentSubmission: { count: vi.fn().mockResolvedValue(graded) },
      classOccurrence: { count: vi.fn().mockResolvedValue(classesMarked) },
      dailyReport: { count: vi.fn().mockResolvedValue(reports) },
      feeStructure: { count: vi.fn().mockResolvedValue(fees) },
      facultyBatch: { findMany: vi.fn().mockResolvedValue([]) },
      student: { updateMany: vi.fn() },
      studentEnrollment: { updateMany: vi.fn() },
      batch: { delete: vi.fn() },
    };
    const prisma = {
      batch: { findFirst: vi.fn().mockResolvedValue({ id: 'b1', programId: 'p1' }) },
      $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaService;
    return { tx, batches: new BatchesService(prisma) };
  };

  it('a batch with recorded grades is not deleted (they are records)', async () => {
    const { tx, batches } = build(3);
    await expect(batches.remove('s1', 'b1')).rejects.toThrow('3 grades are recorded');
    expect(tx.assignmentSubmission.count.mock.calls[0][0].where).toEqual({ schoolId: 's1', status: 'GRADED', assignment: { batchId: 'b1' } });
    // Counted after locking the batch and its assignments, so no grade slips in.
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(tx.assignmentSubmission.count.mock.invocationCallOrder[0]);
    expect(tx.batch.delete).not.toHaveBeenCalled();
  });

  it("a batch with its teachers' daily reports is not deleted (they are records too)", async () => {
    const { tx, batches } = build(0, 0, 0, 2);
    await expect(batches.remove('s1', 'b1')).rejects.toThrow('2 daily reports are recorded for this batch. Set an end date for the batch instead.');
    expect(tx.dailyReport.count.mock.calls[0][0]).toEqual({ where: { schoolId: 's1', batchId: 'b1' } });
    // Counted after locking the batch, so a report being submitted (it share-locks the batch) can't slip in.
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.dailyReport.count.mock.invocationCallOrder[0]);
    expect(tx.batch.delete).not.toHaveBeenCalled();
    tx.dailyReport.count.mockResolvedValueOnce(1);
    await expect(batches.remove('s1', 'b1')).rejects.toThrow('1 daily report is recorded');
  });

  it('a batch with handed-in work not graded yet is not deleted either (#18)', async () => {
    const { tx, batches } = build(0);
    tx.assignmentSubmission.count.mockResolvedValueOnce(0).mockResolvedValueOnce(2);
    await expect(batches.remove('s1', 'b1')).rejects.toThrow('2 submissions are waiting to be graded');
    expect(tx.assignmentSubmission.count.mock.calls[1][0].where).toEqual({
      schoolId: 's1',
      assignment: { batchId: 'b1' },
      status: { not: 'GRADED' },
      OR: [{ status: { in: ['SUBMITTED', 'LATE'] } }, { fileId: { not: null } }],
    });
    // Counted under the same locks as the grades.
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(tx.assignmentSubmission.count.mock.invocationCallOrder[1]);
    expect(tx.batch.delete).not.toHaveBeenCalled();
    tx.assignmentSubmission.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    await expect(batches.remove('s1', 'b1')).rejects.toThrow('1 submission is waiting to be graded');
  });

  it('a pending submission that already has a file blocks the delete too, and the message does not suggest grading (#18 review)', async () => {
    const { tx, batches } = build(0);
    // Model the DB: one PENDING row with a file, no SUBMITTED/LATE rows.
    const rows = [{ status: 'PENDING', fileId: 'f1' }, { status: 'PENDING', fileId: null }];
    const statusOk = (f: any, s: string) => (f === undefined ? true : typeof f === 'string' ? f === s : f.in ? f.in.includes(s) : f.not !== s);
    const match = (w: any) =>
      rows.filter((r) => statusOk(w.status, r.status) && (!w.OR || w.OR.some((o: any) => (o.status ? statusOk(o.status, r.status) : r.fileId !== null)))).length;
    tx.assignmentSubmission.count.mockImplementation(async ({ where }: any) => match(where));
    const err = await batches.remove('s1', 'b1').catch((e) => e);
    expect(err?.message).toContain('1 submission is waiting to be graded');
    expect(err.message).not.toMatch(/grade them/);
    expect(tx.batch.delete).not.toHaveBeenCalled();
  });

  it('a batch that fee structures are scoped to is not deleted', async () => {
    const { tx, batches } = build(0, 0, 1);
    await expect(batches.remove('s1', 'b1')).rejects.toThrow('1 fee structure is set up for this batch');
    expect(tx.feeStructure.count.mock.calls[0][0].where).toEqual({ schoolId: 's1', batchId: 'b1' });
    expect(tx.batch.delete).not.toHaveBeenCalled();
  });

  it('a batch with recorded attendance is not deleted either', async () => {
    const { tx, batches } = build(0, 2);
    await expect(batches.remove('s1', 'b1')).rejects.toThrow('Attendance is recorded for 2 classes');
    expect(tx.classOccurrence.count.mock.calls[0][0].where).toEqual({ schoolId: 's1', batchId: 'b1' });
    expect(tx.batch.delete).not.toHaveBeenCalled();
  });

  it('unassigns the students and ends their open enrollments, so history shows when they left', async () => {
    const { tx, batches } = build(0);
    await batches.remove('s1', 'b1');
    expect(tx.student.updateMany.mock.calls[0][0]).toEqual({ where: { schoolId: 's1', batchId: 'b1' }, data: { batchId: null } });
    expect(tx.studentEnrollment.updateMany.mock.calls[0][0].where).toEqual({ schoolId: 's1', batchId: 'b1', endedOn: null });
    expect(tx.studentEnrollment.updateMany.mock.invocationCallOrder[0]).toBeLessThan(tx.batch.delete.mock.invocationCallOrder[0]);
  });
});
