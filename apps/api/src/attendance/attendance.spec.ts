import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { TeacherScope } from '../academic/access.service.js';
import { istToday } from '../common/dates.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { DayClass, ScheduleService } from '../schedule/schedule.service.js';
import type { FilesService } from '../storage/files.service.js';
import type { SubmitAttendanceDto } from './attendance.dto.js';
import { AttendanceService } from './attendance.service.js';

const scope = (over: Partial<TeacherScope> = {}): TeacherScope => ({
  schoolId: 'school-1',
  facultyId: 'fac-1',
  batchIds: ['b1'],
  programIds: ['p1'],
  active: true,
  ...over,
});
const SLOT = '00000000-0000-4000-8000-000000000001';
const cls: DayClass = {
  key: `slot:${SLOT}`,
  kind: 'SLOT',
  id: SLOT,
  title: 'Physics',
  subject: 'Physics',
  type: null,
  batch: { id: 'b1', name: 'Batch 1A', program: 'JEE' },
  teacher: { id: 'fac-1', name: 'Anita' },
  startMinute: 600,
  endMinute: 660,
  time: '10:00 AM - 11:00 AM',
  room: 'R1',
};
const today = istToday().toISOString().slice(0, 10);
const dto = (records: SubmitAttendanceDto['records'], over: Partial<SubmitAttendanceDto> = {}) =>
  ({ date: today, class: cls.key, records, ...over }) as SubmitAttendanceDto;

function build() {
  const prisma = {
    classOccurrence: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'occ-new' }),
      update: vi.fn().mockResolvedValue({ id: 'occ-1' }),
    },
    attendanceRecord: { deleteMany: vi.fn(), createMany: vi.fn() },
    student: { findMany: vi.fn().mockResolvedValue([{ id: 'st-1' }, { id: 'st-2' }]) },
    batch: { findMany: vi.fn().mockResolvedValue([]) },
    scheduleSlot: { findFirst: vi.fn().mockResolvedValue({ batchId: 'b1' }) },
    specialClass: { findFirst: vi.fn().mockResolvedValue({ batchId: 'b1' }) },
    $queryRaw: vi.fn().mockResolvedValue([{ id: SLOT }]),
    $transaction: vi.fn(),
  };
  // The transaction client is its own object (sharing the model mocks), so a
  // test can tell reads inside the transaction from reads outside it.
  const tx = { ...prisma, inTransaction: true };
  prisma.$transaction.mockImplementation((run: (t: typeof prisma) => unknown) => run(tx));
  const schedule = { teacherClassesOn: vi.fn().mockResolvedValue([cls]) };
  const service = new AttendanceService(
    prisma as unknown as PrismaService,
    schedule as unknown as ScheduleService,
    { url: vi.fn() } as unknown as FilesService,
  );
  return { prisma, schedule, service, tx };
}

