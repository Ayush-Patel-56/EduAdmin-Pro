import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '../generated/prisma/client.js';
import type { TeacherScope } from '../academic/access.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { DailyReportDto, ReportFlagDto } from './daily-reports.dto.js';
import { DailyReportsService, isLate, pendingReports } from './daily-reports.service.js';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
// 18 Oct 2026, 10:30 in India.
const NOW = new Date('2026-10-18T05:00:00Z');
const scope = (over: Partial<TeacherScope> = {}): TeacherScope => ({
  schoolId: 'school-1',
  facultyId: 'fac-1',
  batchIds: ['b1', 'b2'],
  programIds: ['p1'],
  active: true,
  ...over,
});
const dto = (over: Partial<DailyReportDto> = {}) =>
  ({ date: '2026-10-18', batchId: 'b1', subject: 'Physics', chapter: 'Kinematics', topics: 'Projectile motion', homework: null, observations: null, ...over }) as DailyReportDto;
const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  facultyId: 'fac-1',
  teacherName: 'Ayush',
  batchId: 'b1',
  batch: { id: 'b1', name: 'Batch 1A', program: { id: 'p1', name: 'JEE' } },
  reportDate: d('2026-10-18'),
  subject: 'Physics',
  chapter: 'Kinematics',
  topics: 'Projectile motion',
  homework: null,
  observations: null,
  late: false,
  submittedAt: new Date('2026-10-18T04:45:00Z'),
  editedAt: null,
  flaggedAt: null,
  flaggedBy: null,
  flagReason: null,
  updatedAt: new Date('2026-10-18T04:45:00Z'),
  ...over,
});
const dup = () =>
  new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 't', meta: { target: ['DailyReport_one_per_class_key'] } });

function build() {
  const prisma = {
    dailyReport: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue({ batchId: 'b1', reportDate: d('2026-10-18'), submittedAt: new Date('2026-10-18T04:45:00Z') }),
      create: vi.fn().mockResolvedValue({ id: 'r1', late: false }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    faculty: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ name: 'Ayush' }),
      findUnique: vi.fn().mockResolvedValue({ primarySubject: 'Physics', subjects: ['Physics', 'Mathematics'] }),
    },
    batch: { findMany: vi.fn().mockResolvedValue([{ id: 'b1', name: 'Batch 1A', program: { name: 'JEE' } }]) },
    scheduleSlot: { findMany: vi.fn().mockResolvedValue([{ subject: 'physics' }, { subject: 'Chemistry' }]) },
    specialClass: { findMany: vi.fn().mockResolvedValue([{ subject: 'Doubt Solving' }]) },
    // The locked batch: started 1 Apr 2026, no end date.
    $queryRaw: vi.fn().mockResolvedValue([{ startDate: d('2026-04-01'), endDate: null }]),
    user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ fullName: 'Principal Mehta' }) },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((run: (tx: typeof prisma) => unknown) => run(prisma));
  return { prisma, service: new DailyReportsService(prisma as unknown as PrismaService) };
}

beforeEach(() => vi.useFakeTimers({ now: NOW }));
afterEach(() => vi.useRealTimers());

describe('the On Time / Late rule', () => {
  it('is On Time only when submitted on the day taught, in India', () => {
    // 00:01 IST on the 18th, for the 18th.
    expect(isLate(d('2026-10-18'), new Date('2026-10-17T18:31:00Z'))).toBe(false);
    // 23:59 IST on the 18th.
    expect(isLate(d('2026-10-18'), new Date('2026-10-18T18:29:00Z'))).toBe(false);
    // 00:00 IST on the 19th: the next day, so Late.
    expect(isLate(d('2026-10-18'), new Date('2026-10-18T18:30:00Z'))).toBe(true);
    // A report for an earlier day is Late.
    expect(isLate(d('2026-10-17'), NOW)).toBe(true);
  });

  it("counts today's classes still waiting for a report, one per batch and subject", () => {
    const c = (batch: string, subject: string | null) => ({ batch: { id: batch }, subject });
    expect(pendingReports([c('b1', 'Physics'), c('b1', 'Physics'), c('b2', 'Physics'), c('b1', null)], [{ batchId: 'b1', subject: 'PHYSICS' }])).toBe(1);
    expect(pendingReports([c('b1', null)], [])).toBe(1);
    expect(pendingReports([], [])).toBe(0);
  });
});

