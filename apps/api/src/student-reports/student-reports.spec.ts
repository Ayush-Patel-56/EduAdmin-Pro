import 'reflect-metadata';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { TeacherScope } from '../academic/access.service.js';
import type { AccessService } from '../academic/access.service.js';
import type { Actor } from '../assessments/actor.js';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { MarksService, checkSheet, sameName } from './marks.service.js';
import { RatingsService } from './ratings.service.js';
import { StudentReportService } from './student-report.service.js';
import { AdminStudentReportsController, TeacherRatingsController, TeacherStudentReportsController } from './student-reports.controller.js';
import { MarksImportDto, ProgressReportDto, RatingsDto } from './student-reports.dto.js';

const scope = (over: Partial<TeacherScope> = {}): TeacherScope => ({ schoolId: 'school-1', facultyId: 'fac-1', batchIds: ['b-mine'], programIds: [], active: true, ...over });
const admin: Actor = { kind: 'ADMIN', schoolId: 'school-1', userId: 'admin-1' };
const teacher = (over: Partial<TeacherScope> = {}): Actor => ({ kind: 'TEACHER', schoolId: 'school-1', userId: 'user-t', scope: scope(over) });

/** A raw query call (tagged template) as the statement Prisma would run. */
const asSql = (call: unknown[]) => Prisma.sql(call[0] as TemplateStringsArray, ...(call.slice(1) as Prisma.Sql[]));
/** Today in India, as YYYY-MM-DD. */
const istDay = (offsetDays = 0) => new Date(Date.now() + 5.5 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

function prismaMock() {
  const prisma = {
    school: { findUniqueOrThrow: vi.fn().mockResolvedValue({ academicYearStartMonth: 4 }) },
    batch: { findFirst: vi.fn().mockResolvedValue({ id: 'b-mine', name: 'JEE A' }), findMany: vi.fn().mockResolvedValue([]) },
    student: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
    faculty: { findUniqueOrThrow: vi.fn().mockResolvedValue({ name: 'Ms Rao' }) },
    user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ fullName: 'Admin One' }) },
    studentMark: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    progressReport: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null), upsert: vi.fn(), deleteMany: vi.fn() },
    dailyRating: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((run: (tx: typeof prisma) => unknown) => run(prisma));
  return prisma;
}

