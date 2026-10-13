import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { FacultyService } from './faculty.service.js';
import { pruneFacultyPrograms } from './batches.service.js';
import {
  PromotionService,
  currentAcademicYear,
  nextClass,
  planPromotion,
} from './promotion.service.js';

describe('academic year boundary uses Indian time', () => {
  it('the new year starts at midnight IST, not 05:30 IST', () => {
    // 2026-03-31 19:00 UTC is 2026-04-01 00:30 IST: already the new year.
    expect(
      currentAcademicYear(4, new Date('2026-03-31T19:00:00Z')).academicYear,
    ).toBe('2026-2027');
    // 18:00 UTC is 23:30 IST on 31 March: still the old year.
    expect(
      currentAcademicYear(4, new Date('2026-03-31T18:00:00Z')).academicYear,
    ).toBe('2025-2026');
  });

  it('works across the calendar-year boundary for a January start', () => {
    expect(
      currentAcademicYear(1, new Date('2025-12-31T18:29:00Z')).academicYear,
    ).toBe('2025-2026');
    expect(
      currentAcademicYear(1, new Date('2025-12-31T18:30:00Z')).academicYear,
    ).toBe('2026-2027');
  });
});

describe('PromotionService: confirm needs students', () => {
  const create = vi.fn();
  const studentFindMany = vi.fn();
  const updateMany = vi.fn();
  const enrollmentUpdateMany = vi.fn();
  const school = {
    findUniqueOrThrow: vi
      .fn()
      .mockResolvedValue({ academicYearStartMonth: 4, classes: ['9th', '10th', '11th', '12th'] }),
  };
  const tx = {
    school,
    promotionCycle: { create },
    student: { findMany: studentFindMany, updateMany },
    studentEnrollment: { updateMany: enrollmentUpdateMany },
  };
  const prisma = {
    school,
    promotionCycle: { findMany: vi.fn().mockResolvedValue([]), create },
    student: { findMany: studentFindMany, updateMany },
    $transaction: vi.fn((run: (t: typeof tx) => unknown) => run(tx)),
  } as unknown as PrismaService;
  const promotion = new PromotionService(prisma);
  const { academicYear, boundaryDate } = currentAcademicYear(4);
  const before = new Date(boundaryDate.getTime() - 86_400_000);

  beforeEach(() => {
    create.mockReset();
    updateMany.mockReset();
    enrollmentUpdateMany.mockReset();
    studentFindMany.mockResolvedValue([]);
  });

  it('refuses to confirm while no student records exist, and does not use the year up', async () => {
    await expect(
      promotion.decide('school-1', 'user-1', academicYear, 'CONFIRMED'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });

  it('still lets an admin dismiss the cycle, moving nobody', async () => {
    studentFindMany.mockResolvedValue([
      { id: 's1', classLevel: '9th', admissionDate: before },
    ]);
    await expect(
      promotion.decide('school-1', 'user-1', academicYear, 'DISMISSED'),
    ).resolves.toEqual({ ok: true });
    expect(create.mock.calls[0][0].data).toMatchObject({
      status: 'DISMISSED',
      academicYear,
      studentCount: 0,
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('confirming moves each class up once (9th to 10th and 10th to 11th, nobody twice)', async () => {
    studentFindMany.mockResolvedValue([
      { id: 'a', classLevel: '9th', admissionDate: before },
      { id: 'b', classLevel: '10th', admissionDate: null },
      { id: 'c', classLevel: '12th', admissionDate: before },
      { id: 'd', classLevel: '9th', admissionDate: boundaryDate },
    ]);
    await promotion.decide('school-1', 'user-1', academicYear, 'CONFIRMED');
    expect(create.mock.calls[0][0].data).toMatchObject({
      status: 'CONFIRMED',
      studentCount: 2,
    });
    expect(updateMany.mock.calls.map((c) => c[0])).toEqual([
      { where: { id: { in: ['a'] }, schoolId: 'school-1' }, data: { classLevel: '10th' } },
      { where: { id: { in: ['b'] }, schoolId: 'school-1' }, data: { classLevel: '11th' } },
    ]);
    // The cycle row is written before any student moves.
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(
      updateMany.mock.invocationCallOrder[0],
    );
  });

  it('students in a batch for one class leave it when they move up; open batches keep them', async () => {
    studentFindMany.mockResolvedValue([
      { id: 'a', classLevel: '9th', admissionDate: before, batch: { classLevel: 9 } },
      { id: 'b', classLevel: '9th', admissionDate: before, batch: { classLevel: null } },
      { id: 'c', classLevel: '9th', admissionDate: before, batch: null },
    ]);
    await promotion.decide('school-1', 'user-1', academicYear, 'CONFIRMED');
    expect(updateMany.mock.calls.map((c) => c[0])).toContainEqual({
      where: { id: { in: ['a'] }, schoolId: 'school-1' },
      data: { batchId: null },
    });
    expect(enrollmentUpdateMany.mock.calls[0][0]).toEqual({
      where: { studentId: { in: ['a'] }, schoolId: 'school-1', endedOn: null },
      data: { endedOn: boundaryDate },
    });
  });

  it('rejects a year that is not the pending one', async () => {
    await expect(
      promotion.decide('school-1', 'user-1', '1999-2000', 'DISMISSED'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a double submit is a clear conflict (the unique key decides)', async () => {
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(
      promotion.decide('school-1', 'user-1', academicYear, 'DISMISSED'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('planPromotion', () => {
  const boundary = new Date('2026-04-01T00:00:00Z');
  const plan = (students: { classLevel: string | null; admissionDate?: Date | null }[], offered = ['6th', '7th', '8th', '9th', '10th', '11th', '12th']) =>
    planPromotion(
      {
        student: {
          findMany: vi.fn().mockResolvedValue(
            students.map((s, i) => ({ id: `s${i}`, admissionDate: null, ...s })),
          ),
        },
      } as never,
      'school-1',
      offered,
      boundary,
    );

  it('holds new admissions, leaves Class 12, and skips students with no next class', async () => {
    const result = await plan([
      { classLevel: '11th' },
      { classLevel: '11th', admissionDate: new Date('2026-04-02T00:00:00Z') },
      { classLevel: '12th' },
      { classLevel: null },
      { classLevel: 'Repeater' },
      { classLevel: '8th' },
    ], ['8th', '11th', '12th']);
    expect(result.groups).toEqual([{ fromClass: '11th', toClass: '12th', ids: ['s0'] }]);
    expect(result.heldNewAdmissions).toBe(1);
    expect(result.class12Excluded).toBe(1);
    // no class, Repeater, and 8th (the school doesn't offer 9th)
    expect(result.notPromoted).toBe(3);
  });

  it('nextClass follows the school-form order', () => {
    expect(nextClass('6th', ['7th'])).toBe('7th');
    expect(nextClass('11th', ['12th'])).toBe('12th');
    expect(nextClass('12th', ['12th Pass'])).toBeNull();
    expect(nextClass('10th', ['12th'])).toBeNull();
  });
});

describe('FacultyService.import: ambiguous and racing rows', () => {
  const findMany = vi.fn();
  const batchFindMany = vi.fn().mockResolvedValue([]);
  const transaction = vi.fn();
  const prisma = {
    faculty: { findMany },
    batch: { findMany: batchFindMany },
    $transaction: transaction,
  } as unknown as PrismaService;
  const faculty = new FacultyService(prisma);

  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([
      {
        id: 'f-anita',
        email: 'anita@example.com',
        employeeId: 'E1',
        userId: null,
      },
      {
        id: 'f-vikram',
        email: 'vikram@example.com',
        employeeId: 'E2',
        userId: null,
      },
    ]);
    batchFindMany.mockResolvedValue([]);
  });

  it('flags a row whose email and employee ID point at two different profiles', async () => {
    const result = await faculty.import(
      'school-1',
      [{ name: 'Mixed', email: 'anita@example.com', employeeId: 'E2' }],
      true,
    );
    expect(result.skipped).toBe(1);
    expect(result.rows[0].errors).toContain(
      'Email and Employee ID belong to two different faculty profiles',
    );
  });

  it('matches by email alone, by employee ID alone, or by both when they agree', async () => {
    const action = async (row: {
      name: string;
      email?: string;
      employeeId?: string;
    }) => (await faculty.import('school-1', [row], true)).rows[0].action;
    await expect(
      action({ name: 'A', email: 'anita@example.com' }),
    ).resolves.toBe('update');
    await expect(action({ name: 'B', employeeId: 'E2' })).resolves.toBe(
      'update',
    );
    await expect(
      action({ name: 'C', email: 'vikram@example.com', employeeId: 'E2' }),
    ).resolves.toBe('update');
    await expect(
      action({ name: 'D', email: 'new@example.com', employeeId: 'E9' }),
    ).resolves.toBe('create');
  });

  it('a change that lands between preview and apply is a 409 asking to retry, not a 500', async () => {
    transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(
      faculty.import(
        'school-1',
        [{ name: 'New', email: 'new@example.com' }],
        false,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('pruneFacultyPrograms: access does not pile up', () => {
  const findMany = vi.fn();
  const deleteMany = vi.fn();
  const tx = {
    facultyBatch: { findMany },
    facultyProgram: { deleteMany },
  } as never;

  beforeEach(() => vi.clearAllMocks());

  it('drops the program only from teachers with no other batch in it', async () => {
    findMany.mockResolvedValue([{ facultyId: 'still-teaches' }]);
    await pruneFacultyPrograms(tx, 'school-1', 'old-program', [
      'still-teaches',
      'moved-away',
    ]);
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        schoolId: 'school-1',
        programId: 'old-program',
        facultyId: { in: ['moved-away'] },
      },
    });
  });

  it('does nothing when every teacher keeps a batch there, or there are no teachers', async () => {
    findMany.mockResolvedValue([{ facultyId: 'a' }]);
    await pruneFacultyPrograms(tx, 'school-1', 'p', ['a']);
    await pruneFacultyPrograms(tx, 'school-1', 'p', []);
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