describe('DailyReportsService: faculty', () => {
  it('submits a report for today as On Time, naming the teacher, under a shared lock on the batch', async () => {
    const { service, prisma } = build();
    await expect(service.submit(scope(), dto({ homework: 'Exercise 3.2' }))).resolves.toEqual({ id: 'r1', late: false });
    const [sql, ...values] = prisma.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(sql.join('?')).toMatch(/SELECT "startDate", "endDate" FROM "Batch" WHERE "id" = \? AND "schoolId" = \? FOR SHARE/);
    expect(values).toEqual(['b1', 'school-1']);
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.dailyReport.create.mock.invocationCallOrder[0]);
    expect(prisma.dailyReport.create.mock.calls[0][0].data).toEqual({
      schoolId: 'school-1',
      facultyId: 'fac-1',
      teacherName: 'Ayush',
      batchId: 'b1',
      reportDate: d('2026-10-18'),
      subject: 'Physics',
      chapter: 'Kinematics',
      topics: 'Projectile motion',
      homework: 'Exercise 3.2',
      observations: null,
      late: false,
      submittedAt: NOW,
    });
  });

  it("a previous day's report is Late; a day still to come is refused", async () => {
    const { service, prisma } = build();
    await service.submit(scope(), dto({ date: '2026-10-17' }));
    expect(prisma.dailyReport.create.mock.calls[0][0].data).toMatchObject({ reportDate: d('2026-10-17'), late: true, submittedAt: NOW });
    await expect(service.submit(scope(), dto({ date: '2026-10-19' }))).rejects.toThrow("You can't report a day that hasn't happened yet");
    await expect(service.submit(scope(), dto({ date: '2026-02-30' }))).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.dailyReport.create).toHaveBeenCalledTimes(1);
  });

  it('a report is for a day its batch ran: not before it started (2020-01-01), nor after it ended; the same when an edit moves it', async () => {
    const { service, prisma } = build();
    await expect(service.submit(scope(), dto({ date: '2020-01-01' }))).rejects.toEqual(new BadRequestException('This batch started on 1 Apr 2026; pick a day from then'));
    await expect(service.submit(scope(), dto({ date: '2026-04-01' }))).resolves.toEqual({ id: 'r1', late: false });
    prisma.$queryRaw.mockResolvedValueOnce([{ startDate: d('2026-04-01'), endDate: d('2026-09-30') }]);
    await expect(service.submit(scope(), dto({ date: '2026-10-01' }))).rejects.toThrow('This batch ended on 30 Sept 2026; pick a day up to then');
    await expect(service.update(scope(), 'r1', dto({ date: '2026-03-31' }))).rejects.toThrow('This batch started on 1 Apr 2026');
    expect(prisma.dailyReport.updateMany).not.toHaveBeenCalled();
  });

  it('only for a batch assigned to the teacher, and only while their profile is active', async () => {
    const { service, prisma } = build();
    await expect(service.submit(scope(), dto({ batchId: 'b-other' }))).rejects.toThrow("You aren't assigned to that batch");
    await expect(service.submit(scope({ active: false }), dto())).rejects.toThrow('Only active faculty can submit daily reports');
    await expect(service.submit(scope({ facultyId: null }), dto())).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.dailyReport.create).not.toHaveBeenCalled();
  });

  it('a batch deleted meanwhile is a 400; a second report for the same class and day is a 409', async () => {
    const { service, prisma } = build();
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await expect(service.submit(scope(), dto())).rejects.toThrow('Select one of your batches');
    expect(prisma.dailyReport.create).not.toHaveBeenCalled();
    prisma.dailyReport.create.mockRejectedValueOnce(dup());
    await expect(service.submit(scope(), dto())).rejects.toEqual(
      new ConflictException('You already submitted a Physics report for this batch on that date. Edit it in Your Recent Submissions instead.'),
    );
  });

  it('editing keeps when it was submitted, so an On Time report stays On Time', async () => {
    const { service, prisma } = build();
    // Edited on the 20th, still about the 18th, first sent on the 18th.
    vi.setSystemTime(new Date('2026-10-20T06:00:00Z'));
    await expect(service.update(scope(), 'r1', dto({ topics: 'Projectile motion and range' }))).resolves.toEqual({ id: 'r1', late: false });
    const call = prisma.dailyReport.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'r1', schoolId: 'school-1', facultyId: 'fac-1' });
    expect(call.data).toMatchObject({ reportDate: d('2026-10-18'), submittedAt: new Date('2026-10-18T04:45:00Z'), late: false, topics: 'Projectile motion and range' });
    // The content changed now, which is what "Edited" shows (an admin's flag doesn't count).
    expect(call.data.editedAt).toEqual(new Date('2026-10-20T06:00:00Z'));
  });

  it('an edit can only move a report to a batch still assigned to the teacher', async () => {
    const { service, prisma } = build();
    await expect(service.update(scope(), 'r1', dto({ batchId: 'b-other' }))).rejects.toEqual(new ForbiddenException("You aren't assigned to that batch"));
    expect(prisma.dailyReport.updateMany).not.toHaveBeenCalled();
  });

  it('moving a report to another day makes it a report for that day, submitted now', async () => {
    const { service, prisma } = build();
    vi.setSystemTime(new Date('2026-10-20T06:00:00Z'));
    await expect(service.update(scope(), 'r1', dto({ date: '2026-10-19' }))).resolves.toEqual({ id: 'r1', late: true });
    expect(prisma.dailyReport.updateMany.mock.calls[0][0].data).toMatchObject({ reportDate: d('2026-10-19'), submittedAt: new Date('2026-10-20T06:00:00Z'), editedAt: null, late: true });
    await expect(service.update(scope(), 'r1', dto({ date: '2026-10-20' }))).resolves.toEqual({ id: 'r1', late: false });
  });

  it("another teacher's report, or one for a batch they've left, can't be edited or deleted", async () => {
    const { service, prisma } = build();
    prisma.dailyReport.findFirst.mockResolvedValueOnce(null);
    await expect(service.update(scope(), 'r-x', dto())).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.dailyReport.findFirst.mock.calls[0][0].where).toEqual({ id: 'r-x', schoolId: 'school-1', facultyId: 'fac-1' });
    prisma.dailyReport.findFirst.mockResolvedValueOnce({ batchId: 'b-old', reportDate: d('2026-10-18'), submittedAt: NOW });
    await expect(service.remove(scope(), 'r1')).rejects.toThrow("no longer assigned");
    expect(prisma.dailyReport.updateMany).not.toHaveBeenCalled();
    expect(prisma.dailyReport.deleteMany).not.toHaveBeenCalled();
  });

  it('edits and deletes are scoped in the write: one deleted meanwhile is a 404, not a 500', async () => {
    const { service, prisma } = build();
    prisma.dailyReport.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.update(scope(), 'r1', dto())).rejects.toThrow('Report not found');
    prisma.dailyReport.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.remove(scope(), 'r1')).rejects.toThrow('Report not found');
    expect(prisma.dailyReport.deleteMany.mock.calls[0][0].where).toEqual({ id: 'r1', schoolId: 'school-1', facultyId: 'fac-1' });
    await expect(service.remove(scope(), 'r1')).resolves.toEqual({ ok: true });
  });

  it("the form's choices: today in India, the teacher's batches, their subjects then their timetable's, then General", async () => {
    const { service, prisma } = build();
    vi.setSystemTime(new Date('2026-10-18T19:00:00Z')); // 00:30 IST on the 19th
    await expect(service.options(scope())).resolves.toEqual({
      today: '2026-10-19',
      active: true,
      batches: [{ id: 'b1', name: 'Batch 1A', program: 'JEE' }],
      subjects: ['Physics', 'Mathematics', 'Chemistry', 'Doubt Solving', 'General'],
    });
    expect(prisma.batch.findMany.mock.calls[0][0].where).toEqual({ schoolId: 'school-1', id: { in: ['b1', 'b2'] } });
    await expect(service.options(scope({ active: false }))).resolves.toMatchObject({ active: false, batches: [] });
  });

  it('Your Recent Submissions lists only the teacher’s own reports, newest day first', async () => {
    const { service, prisma } = build();
    prisma.dailyReport.findMany.mockResolvedValue([row()]);
    const [r] = await service.teacherList(scope());
    expect(r).toEqual({
      id: 'r1',
      date: '2026-10-18',
      teacher: { id: 'fac-1', name: 'Ayush' },
      batch: { id: 'b1', name: 'Batch 1A' },
      program: { id: 'p1', name: 'JEE' },
      subject: 'Physics',
      chapter: 'Kinematics',
      topics: 'Projectile motion',
      homework: null,
      observations: null,
      late: false,
      submittedAt: '2026-10-18T04:45:00.000Z',
      edited: false,
    });
    const args = prisma.dailyReport.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ schoolId: 'school-1', facultyId: 'fac-1' });
    expect(args.orderBy).toEqual([{ reportDate: 'desc' }, { submittedAt: 'desc' }]);
    await expect(service.teacherList(scope({ facultyId: null }))).resolves.toEqual([]);
  });
});

