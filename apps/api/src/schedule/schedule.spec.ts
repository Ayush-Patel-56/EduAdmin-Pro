import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { TeacherScope } from '../academic/access.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { type AdminSlotDto, type AdminSpecialClassDto, formatMinute, toMinute } from './schedule.dto.js';
import { ScheduleService } from './schedule.service.js';

const scope = (over: Partial<TeacherScope> = {}): TeacherScope => ({
  schoolId: 'school-1',
  facultyId: 'fac-1',
  batchIds: ['b1'],
  programIds: ['p1'],
  active: true,
  ...over,
});
const slot = (over: Partial<AdminSlotDto> = {}) =>
  ({
    facultyId: 'fac-1',
    subject: 'Physics',
    batchId: 'b1',
    dayOfWeek: 3,
    room: 'R1',
    startTime: '09:00',
    endTime: '10:00',
    effectiveFrom: '2026-10-14',
    active: true,
    ...over,
  }) as AdminSlotDto;
const special = (over: Partial<AdminSpecialClassDto> = {}) =>
  ({ title: 'Doubts', type: 'DOUBT', batchId: 'b1', date: '2026-10-14', startTime: '10:00', endTime: '11:00', ...over }) as AdminSpecialClassDto;
const row = (over = {}) => ({
  id: 's-other',
  subject: 'Maths',
  dayOfWeek: 3,
  startMinute: 540,
  endMinute: 600,
  room: 'R1',
  facultyId: 'fac-2',
  batchId: 'b2',
  faculty: { id: 'fac-2', name: 'Vikram' },
  batch: { id: 'b2', name: 'Batch 2', program: { id: 'p', name: 'JEE' } },
  ...over,
});

function build() {
  const prisma = {
    faculty: {
      findFirst: vi.fn().mockResolvedValue({ name: 'Anita', batchAssignments: [{ batchId: 'b1' }] }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    batch: { findFirst: vi.fn().mockResolvedValue({ name: 'Batch 1A' }) },
    scheduleSlot: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'new' }),
      update: vi.fn(),
      delete: vi.fn(),
    },
    specialClass: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'new' }),
      update: vi.fn(),
      delete: vi.fn(),
    },
    classOccurrence: { count: vi.fn().mockResolvedValue(0) },
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'x' }]),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((run: (tx: typeof prisma) => unknown) => run(prisma));
  return { prisma, service: new ScheduleService(prisma as unknown as PrismaService) };
}

