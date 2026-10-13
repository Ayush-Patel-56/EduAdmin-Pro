import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { realUniqueError } from '../common/prisma-errors.fixture.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type {
  BatchDto,
  ProgramDto,
  SyllabusImportDto,
} from './academic.dto.js';
import { BatchesService } from './batches.service.js';
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
  const tx = { batch: { create: vi.fn(), update: vi.fn() } };
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
    const schools = new SchoolsService(prisma, access, {} as never);
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

describe('BatchesService.remove: student history and grades', () => {
  const build = (graded: number) => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      assignmentSubmission: { count: vi.fn().mockResolvedValue(graded) },
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

  it('unassigns the students and ends their open enrollments, so history shows when they left', async () => {
    const { tx, batches } = build(0);
    await batches.remove('s1', 'b1');
    expect(tx.student.updateMany.mock.calls[0][0]).toEqual({ where: { schoolId: 's1', batchId: 'b1' }, data: { batchId: null } });
    expect(tx.studentEnrollment.updateMany.mock.calls[0][0].where).toEqual({ schoolId: 's1', batchId: 'b1', endedOn: null });
    expect(tx.studentEnrollment.updateMany.mock.invocationCallOrder[0]).toBeLessThan(tx.batch.delete.mock.invocationCallOrder[0]);
  });
});