describe('DailyReportsService: admin', () => {
  it('one day of the school: KPIs over the whole day, the status tab narrows only the list', async () => {
    const { service, prisma } = build();
    prisma.dailyReport.findMany.mockResolvedValue([
      row(),
      row({ id: 'r2', late: true, batchId: 'b2', batch: { id: 'b2', name: 'Batch 2A', program: { id: 'p1', name: 'JEE' } } }),
      row({ id: 'r3', subject: 'Chemistry', editedAt: new Date('2026-10-18T09:00:00Z'), updatedAt: new Date('2026-10-18T09:00:00Z') }),
      row({ id: 'r4', facultyId: null, teacherName: 'Former Teacher', subject: 'physics', flaggedAt: new Date('2026-10-18T10:00:00Z'), flaggedBy: 'Principal Mehta', flagReason: 'Topics too brief', updatedAt: new Date('2026-10-18T10:00:00Z') }),
    ]);
    const all = await service.adminList('school-1', { date: '2026-10-18' });
    // Classes: Batch 1A Physics (r1, r4 in any case), Batch 2A Physics, Batch 1A Chemistry.
    expect(all.kpis).toEqual({ submitted: 4, late: 1, teachers: 2, classes: 3, flagged: 1 });
    expect(all.items.map((i) => i.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(all.items[2].edited).toBe(true);
    // Flagging changed r4's updatedAt, but it isn't "edited".
    expect(all.items[3]).toMatchObject({ edited: false, flag: { at: '2026-10-18T10:00:00.000Z', by: 'Principal Mehta', reason: 'Topics too brief' } });
    expect(all.items[0].flag).toBeNull();
    const flagged = await service.adminList('school-1', { date: '2026-10-18', status: 'FLAGGED' });
    expect(flagged.items.map((i) => i.id)).toEqual(['r4']);
    expect(prisma.dailyReport.findMany.mock.calls[0][0].where).toEqual({ schoolId: 'school-1', reportDate: d('2026-10-18') });
    const late = await service.adminList('school-1', { date: '2026-10-18', status: 'LATE' });
    expect(late.items.map((i) => i.id)).toEqual(['r2']);
    expect(late.kpis.submitted).toBe(4);
    const onTime = await service.adminList('school-1', { date: '2026-10-18', status: 'ON_TIME' });
    expect(onTime.items.map((i) => i.id)).toEqual(['r1', 'r3', 'r4']);
  });

  it('follows the program and batch filters, always within the school', async () => {
    const { service, prisma } = build();
    await service.adminList('school-1', { date: '2026-10-18', programId: 'p1' });
    await service.adminList('school-1', { date: '2026-10-18', programId: 'p1', batchId: 'b2' });
    expect(prisma.dailyReport.findMany.mock.calls[0][0].where).toEqual({ schoolId: 'school-1', reportDate: d('2026-10-18'), batch: { programId: 'p1' } });
    expect(prisma.dailyReport.findMany.mock.calls[1][0].where).toEqual({ schoolId: 'school-1', reportDate: d('2026-10-18'), batchId: 'b2' });
    await expect(service.adminList('school-1', { date: '2026-13-01' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('DailyReportsService: admin flags and deletes', () => {
  it('flags a report with who, when and why, and clears it; scoped to the school', async () => {
    const { service, prisma } = build();
    await expect(service.setFlag('school-1', 'u-admin', 'r1', { flagged: true, reason: 'Topics too brief' })).resolves.toEqual({ id: 'r1', flagged: true });
    expect(prisma.dailyReport.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'r1', schoolId: 'school-1' },
      data: { flaggedAt: NOW, flaggedBy: 'Principal Mehta', flaggedById: 'u-admin', flagReason: 'Topics too brief' },
    });
    await service.setFlag('school-1', 'u-admin', 'r1', { flagged: false });
    expect(prisma.dailyReport.updateMany.mock.calls[1][0].data).toEqual({ flaggedAt: null, flaggedBy: null, flaggedById: null, flagReason: null });
    // The flag never touches the report's content or its edited time.
    expect(prisma.dailyReport.updateMany.mock.calls[0][0].data).not.toHaveProperty('editedAt');
    prisma.dailyReport.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.setFlag('school-1', 'u-admin', 'r-x', { flagged: true })).rejects.toEqual(new NotFoundException('Report not found'));
  });

  it('admins delete any report of their school', async () => {
    const { service, prisma } = build();
    await expect(service.adminRemove('school-1', 'r1')).resolves.toEqual({ ok: true });
    expect(prisma.dailyReport.deleteMany).toHaveBeenCalledWith({ where: { id: 'r1', schoolId: 'school-1' } });
    prisma.dailyReport.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.adminRemove('school-1', 'r-other-school')).rejects.toThrow('Report not found');
  });

  it('a flag reason is optional, at most 500 characters', async () => {
    const msgs = async (plain: object) => (await validate(plainToInstance(ReportFlagDto, plain))).map((e) => Object.values(e.constraints ?? {})[0]);
    expect(await msgs({ flagged: true })).toEqual([]);
    expect(await msgs({ flagged: true, reason: 'x'.repeat(501) })).toEqual(['Keep the reason under 500 characters']);
    expect(await msgs({})).toEqual(['Say whether to flag the report']);
  });
});

describe('DailyReportDto', () => {
  const errors = async (plain: object) => {
    const list = await validate(plainToInstance(DailyReportDto, plain));
    // Like main.ts: the first message of each field.
    return Object.fromEntries(list.map((e) => [e.property, Object.values(e.constraints ?? {})[0]]));
  };

  it('needs a date, batch, subject and topics, with clear messages', async () => {
    expect(await errors({ date: '', batchId: 'x', subject: '  ', topics: '' })).toEqual({
      date: 'Pick the date taught',
      batchId: 'Select a batch',
      subject: 'Select a subject',
      topics: 'Describe the topics covered',
    });
  });

  it('keeps line breaks in topics and turns blank optional fields into null', () => {
    const out = plainToInstance(DailyReportDto, { date: '2026-10-18', batchId: 'b1', subject: 'Physics', topics: '  Projectile  motion\n\n\n\nRange  ', homework: '   ', chapter: '' });
    expect(out.topics).toBe('Projectile motion\n\nRange');
    expect(out.homework).toBeNull();
    expect(out.chapter).toBeNull();
  });
});