describe('ScheduleService: weekly slots', () => {
  it('end before start, or an effective period that ends before it starts, is refused', async () => {
    const { service, prisma } = build();
    await expect(service.createSlot('school-1', 'u', slot({ endTime: '08:59' }))).rejects.toThrow('End time must be after the start time');
    await expect(service.createSlot('school-1', 'u', slot({ effectiveTo: '2026-10-01' }))).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.scheduleSlot.create).not.toHaveBeenCalled();
  });

  it('the teacher must be of this school and assigned to the batch', async () => {
    const { service, prisma } = build();
    prisma.faculty.findFirst.mockResolvedValueOnce(null);
    await expect(service.createSlot('school-1', 'u', slot())).rejects.toThrow('Select a teacher of this school');
    expect(prisma.faculty.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'fac-1', schoolId: 'school-1', status: { not: 'INACTIVE' } });
    prisma.faculty.findFirst.mockResolvedValueOnce({ name: 'Anita', batchAssignments: [] });
    await expect(service.createSlot('school-1', 'u', slot())).rejects.toThrow("Anita isn't assigned to Batch 1A");
    prisma.batch.findFirst.mockResolvedValueOnce(null);
    await expect(service.createSlot('school-1', 'u', slot())).rejects.toThrow('Select a batch of this school');
  });

  it('a clash with the same teacher, batch or room is a 409 that says what it clashes with', async () => {
    const { service, prisma } = build();
    prisma.scheduleSlot.findFirst.mockResolvedValueOnce(row({ room: 'r1' }));
    await expect(service.createSlot('school-1', 'u', slot())).rejects.toEqual(
      new ConflictException('Room r1 is already booked then: Maths (Batch 2), Wednesday 9:00 AM - 10:00 AM'),
    );
    const where = prisma.scheduleSlot.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ schoolId: 'school-1', active: true, dayOfWeek: 3, startMinute: { lt: 600 }, endMinute: { gt: 540 } });
    expect(where.AND[1].OR).toEqual([{ facultyId: 'fac-1' }, { batchId: 'b1' }, { room: { equals: 'R1', mode: 'insensitive' } }]);
    // The check runs under the school's schedule lock.
    expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.scheduleSlot.findFirst.mock.invocationCallOrder[0]);
    prisma.scheduleSlot.findFirst.mockResolvedValueOnce(row({ facultyId: 'fac-1', faculty: { id: 'fac-1', name: 'Anita' } }));
    await expect(service.createSlot('school-1', 'u', slot())).rejects.toThrow('Anita already teaches then');
  });

  it('an inactive slot is not checked for clashes; saving one never moves a slot with attendance to another batch', async () => {
    const { service, prisma } = build();
    await service.createSlot('school-1', 'u', slot({ active: false }));
    expect(prisma.scheduleSlot.findFirst).not.toHaveBeenCalled();
    expect(prisma.scheduleSlot.create.mock.calls[0][0].data).toMatchObject({ startMinute: 540, endMinute: 600, active: false, createdById: 'u' });
    prisma.scheduleSlot.findFirst.mockResolvedValueOnce({ batchId: 'b-old', _count: { occurrences: 3 } });
    await expect(service.updateSlot('school-1', 's1', slot())).rejects.toThrow('stays with its batch');
    expect(prisma.scheduleSlot.update).not.toHaveBeenCalled();
  });

  it('a slot with attendance is not deleted (it can be ended instead); the row is locked first', async () => {
    const { service, prisma } = build();
    prisma.classOccurrence.count.mockResolvedValueOnce(2);
    await expect(service.deleteSlot('school-1', 's1')).rejects.toThrow('Mark it inactive or set Effective To instead');
    expect(prisma.$queryRaw.mock.calls[0].slice(1)).toEqual(['s1', 'school-1']);
    expect(prisma.scheduleSlot.delete).not.toHaveBeenCalled();
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await expect(service.deleteSlot('school-1', 'foreign')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ScheduleService: special classes', () => {
  it('without a teacher only the batch is checked; it clashes with a weekly slot running that day', async () => {
    const { service, prisma } = build();
    prisma.scheduleSlot.findFirst.mockResolvedValueOnce(row({ batchId: 'b1', batch: { id: 'b1', name: 'Batch 1A', program: { name: 'JEE' } } }));
    await expect(service.createSpecialClass('school-1', 'u', special({ startTime: '09:30' }))).rejects.toThrow(
      'Batch 1A already has a class then: Maths (Batch 1A), the weekly 9:00 AM - 10:00 AM',
    );
    expect(prisma.faculty.findFirst).not.toHaveBeenCalled();
    // 14 Oct 2026 is a Wednesday.
    expect(prisma.scheduleSlot.findFirst.mock.calls[0][0].where).toMatchObject({ dayOfWeek: 3, active: true });
  });

  it("a class with attendance keeps its batch and date", async () => {
    const { service, prisma } = build();
    prisma.specialClass.findFirst.mockResolvedValueOnce({ batchId: 'b1', date: new Date('2026-10-13T00:00:00Z'), _count: { occurrences: 1 } });
    await expect(service.updateSpecialClass('school-1', 'c1', special())).rejects.toThrow("batch and date can't change");
  });
});

describe('ScheduleService: weekly slots against special classes', () => {
  it('a new slot clashes with a coming special class on that weekday within its period', async () => {
    const { service, prisma } = build();
    prisma.specialClass.findMany.mockResolvedValueOnce([
      // A Tuesday and a Wednesday, both overlapping; only the Wednesday one matters for a Wednesday slot.
      { ...row({ id: 'tue', room: 'Q' }), title: 'Tue doubts', date: new Date('2026-10-20T00:00:00Z') },
      { ...row({ id: 'wed', room: 'Q' }), title: 'Wed extra', date: new Date('2026-10-21T00:00:00Z') },
    ]);
    await expect(service.createSlot('school-1', 'u', slot({ room: 'q', effectiveTo: '2026-12-31' }))).rejects.toEqual(
      new ConflictException('Room Q is already booked then: Wed extra (Batch 2), on 2026-10-21 9:00 AM - 10:00 AM'),
    );
    const where = prisma.specialClass.findMany.mock.calls[0][0].where;
    expect(where.date.lte).toEqual(new Date('2026-12-31T00:00:00Z'));
    // Only classes still to come (or today).
    expect(where.date.gte.getTime()).toBeGreaterThanOrEqual(new Date('2026-10-14T00:00:00Z').getTime());
    expect(where.OR).toEqual([{ facultyId: 'fac-1' }, { batchId: 'b1' }, { room: { equals: 'q', mode: 'insensitive' } }]);
  });

  it("a special class only clashes with a slot that is still running that day (its Effective To counts)", async () => {
    const { service, prisma } = build();
    await service.createSpecialClass('school-1', 'u', special());
    const where = prisma.scheduleSlot.findFirst.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({ OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date('2026-10-14T00:00:00Z') } }] });
    expect(where.effectiveFrom).toEqual({ lte: new Date('2026-10-14T00:00:00Z') });
  });
});