describe('Student Reports routes: who is asking is settled before any data is read', () => {
  const untouched = () =>
    new Proxy({}, { get: () => vi.fn(() => { throw new Error('a service was called before the permission check'); }) });
  const handlers = (c: object) => Object.getOwnPropertyNames(Object.getPrototypeOf(c)).filter((n) => n !== 'constructor' && n !== 'actor');

  it.each(handlers(new AdminStudentReportsController({} as AccessService, {} as never, {} as never)))('admin %s refuses a non-admin first', async (name) => {
    const assertAdmin = vi.fn().mockRejectedValue(new ForbiddenException('Only admins of this school can do this'));
    const c = new AdminStudentReportsController({ assertAdmin } as unknown as AccessService, untouched() as never, untouched() as never);
    const call = (c as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name];
    await expect(call.call(c, { userId: 'u' }, 'school-1', {}, {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(assertAdmin).toHaveBeenCalledWith('u', 'school-1');
  });

  it('covers every admin route (guards against a new route without the check)', () => {
    expect(handlers(new AdminStudentReportsController({} as AccessService, {} as never, {} as never)).length).toBe(13);
  });

  it.each(handlers(new TeacherStudentReportsController({} as AccessService, {} as never, {} as never)))('teacher %s works from the caller’s own membership', async (name) => {
    const teacherScope = vi.fn().mockRejectedValue(new ForbiddenException('Join a school'));
    const c = new TeacherStudentReportsController({ teacherScope } as unknown as AccessService, untouched() as never, untouched() as never);
    const call = (c as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name];
    await expect(call.call(c, { userId: 'u' }, {}, {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(teacherScope).toHaveBeenCalledWith('u');
  });

  it.each(handlers(new TeacherRatingsController({} as AccessService, {} as never)))('ratings %s works from the caller’s own membership', async (name) => {
    const teacherScope = vi.fn().mockRejectedValue(new ForbiddenException('Join a school'));
    const c = new TeacherRatingsController({ teacherScope } as unknown as AccessService, untouched() as never);
    const call = (c as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name];
    await expect(call.call(c, { userId: 'u' }, 'st-1', {})).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('Import student report: each row checked against the batch', () => {
  const roster = [
    { id: 's1', fullName: 'Aarav Mehta', rollNumber: 'R01' },
    { id: 's2', fullName: 'Diya Shah', rollNumber: 'R02' },
  ];

  it('matches roll numbers in any case, and names by full name or first name', () => {
    expect(sameName('Aarav Mehta', 'aarav  mehta.')).toBe(true);
    expect(sameName('Aarav Mehta', 'Aarav')).toBe(true);
    expect(sameName('Aarav Mehta', 'Mehta Aarav')).toBe(false);
    const { rows, ready } = checkSheet([{ rollNo: 'r01', name: 'Aarav', marks: '72.5', maxMarks: '100', attendance: '91%', remarks: '  Good  work ' }], { id: 'b-mine', name: 'JEE A' }, roster, new Map(), null);
    expect(rows[0]).toMatchObject({ row: 2, action: 'create', errors: [], label: 'R01 · Aarav Mehta' });
    expect(ready).toEqual([{ studentId: 's1', marks: 72.5, maxMarks: 100, attendance: 91, remarks: 'Good work' }]);
  });

  it('reports every problem of a row: missing cells, unknown roll, wrong name, repeats, marks over max, bad attendance', () => {
    const { rows, ready } = checkSheet(
      [
        { rollNo: '', name: '', marks: '', maxMarks: '' },
        { rollNo: 'R09', name: 'Ghost', marks: '5', maxMarks: '10' },
        { rollNo: 'R02', name: 'Zara', marks: '11', maxMarks: '10' },
        { rollNo: 'R01', name: 'Aarav', marks: '1.234', maxMarks: '0', attendance: '101' },
        { rollNo: 'R01', name: 'Aarav', marks: '5', maxMarks: '10' },
      ],
      { id: 'b-mine', name: 'JEE A' },
      roster,
      new Map([['s1', { batchId: 'b-mine', batchName: 'JEE A', enteredBy: 'Ms Rao' }]]),
      null,
    );
    expect(ready).toEqual([]);
    expect(rows.map((r) => r.errors)).toEqual([
      ['Roll No is required', 'Name is required', 'Marks is required', 'Max Marks is required'],
      ['No student with Roll No R09 in JEE A'],
      ['Roll No R02 is Diya Shah in JEE A, not Zara', "Marks (11) can't be more than Max Marks (10)"],
      ['Marks must be a number with up to two decimals', 'Max Marks must be more than 0 and at most 10000', 'Attendance must be a percentage from 0 to 100'],
      ['Roll No R01 appears twice in this file (row 5)'],
    ]);
  });

  it('a student who already has marks for the term and subject is an update', () => {
    const prior = new Map([['s1', { batchId: 'b-mine', batchName: 'JEE A', enteredBy: 'Ms Rao' }]]);
    expect(checkSheet([{ rollNo: 'R01', name: 'Aarav', marks: '5', maxMarks: '10' }], { id: 'b-mine', name: 'JEE A' }, roster, prior, null).rows[0]).toMatchObject({ action: 'update', label: 'R01 · Aarav Mehta' });
  });

  it("a mark entered in the student's old batch: an admin sees it replaced, a teacher who doesn't teach that batch can't replace it", () => {
    const prior = new Map([['s1', { batchId: 'b-old', batchName: 'JEE Old', enteredBy: 'Ravi Kumar' }]]);
    const row = [{ rollNo: 'R01', name: 'Aarav', marks: '10', maxMarks: '50' }];
    const asAdmin = checkSheet(row, { id: 'b-mine', name: 'JEE A' }, roster, prior, null);
    expect(asAdmin.rows[0]).toMatchObject({ action: 'update', label: 'R01 · Aarav Mehta (replaces the mark entered in JEE Old by Ravi Kumar)', errors: [] });
    expect(asAdmin.ready).toHaveLength(1);
    const asTeacher = checkSheet(row, { id: 'b-mine', name: 'JEE A' }, roster, prior, ['b-mine']);
    expect(asTeacher.rows[0]).toMatchObject({ action: 'error', errors: ["Aarav Mehta's mark for this term and subject was entered in JEE Old by Ravi Kumar; only an admin can replace it"] });
    expect(asTeacher.ready).toEqual([]);
    // A teacher who teaches both batches may, and sees what it replaces.
    expect(checkSheet(row, { id: 'b-mine', name: 'JEE A' }, roster, prior, ['b-mine', 'b-old']).rows[0].action).toBe('update');
  });

  it('the body: up to 1,000 rows, a known term and subject', () => {
    const errors = (body: object) => validateSync(plainToInstance(MarksImportDto, body)).map((e) => e.property);
    const ok = { batchId: '5f0c9a35-1d6b-4f8e-9c7a-2b1e3d4c5a6b', year: 2026, term: 'TERM_1', subject: 'Physics', dryRun: true, rows: [{ rollNo: '1' }] };
    expect(errors(ok)).toEqual([]);
    expect(errors({ ...ok, term: 'TERM_9', subject: 'Art' })).toEqual(['term', 'subject']);
    expect(errors({ ...ok, rows: Array.from({ length: 1001 }, () => ({})) })).toEqual(['rows']);
    expect(errors({ ...ok, rows: [] })).toEqual(['rows']);
  });
});

describe('MarksService: access and writes', () => {
  it('an inactive teacher or one outside the batch cannot upload; nothing is read', async () => {
    const prisma = prismaMock();
    const service = new MarksService(prisma as unknown as PrismaService);
    const dto = (batchId: string) => ({ batchId, year: 2026, term: 'TERM_1', subject: 'Physics', dryRun: false, rows: [] }) as unknown as MarksImportDto;
    await expect(service.importMarks(teacher({ active: false }), dto('b-mine'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.importMarks(teacher(), dto('b-other'))).rejects.toThrow("You aren't assigned to that batch");
    expect(prisma.student.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('a year not started yet, or more than four back, is refused', async () => {
    const service = new MarksService(prismaMock() as unknown as PrismaService);
    const dto = (year: number) => ({ batchId: 'b-mine', year, term: 'TERM_1', subject: 'Physics', dryRun: true, rows: [] }) as unknown as MarksImportDto;
    const now = new Date(Date.now() + 5.5 * 3_600_000);
    const current = now.getUTCMonth() + 1 >= 4 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
    await expect(service.importMarks(admin, dto(current + 1))).rejects.toThrow("hasn't started yet");
    await expect(service.importMarks(admin, dto(current - 5))).rejects.toThrow('Marks can be entered for');
  });

  it('a preview writes nothing; applying locks the batch, re-checks inside the transaction and upserts once', async () => {
    const prisma = prismaMock();
    prisma.student.findMany.mockResolvedValue([{ id: 's1', fullName: 'Aarav Mehta', rollNumber: 'R01' }]);
    const service = new MarksService(prisma as unknown as PrismaService);
    const now = new Date(Date.now() + 5.5 * 3_600_000);
    const year = now.getUTCMonth() + 1 >= 4 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
    const dto = (dryRun: boolean) => ({ batchId: 'b-mine', year, term: 'TERM_1', subject: 'Physics', dryRun, rows: [{ rollNo: 'R01', name: 'Aarav', marks: '8', maxMarks: '10' }] }) as unknown as MarksImportDto;
    await expect(service.importMarks(teacher(), dto(true))).resolves.toMatchObject({ applied: false, created: 1, skipped: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    await expect(service.importMarks(teacher(), dto(false))).resolves.toMatchObject({ applied: true, created: 1 });
    const lock = asSql(prisma.$queryRaw.mock.calls[0]);
    expect(lock.sql).toContain('FROM "Batch"');
    expect(lock.sql).toContain('FOR SHARE');
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.student.findMany.mock.invocationCallOrder[1]);
    // The batch and the roster are this school's.
    expect(prisma.batch.findFirst.mock.calls[0][0].where).toEqual({ id: 'b-mine', schoolId: 'school-1' });
    expect(prisma.student.findMany.mock.calls[0][0].where).toEqual({ schoolId: 'school-1', batchId: 'b-mine' });
    const upsert = asSql(prisma.$executeRaw.mock.calls[0]);
    expect(upsert.sql).toContain('ON CONFLICT ("studentId", "academicYear", "term", "subject")');
    expect(upsert.sql).toContain('"attendance" = EXCLUDED."attendance"');
    expect(upsert.values).toEqual(expect.arrayContaining(['school-1', 's1', 'b-mine', year, 'TERM_1', 'Physics', 8, 10, 'IMPORT', 'user-t', 'Ms Rao']));
  });

  it("every read is scoped: a teacher's batches, nothing at all while inactive", async () => {
    const prisma = prismaMock();
    const service = new MarksService(prisma as unknown as PrismaService);
    await service.sets(teacher(), {});
    expect(asSql(prisma.$queryRaw.mock.calls[0]).sql).toContain('m."batchId" IN (');
    expect(asSql(prisma.$queryRaw.mock.calls[0]).values).toContain('b-mine');
    prisma.$queryRaw.mockClear();
    await service.progressList(teacher({ active: false, batchIds: [] }), {});
    for (const call of prisma.$queryRaw.mock.calls) expect(asSql(call).sql).toContain('AND false');
    prisma.$queryRaw.mockClear();
    await service.overview(admin, {});
    for (const call of prisma.$queryRaw.mock.calls) {
      const sql = asSql(call);
      expect(sql.values).toContain('school-1');
      expect(sql.sql).not.toContain('AND false');
    }
    await expect(service.set(teacher(), { batchId: 'b-other', year: 2026, term: 'TERM_1', subject: 'Physics' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.roster(teacher(), 'b-other')).rejects.toBeInstanceOf(ForbiddenException);
  });

  const year = (() => {
    const now = new Date(Date.now() + 5.5 * 3_600_000);
    return now.getUTCMonth() + 1 >= 4 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  })();
  const reportBody = { studentId: 'st-1', year, term: 'TERM_1', subjects: [{ subject: 'Physics', marks: 40, maxMarks: 50 }], teacherRemarks: 'Good', principalRemarks: 'Well done' };
  const report = (over: Partial<typeof reportBody> = {}) => ({ ...reportBody, ...over }) as ProgressReportDto;

  it('a progress report: no subject twice, marks within the total', async () => {
    const service = new MarksService(prismaMock() as unknown as PrismaService);
    await expect(service.saveProgress(admin, report({ subjects: [{ subject: 'Physics', marks: 1, maxMarks: 5 }, { subject: 'Physics', marks: 2, maxMarks: 5 }] }))).rejects.toThrow('Each subject can be on the report once');
    await expect(service.saveProgress(admin, report({ subjects: [{ subject: 'Physics', marks: 6, maxMarks: 5 }] }))).rejects.toThrow("Physics: marks obtained can't be more than the total marks");
    const errors = validateSync(plainToInstance(ProgressReportDto, { ...reportBody, studentId: '5f0c9a35-1d6b-4f8e-9c7a-2b1e3d4c5a6b', subjects: [{ subject: 'Art', marks: -1, maxMarks: 0 }] }));
    expect(errors.map((e) => e.property)).toEqual(['subjects']);
  });

  it("a new report goes in the student's batch; a teacher of another batch is refused before anything changes", async () => {
    const prisma = prismaMock();
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'st-1', batchId: 'b-other' }]);
    const service = new MarksService(prisma as unknown as PrismaService);
    await expect(service.saveProgress(teacher(), report())).rejects.toThrow("You aren't assigned to this student's batch");
    expect(prisma.studentMark.deleteMany).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('an existing report stays in its batch; subjects left out go, and an edit keeps the sheet’s attendance and remarks', async () => {
    const prisma = prismaMock();
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'st-1', batchId: 'b-new' }]).mockResolvedValue([]);
    prisma.studentMark.findMany.mockResolvedValueOnce([{ batchId: 'b-mine', updatedAt: new Date('2026-09-01') }]);
    const service = new MarksService(prisma as unknown as PrismaService);
    await expect(service.saveProgress(teacher(), report())).resolves.toEqual({ created: false });
    expect(prisma.studentMark.deleteMany.mock.calls[0][0].where).toEqual({ schoolId: 'school-1', studentId: 'st-1', academicYear: year, term: 'TERM_1', subject: { notIn: ['Physics'] } });
    const upsert = asSql(prisma.$executeRaw.mock.calls[0]);
    expect(upsert.values).toContain('b-mine');
    expect(upsert.values).toContain('MANUAL');
    expect(upsert.sql).not.toContain('"attendance" = EXCLUDED');
    expect(prisma.progressReport.upsert.mock.calls[0][0]).toMatchObject({
      where: { studentId_academicYear_term: { studentId: 'st-1', academicYear: year, term: 'TERM_1' } },
      update: { teacherRemarks: 'Good', principalRemarks: 'Well done', updatedById: 'user-t', updatedBy: 'Ms Rao' },
    });
  });

  it("one card: a teacher of another batch, or an inactive one, gets not found", async () => {
    const prisma = prismaMock();
    const service = new MarksService(prisma as unknown as PrismaService);
    prisma.student.findFirst.mockResolvedValue({ id: 'st-1', fullName: 'Aarav', rollNumber: 'R01', batchId: 'b-other' });
    prisma.studentMark.findMany.mockResolvedValue([{ subject: 'Physics', marks: 40, maxMarks: 50, batchId: 'b-other', updatedAt: new Date() }]);
    prisma.progressReport.findFirst.mockResolvedValue({ teacherRemarks: 'Private', principalRemarks: null });
    const key = { studentId: 'st-1', year: 2026, term: 'TERM_1' as const };
    await expect(service.progressOne(teacher(), key)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.progressOne(teacher({ active: false, batchIds: [] }), key)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.student.findFirst.mock.calls[0][0].where).toEqual({ id: 'st-1', schoolId: 'school-1' });
    // The batch's own teacher and an admin read it.
    await expect(service.progressOne(teacher({ batchIds: ['b-other'] }), key)).resolves.toMatchObject({ batchId: 'b-other', teacherRemarks: 'Private' });
    await expect(service.progressOne(admin, key)).resolves.toMatchObject({ exists: true });
  });

  it("a moved student's card: the new batch's teacher can't change or remove marks entered in the old batch, only their own", async () => {
    const old = { subject: 'Physics', marks: 44, maxMarks: 50, batchId: 'b-old', updatedAt: new Date('2026-07-01'), batch: { name: 'JEE Old' } };
    const mine = { subject: 'Mathematics', marks: 30, maxMarks: 50, batchId: 'b-mine', updatedAt: new Date('2026-09-01'), batch: { name: 'JEE A' } };
    const setup = () => {
      const prisma = prismaMock();
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'st-1', batchId: 'b-mine' }]).mockResolvedValue([]);
      prisma.studentMark.findMany.mockResolvedValueOnce([old, mine]);
      return { prisma, service: new MarksService(prisma as unknown as PrismaService) };
    };
    let t = setup();
    await expect(t.service.saveProgress(teacher(), report({ subjects: [{ subject: 'Mathematics', marks: 35, maxMarks: 50 }] }))).rejects.toThrow('Physics was entered in JEE Old; only an admin can remove it');
    expect(t.prisma.studentMark.deleteMany).not.toHaveBeenCalled();
    t = setup();
    await expect(t.service.saveProgress(teacher(), report({ subjects: [{ subject: 'Physics', marks: 10, maxMarks: 50 }, { subject: 'Mathematics', marks: 30, maxMarks: 50 }] }))).rejects.toThrow('Physics was entered in JEE Old; only an admin can change it');
    expect(t.prisma.$executeRaw).not.toHaveBeenCalled();
    // Keeping the old mark as it is, the teacher's own changes save: only the changed row is written, in its own batch.
    t = setup();
    await t.service.saveProgress(teacher(), report({ subjects: [{ subject: 'Physics', marks: 44, maxMarks: 50 }, { subject: 'Mathematics', marks: 35, maxMarks: 50 }] }));
    const upsert = asSql(t.prisma.$executeRaw.mock.calls[0]);
    expect(upsert.values).toContain('Mathematics');
    expect(upsert.values).not.toContain('Physics');
    expect(upsert.values).toContain('b-mine');
    // An admin may change the old mark; it stays in the batch it was entered in.
    t = setup();
    await t.service.saveProgress(admin, report({ subjects: [{ subject: 'Physics', marks: 10, maxMarks: 50 }, { subject: 'Mathematics', marks: 30, maxMarks: 50 }] }));
    const adminUpsert = asSql(t.prisma.$executeRaw.mock.calls[0]);
    expect(adminUpsert.values).toEqual(expect.arrayContaining(['Physics', 'b-old']));
    expect(adminUpsert.values).not.toContain('Mathematics');
    // Deleting the card: refused for the teacher, allowed for an admin.
    const del = prismaMock();
    del.studentMark.findMany.mockResolvedValue([old, mine]);
    const delService = new MarksService(del as unknown as PrismaService);
    await expect(delService.removeProgress(teacher(), { studentId: 'st-1', year: 2026, term: 'TERM_1' })).rejects.toThrow("Some of this report's marks were entered in JEE Old; only an admin can delete them");
    expect(del.studentMark.deleteMany).not.toHaveBeenCalled();
    await expect(delService.removeProgress(admin, { studentId: 'st-1', year: 2026, term: 'TERM_1' })).resolves.toEqual({ ok: true });
  });

  it('a student or batch removed mid-save is a 400, not a 500', async () => {
    const prisma = prismaMock();
    prisma.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Foreign key constraint violated', { code: 'P2003', clientVersion: '7' }));
    const service = new MarksService(prisma as unknown as PrismaService);
    await expect(service.saveProgress(admin, report())).rejects.toThrow('The student or batch was just changed. Refresh and try again.');
  });

  it("an inactive teacher's write is refused with a student-reports message", async () => {
    const service = new MarksService(prismaMock() as unknown as PrismaService);
    await expect(service.removeSet(teacher({ active: false }), { batchId: 'b-mine', year: 2026, term: 'TERM_1', subject: 'Physics' })).rejects.toThrow('Only active faculty can change student reports');
  });

  it('deleting a report or a sheet: a teacher only in their batches, and only while active', async () => {
    const prisma = prismaMock();
    const service = new MarksService(prisma as unknown as PrismaService);
    prisma.studentMark.findMany.mockResolvedValueOnce([{ batchId: 'b-other', updatedAt: new Date() }]);
    await expect(service.removeProgress(teacher(), { studentId: 'st-1', year: 2026, term: 'TERM_1' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.removeSet(teacher({ active: false }), { batchId: 'b-mine', year: 2026, term: 'TERM_1', subject: 'Physics' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.removeSet(teacher(), { batchId: 'b-other', year: 2026, term: 'TERM_1', subject: 'Physics' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.studentMark.deleteMany).not.toHaveBeenCalled();
  });

  it('a deleted sheet takes the remarks of reports left with no marks, and keeps the others', async () => {
    const prisma = prismaMock();
    prisma.studentMark.findMany.mockResolvedValueOnce([{ studentId: 's1' }, { studentId: 's2' }]).mockResolvedValueOnce([{ studentId: 's1' }]);
    const service = new MarksService(prisma as unknown as PrismaService);
    await expect(service.removeSet(admin, { batchId: 'b-mine', year: 2026, term: 'TERM_1', subject: 'Physics' })).resolves.toEqual({ deleted: 2 });
    expect(prisma.progressReport.deleteMany.mock.calls[0][0].where).toEqual({ schoolId: 'school-1', academicYear: 2026, term: 'TERM_1', studentId: { in: ['s2'] } });
  });
});

describe('RatingsService (Student Ratings)', () => {
  const dto = (over: Partial<RatingsDto> = {}) =>
    ({ date: istDay(), batchId: 'b-mine', ratings: [{ studentId: 's1', attitude: 5, behaviour: 4, focus: 4, interaction: 3, notes: null }], ...over }) as RatingsDto;

  it('an inactive teacher sees an empty grid and cannot save', async () => {
    const prisma = prismaMock();
    const service = new RatingsService(prisma as unknown as PrismaService);
    await expect(service.sheet(scope({ active: false, batchIds: [] }), { date: istDay(), batchId: 'b-mine' })).resolves.toEqual({ date: istDay(), students: [] });
    await expect(service.options(scope({ active: false }))).resolves.toMatchObject({ active: false, batches: [] });
    await expect(service.save(scope({ active: false }), dto())).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.student.findMany).not.toHaveBeenCalled();
  });

  it("another batch, a future day, or a student twice is refused before anything is written", async () => {
    const prisma = prismaMock();
    const service = new RatingsService(prisma as unknown as PrismaService);
    await expect(service.sheet(scope(), { date: istDay(), batchId: 'b-other' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.save(scope(), dto({ batchId: 'b-other' }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.save(scope(), dto({ date: istDay(1) }))).rejects.toThrow("You can't rate a day that hasn't come yet");
    const twice = { studentId: 's1', attitude: 3, behaviour: 3, focus: 3, interaction: 3 };
    await expect(service.save(scope(), dto({ ratings: [twice, twice] }))).rejects.toThrow('Each student can be rated once per save');
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('students must be active in the batch now, and the day on or after it began', async () => {
    const prisma = prismaMock();
    const service = new RatingsService(prisma as unknown as PrismaService);
    prisma.$queryRaw.mockResolvedValueOnce([{ startDate: new Date(`${istDay(1)}T00:00:00Z`) }]);
    await expect(service.save(scope(), dto())).rejects.toThrow('Pick a day on or after the batch started');
    prisma.$queryRaw.mockResolvedValueOnce([{ startDate: new Date('2026-04-01T00:00:00Z'), endDate: new Date('2026-04-30T00:00:00Z') }]);
    await expect(service.save(scope(), dto({ date: '2026-05-01' }))).rejects.toThrow('Pick a day on or before the batch ended (30 Apr 2026)');
    prisma.$queryRaw.mockResolvedValueOnce([{ startDate: new Date('2026-04-01T00:00:00Z'), endDate: null }]).mockResolvedValueOnce([]);
    await expect(service.save(scope(), dto())).rejects.toBeInstanceOf(BadRequestException);
    const check = asSql(prisma.$queryRaw.mock.calls[3]);
    expect(check.sql).toContain('"status" = \'ACTIVE\'');
    expect(check.sql).toContain('FOR SHARE');
    expect(check.values).toEqual(expect.arrayContaining(['s1', 'school-1', 'b-mine']));
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('the day the batch ended can be rated, the day after it cannot', async () => {
    const prisma = prismaMock();
    const service = new RatingsService(prisma as unknown as PrismaService);
    const batch = { startDate: new Date('2026-04-01T00:00:00Z'), endDate: new Date('2026-04-30T00:00:00Z') };
    prisma.$queryRaw.mockResolvedValueOnce([batch]).mockResolvedValueOnce([{ id: 's1' }]);
    await expect(service.save(scope(), dto({ date: '2026-04-30' }))).resolves.toEqual({ saved: 1 });
    prisma.$queryRaw.mockResolvedValueOnce([batch]);
    await expect(service.save(scope(), dto({ date: '2026-05-01' }))).rejects.toThrow('Pick a day on or before the batch ended (30 Apr 2026)');
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("saves one row per student for the day and this teacher, updating the teacher's own rating", async () => {
    const prisma = prismaMock();
    prisma.$queryRaw.mockResolvedValueOnce([{ startDate: new Date('2026-04-01T00:00:00Z') }]).mockResolvedValueOnce([{ id: 's1' }]);
    const service = new RatingsService(prisma as unknown as PrismaService);
    await expect(service.save(scope(), dto())).resolves.toEqual({ saved: 1 });
    const upsert = asSql(prisma.$executeRaw.mock.calls[0]);
    expect(upsert.sql).toContain('ON CONFLICT ("studentId", "date", "facultyId") DO UPDATE');
    expect(upsert.values).toEqual(expect.arrayContaining(['school-1', 's1', 'b-mine', 'fac-1', 'Ms Rao', 5, 4, 3]));
  });

  it("the grid shows only this teacher's ratings; clearing one is scoped to them and their batches", async () => {
    const prisma = prismaMock();
    const service = new RatingsService(prisma as unknown as PrismaService);
    await service.sheet(scope(), { date: '2026-10-17', batchId: 'b-mine' });
    expect(prisma.dailyRating.findMany.mock.calls[0][0].where).toEqual({ schoolId: 'school-1', date: new Date('2026-10-17T00:00:00Z'), facultyId: 'fac-1', batchId: 'b-mine' });
    await service.remove(scope(), 's1', '2026-10-17');
    expect(prisma.dailyRating.deleteMany.mock.calls[0][0].where).toEqual({ schoolId: 'school-1', studentId: 's1', date: new Date('2026-10-17T00:00:00Z'), facultyId: 'fac-1', batchId: { in: ['b-mine'] } });
    prisma.dailyRating.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.remove(scope(), 's1', '2026-10-17')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('levels are 1 to 5 and a save holds at most 500 students', () => {
    const errors = (body: object) => validateSync(plainToInstance(RatingsDto, body)).map((e) => e.property);
    const ok = { date: '2026-10-17', batchId: '5f0c9a35-1d6b-4f8e-9c7a-2b1e3d4c5a6b', ratings: [{ studentId: '5f0c9a35-1d6b-4f8e-9c7a-2b1e3d4c5a6b', attitude: 1, behaviour: 5, focus: 3, interaction: 2 }] };
    expect(errors(ok)).toEqual([]);
    expect(errors({ ...ok, ratings: [{ ...ok.ratings[0], attitude: 0, focus: 6 }] })).toEqual(['ratings']);
    expect(errors({ ...ok, ratings: Array.from({ length: 501 }, () => ok.ratings[0]) })).toEqual(['ratings']);
  });
});

describe('StudentReportService: the hub', () => {
  it("a teacher searches only their batches; an inactive one (no batches) finds no one without a query", async () => {
    const prisma = prismaMock();
    const service = new StudentReportService(prisma as unknown as PrismaService);
    await service.search(teacher(), { q: '50%' });
    expect(prisma.student.findMany.mock.calls[0][0]).toMatchObject({
      where: { schoolId: 'school-1', batchId: { in: ['b-mine'] }, OR: [{ fullName: { contains: '50\\%' } }, { rollNumber: { contains: '50\\%' } }, { admissionNumber: { contains: '50\\%' } }] },
      take: 20,
    });
    // Only the picker's fields.
    expect(Object.keys(prisma.student.findMany.mock.calls[0][0].select).sort()).toEqual(['batch', 'fullName', 'id', 'rollNumber', 'status']);
    await expect(service.search(teacher({ active: false, batchIds: [] }), {})).resolves.toEqual([]);
    await expect(service.search(teacher(), { batchId: 'b-other' })).resolves.toEqual([]);
    expect(prisma.student.findMany).toHaveBeenCalledTimes(1);
  });

  it("a student outside the teacher's batches (or school) is not found, and nothing else is read", async () => {
    const prisma = prismaMock();
    prisma.student.findFirst.mockResolvedValue(null);
    const service = new StudentReportService(prisma as unknown as PrismaService);
    await expect(service.report(teacher(), 'st-x')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.student.findFirst.mock.calls[0][0].where).toEqual({ id: 'st-x', schoolId: 'school-1', batchId: { in: ['b-mine'] } });
    await expect(service.report(admin, 'st-x')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.student.findFirst.mock.calls[1][0].where).toEqual({ id: 'st-x', schoolId: 'school-1' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