describe('AttendanceService.submit', () => {
  it("a future date, a repeated student or an inactive teacher is refused before anything is read", async () => {
    const { service, prisma } = build();
    await expect(service.submit(scope(), 'u', dto([{ studentId: 'st-1', status: 'PRESENT' }], { date: '2999-01-01' }))).rejects.toThrow('future date');
    await expect(
      service.submit(scope(), 'u', dto([{ studentId: 'st-1', status: 'PRESENT' }, { studentId: 'st-1', status: 'ABSENT' }])),
    ).rejects.toThrow('only once');
    await expect(service.submit(scope({ active: false }), 'u', dto([]))).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("only the teacher's own class on that date can be marked", async () => {
    const { service, schedule } = build();
    schedule.teacherClassesOn.mockResolvedValue([]);
    await expect(service.submit(scope(), 'u', dto([{ studentId: 'st-1', status: 'PRESENT' }]))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('the sheet must cover exactly the roster: nobody missing, nobody from elsewhere', async () => {
    const { service, prisma } = build();
    await expect(service.submit(scope(), 'u', dto([{ studentId: 'st-1', status: 'PRESENT' }]))).rejects.toThrow('Mark every student first (1 left)');
    await expect(
      service.submit(scope(), 'u', dto([{ studentId: 'st-1', status: 'PRESENT' }, { studentId: 'st-x', status: 'PRESENT' }])),
    ).rejects.toThrow('The student list has changed');
    // The roster is the batch's active students (plus anyone already marked), in this school.
    expect(prisma.student.findMany.mock.calls[0][0].where).toEqual({ schoolId: 'school-1', OR: [{ batchId: 'b1', status: 'ACTIVE' }] });
    expect(prisma.attendanceRecord.createMany).not.toHaveBeenCalled();
  });

  it('saves the occurrence with the class details and replaces its records, after locking the class', async () => {
    const { service, prisma } = build();
    const result = await service.submit(
      scope(),
      'teacher-user',
      dto([{ studentId: 'st-1', status: 'PRESENT' }, { studentId: 'st-2', status: 'LATE', note: 'Bus' }]),
    );
    expect(result.counts).toEqual({ PRESENT: 1, ABSENT: 0, LATE: 1, EXCUSED: 0 });
    expect(prisma.$queryRaw.mock.calls[1].slice(1)).toEqual([SLOT, 'school-1']);
    expect(prisma.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(prisma.student.findMany.mock.invocationCallOrder[0]);
    expect(prisma.classOccurrence.create.mock.calls[0][0].data).toMatchObject({
      schoolId: 'school-1',
      batchId: 'b1',
      slotId: SLOT,
      title: 'Physics',
      startMinute: 600,
      room: 'R1',
      facultyId: 'fac-1',
      markedById: 'teacher-user',
    });
    expect(prisma.attendanceRecord.deleteMany).toHaveBeenCalledWith({ where: { occurrenceId: 'occ-new' } });
    expect(prisma.attendanceRecord.createMany.mock.calls[0][0].data).toEqual([
      { schoolId: 'school-1', occurrenceId: 'occ-new', studentId: 'st-1', status: 'PRESENT', note: null },
      { schoolId: 'school-1', occurrenceId: 'occ-new', studentId: 'st-2', status: 'LATE', note: 'Bus' },
    ]);
  });

  it("locks the class's batch (shared) before the class, the order a batch delete takes them", async () => {
    const { service, prisma } = build();
    await service.submit(scope(), 'u', dto([{ studentId: 'st-1', status: 'PRESENT' }, { studentId: 'st-2', status: 'PRESENT' }]));
    const sql = (i: number) => (prisma.$queryRaw.mock.calls[i][0] as string[]).join('?');
    expect(sql(0)).toMatch(/FROM "Batch" WHERE "id" = \? AND "schoolId" = \? FOR SHARE/);
    expect(prisma.$queryRaw.mock.calls[0].slice(1)).toEqual(['b1', 'school-1']);
    expect(sql(1)).toMatch(/FROM "ScheduleSlot" .* FOR UPDATE/);
    expect(prisma.scheduleSlot.findFirst.mock.calls[0][0].where).toEqual({ id: SLOT, schoolId: 'school-1' });
  });

  it('reads the class inside the transaction, after the locks', async () => {
    const { service, schedule, prisma, tx } = build();
    await service.submit(scope(), 'u', dto([{ studentId: 'st-1', status: 'PRESENT' }, { studentId: 'st-2', status: 'PRESENT' }]));
    expect(schedule.teacherClassesOn.mock.calls[0][2]).toBe(tx);
    expect(prisma.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(schedule.teacherClassesOn.mock.invocationCallOrder[0]);
  });

  it('a class whose batch is gone, or that changed batch meanwhile, is not saved', async () => {
    const { service, prisma } = build();
    const all = dto([{ studentId: 'st-1', status: 'PRESENT' }, { studentId: 'st-2', status: 'PRESENT' }]);
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await expect(service.submit(scope(), 'u', all)).rejects.toBeInstanceOf(NotFoundException);
    prisma.scheduleSlot.findFirst.mockResolvedValueOnce({ batchId: 'b-other' });
    await expect(service.submit(scope(), 'u', all)).rejects.toThrow('changed batch');
    prisma.scheduleSlot.findFirst.mockResolvedValueOnce(null);
    await expect(service.submit(scope(), 'u', all)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.attendanceRecord.createMany).not.toHaveBeenCalled();
  });

  it('a student deleted while the sheet is saved is a 409, not a 500', async () => {
    const { service, prisma } = build();
    prisma.attendanceRecord.createMany.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 't' }),
    );
    await expect(
      service.submit(scope(), 'u', dto([{ studentId: 'st-1', status: 'PRESENT' }, { studentId: 'st-2', status: 'PRESENT' }])),
    ).rejects.toEqual(new ConflictException('The student list has changed. Refresh and mark again.'));
  });

  it('a resubmission updates the same occurrence and keeps its batch', async () => {
    const { service, prisma } = build();
    prisma.classOccurrence.findMany.mockResolvedValue([
      { id: 'occ-1', batchId: 'b-then', slotId: SLOT, specialClassId: null, submittedAt: new Date(), records: [] },
    ]);
    await service.submit(scope(), 'u', dto([{ studentId: 'st-1', status: 'ABSENT' }, { studentId: 'st-2', status: 'EXCUSED' }]));
    expect(prisma.classOccurrence.create).not.toHaveBeenCalled();
    expect(prisma.classOccurrence.update.mock.calls[0][0].where).toEqual({ id: 'occ-1' });
    expect(prisma.student.findMany.mock.calls[0][0].where.OR).toEqual([
      { batchId: 'b-then', status: 'ACTIVE' },
      { attendance: { some: { occurrenceId: 'occ-1' } } },
    ]);
  });
});

describe('AttendanceService.overview', () => {
  const day = (offset: number) => new Date(istToday().getTime() - offset * 86_400_000);

  it('rates count student-days (Late is present, Excused-only days count neither way)', async () => {
    const { service, prisma } = build();
    prisma.$queryRaw
      // per batch and day: this week, and the week before for the trend
      .mockResolvedValueOnce([
        { batchId: 'b1', date: day(6), present: 10, absent: 0 },
        { batchId: 'b1', date: day(1), present: 6, absent: 4 },
        { batchId: 'b2', date: day(2), present: 9, absent: 1 },
        { batchId: 'b1', date: day(10), present: 5, absent: 5 },
      ])
      // per student
      .mockResolvedValueOnce([
        { studentId: 'st-1', present: 2, absent: 0, lastAbsent: null },
        { studentId: 'st-2', present: 1, absent: 1, lastAbsent: day(1) },
        { studentId: 'st-3', present: 0, absent: 0, lastAbsent: null },
      ]);
    prisma.batch.findMany.mockResolvedValue([
      { id: 'b1', name: 'Batch 1A', program: { name: 'JEE' } },
      { id: 'b2', name: 'Batch 2', program: { name: 'JEE' } },
    ]);
    prisma.student.findMany.mockResolvedValue([
      { id: 'st-1', fullName: 'Asha', rollNumber: '1', batch: { name: 'Batch 1A' } },
      { id: 'st-2', fullName: 'Bala', rollNumber: '2', batch: null },
      { id: 'st-3', fullName: 'Chirag', rollNumber: '3', batch: { name: 'Batch 2' } },
    ]);
    const o = await service.overview('school-1', { days: 7 });
    // (10 + 6 + 9) / (10 + 10 + 10)
    expect(o.kpis.rate).toBe(83.3);
    expect(o.kpis.change).toBe(33.3);
    expect(o.kpis.batchesBelow75).toBe(0);
    expect(o.kpis.perfectAttendance).toBe(1);
    // Batch 1A fell from 100% to 60% within the week.
    expect(o.attention.map((b) => [b.name, b.rate, b.declining])).toEqual([['Batch 1A', 80, true]]);
    expect(o.heatmap.dates).toHaveLength(7);
    const cell = o.heatmap.batches[0].cells.find((c) => c.date === day(1).toISOString().slice(0, 10));
    expect(cell).toEqual({ date: day(1).toISOString().slice(0, 10), present: 6, absent: 4, rate: 60 });
    expect(o.students.map((s) => [s.fullName, s.rate, s.batch])).toEqual([
      ['Asha', 100, 'Batch 1A'],
      ['Bala', 50, null],
      ['Chirag', null, 'Batch 2'],
    ]);
  });

  it('no records: no rate, no trend, nothing flagged', async () => {
    const { service, prisma } = build();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.student.findMany.mockResolvedValue([]);
    const o = await service.overview('school-1', {});
    expect(o.range.days).toBe(30);
    expect(o.kpis).toEqual({ rate: null, change: null, batchesBelow75: 0, perfectAttendance: 0 });
    expect(o.attention).toEqual([]);
  });
});

describe('AttendanceService.sheet', () => {
  it('a future class can be opened but not submitted', async () => {
    const { service } = build();
    const sheet = await service.sheet(scope(), { date: '2999-01-01', class: cls.key });
    expect(sheet.canSubmit).toBe(false);
    expect(sheet.students.map((s) => s.status)).toEqual([null, null]);
  });

  it('a bad date is a 400', async () => {
    const { service } = build();
    await expect(service.sheet(scope(), { date: '2026-02-30', class: cls.key })).rejects.toBeInstanceOf(BadRequestException);
  });
});