describe('ScheduleService: teachers', () => {
  it("only active faculty write to the schedule", async () => {
    const { service, prisma } = build();
    const inactive = scope({ active: false });
    await expect(service.teacherCreateSlot(inactive, 'u', slot())).rejects.toThrow('Only active faculty');
    await expect(service.teacherCreateSpecialClass(inactive, 'u', special())).rejects.toThrow('Only active faculty');
    await expect(service.teacherCreateSlot(scope({ facultyId: null }), 'u', slot())).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.scheduleSlot.create).not.toHaveBeenCalled();
    expect(prisma.specialClass.create).not.toHaveBeenCalled();
  });

  it("a teacher changes only the special classes they take", async () => {
    const { service, prisma } = build();
    prisma.specialClass.findFirst.mockResolvedValueOnce({ facultyId: 'fac-2', batchId: 'b1' });
    await expect(service.teacherUpdateSpecialClass(scope(), 'c1', special())).rejects.toThrow('Only special classes you take');
    prisma.specialClass.findFirst.mockResolvedValueOnce({ facultyId: null, batchId: 'b1' });
    await expect(service.teacherDeleteSpecialClass(scope(), 'c1')).rejects.toThrow('Only special classes you take');
    expect(prisma.specialClass.update).not.toHaveBeenCalled();
    expect(prisma.specialClass.delete).not.toHaveBeenCalled();
  });

  it("a teacher changes only their own slots, in their batches; an inactive teacher has no schedule", async () => {
    const { service, prisma } = build();
    prisma.scheduleSlot.findFirst.mockResolvedValueOnce({ facultyId: 'fac-2', batchId: 'b1', active: true });
    await expect(service.teacherUpdateSlot(scope(), 's1', slot())).rejects.toThrow('Only your own slots');
    prisma.scheduleSlot.findFirst.mockResolvedValueOnce({ facultyId: 'fac-1', batchId: 'b-old', active: true });
    await expect(service.teacherDeleteSlot(scope(), 's1')).rejects.toThrow('no longer assigned');
    await expect(service.teacherCreateSlot(scope(), 'u', slot({ batchId: 'b-other' }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.teacherSchedule(scope({ active: false }))).resolves.toEqual({ slots: [], specialClasses: [] });
    expect(prisma.scheduleSlot.delete).not.toHaveBeenCalled();
  });

  it("a teacher's new slot is theirs and active", async () => {
    const { service, prisma } = build();
    await service.teacherCreateSlot(scope(), 'teacher-user', slot({ facultyId: 'someone-else' }));
    expect(prisma.scheduleSlot.create.mock.calls[0][0].data).toMatchObject({ facultyId: 'fac-1', active: true, schoolId: 'school-1' });
  });
});

describe('ScheduleService.classesOn', () => {
  it("lists the day's running slots (or ones already marked that day) and special classes, by start time", async () => {
    const { service, prisma } = build();
    prisma.scheduleSlot.findMany.mockResolvedValue([row({ id: 'sl', startMinute: 660, endMinute: 720 })]);
    prisma.specialClass.findMany.mockResolvedValue([
      { ...row({ id: 'sp' }), title: 'class 1', type: 'EXTRA', startMinute: 600, endMinute: 660, faculty: null },
    ]);
    const date = new Date('2026-10-14T00:00:00Z');
    const classes = await service.classesOn('school-1', date, { facultyId: 'fac-1', batchIds: ['b1'] });
    expect(classes.map((c) => [c.key, c.time])).toEqual([
      ['special:sp', '10:00 AM - 11:00 AM'],
      ['slot:sl', '11:00 AM - 12:00 PM'],
    ]);
    const where = prisma.scheduleSlot.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ schoolId: 'school-1', facultyId: 'fac-1', batchId: { in: ['b1'] } });
    expect(where.OR[0]).toMatchObject({ dayOfWeek: 3, active: true, effectiveFrom: { lte: date } });
    expect(where.OR[1]).toEqual({ occurrences: { some: { date } } });
    expect(prisma.specialClass.findMany.mock.calls[0][0].where).toMatchObject({
      schoolId: 'school-1',
      date,
      batchId: { in: ['b1'] },
      OR: [{ facultyId: 'fac-1' }, { facultyId: null }],
    });
  });
});

describe('time helpers', () => {
  it('converts between HH:MM and minutes, and shows AM/PM', () => {
    expect(toMinute('09:30')).toBe(570);
    expect(formatMinute(570)).toBe('9:30 AM');
    expect(formatMinute(0)).toBe('12:00 AM');
    expect(formatMinute(720)).toBe('12:00 PM');
    expect(formatMinute(1439)).toBe('11:59 PM');
  });
});
