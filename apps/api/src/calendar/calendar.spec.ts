import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { addMonths, occurrences, spanProblem, type Span } from './calendar-rules.js';
import type { CalendarEventDto } from './calendar.dto.js';
import { CalendarService } from './calendar.service.js';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);
const span = (over: Partial<Span> = {}): Span => ({ startDate: d('2026-10-05'), endDate: d('2026-10-05'), repeat: 'NONE', repeatUntil: null, ...over });
const starts = (e: Span, from: string, to: string) => occurrences(e, d(from), d(to)).map((o) => iso(o.start));

describe('calendar rules', () => {
  it('a one-off event shows wherever it overlaps the range, multi-day included', () => {
    const e = span({ startDate: d('2026-10-30'), endDate: d('2026-11-02') });
    expect(starts(e, '2026-11-01', '2026-11-30')).toEqual(['2026-10-30']);
    expect(starts(e, '2026-11-03', '2026-11-30')).toEqual([]);
  });

  it('daily and weekly repeats start from the event, stop at repeat-until, and include one running into the range', () => {
    expect(starts(span({ repeat: 'DAILY', repeatUntil: d('2026-10-08') }), '2026-10-01', '2026-10-31')).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']);
    const weekly = span({ startDate: d('2026-10-05'), endDate: d('2026-10-07'), repeat: 'WEEKLY' });
    // The 26 Oct - 28 Oct occurrence runs into 27 Oct.
    expect(starts(weekly, '2026-10-27', '2026-11-10')).toEqual(['2026-10-26', '2026-11-02', '2026-11-09']);
  });

  it('a monthly repeat keeps its day; a short month uses its last day', () => {
    expect(starts(span({ startDate: d('2026-01-31'), endDate: d('2026-01-31'), repeat: 'MONTHLY' }), '2026-02-01', '2026-04-30')).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
    expect(iso(addMonths(d('2028-01-31'), 1))).toBe('2028-02-29');
  });

  it("a monthly occurrence from last month that runs into the range is kept", () => {
    // 28 Jan to 1 Feb, monthly: the February one runs 28 Feb to 4 Mar.
    const e = span({ startDate: d('2026-01-28'), endDate: d('2026-02-01'), repeat: 'MONTHLY' });
    expect(starts(e, '2026-03-01', '2026-03-31')).toEqual(['2026-02-28', '2026-03-28']);
    expect(occurrences(e, d('2026-03-01'), d('2026-03-31'))[0].end).toEqual(d('2026-03-04'));
  });

  it('periods that would overlap their own repeat are refused, like the database checks', () => {
    expect(spanProblem(span({ endDate: d('2026-10-04') }))).toMatch(/before the start/);
    expect(spanProblem(span({ repeat: 'DAILY', endDate: d('2026-10-06') }))).toMatch(/daily event lasts one day/);
    expect(spanProblem(span({ repeat: 'WEEKLY', endDate: d('2026-10-12') }))).toMatch(/at most 7 days/);
    expect(spanProblem(span({ repeat: 'MONTHLY', endDate: d('2026-11-02') }))).toMatch(/at most 28 days/);
    expect(spanProblem(span({ repeatUntil: d('2026-12-01') }))).toMatch(/only applies to a repeating event/);
    expect(spanProblem(span({ repeat: 'WEEKLY', repeatUntil: d('2026-10-01') }))).toMatch(/Repeat until can't be before/);
    expect(spanProblem(span({ repeat: 'WEEKLY', endDate: d('2026-10-11') }))).toBeNull();
  });
});

function build() {
  const prisma = {
    calendarEvent: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue({ id: 'e1' }),
      create: vi.fn().mockResolvedValue({ id: 'e1' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    batch: { findFirst: vi.fn() },
    program: { findFirst: vi.fn() },
  };
  return { prisma, service: new CalendarService(prisma as unknown as PrismaService) };
}
const dto = (over: Partial<CalendarEventDto> = {}) =>
  ({ title: 'Diwali', type: 'HOLIDAY', scope: 'SCHOOL', startDate: '2026-11-08', endDate: '2026-11-10', repeat: 'NONE', ...over }) as CalendarEventDto;

describe('CalendarService', () => {
  // The program comes from the batch when read, so moving the batch moves its events
  // and deleting its old program can't cascade to them.
  it("a batch event stores only its batch; another school's batch or program is refused", async () => {
    const { service, prisma } = build();
    prisma.batch.findFirst.mockResolvedValueOnce({ id: 'b1' });
    await service.create('school-1', 'admin', dto({ scope: 'BATCH', batchId: 'b1', programId: 'p1' }));
    expect(prisma.calendarEvent.create.mock.calls[0][0].data).toMatchObject({ schoolId: 'school-1', programId: null, batchId: 'b1', createdById: 'admin' });
    expect(prisma.batch.findFirst.mock.calls[0][0].where).toEqual({ id: 'b1', schoolId: 'school-1' });
    prisma.batch.findFirst.mockResolvedValueOnce(null);
    await expect(service.create('school-1', 'u', dto({ scope: 'BATCH', batchId: 'b-x' }))).rejects.toThrow('Select a batch of this school');
    prisma.program.findFirst.mockResolvedValueOnce(null);
    await expect(service.create('school-1', 'u', dto({ scope: 'PROGRAM', programId: 'p-x' }))).rejects.toThrow('Select a program of this school');
    expect(prisma.program.findFirst.mock.calls[0][0].where).toEqual({ id: 'p-x', schoolId: 'school-1' });
    // A school-wide event ignores ids sent along with it.
    await service.create('school-1', 'u', dto({ programId: 'p9', batchId: 'b9' }));
    expect(prisma.calendarEvent.create.mock.calls[1][0].data).toMatchObject({ programId: null, batchId: null });
  });

  it('bad periods are a 400 before anything is saved', async () => {
    const { service, prisma } = build();
    await expect(service.create('school-1', 'u', dto({ repeat: 'DAILY' }))).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.calendarEvent.create).not.toHaveBeenCalled();
  });

  it('the range is limited, and the scope filter and the date filter are both applied', async () => {
    const { service, prisma } = build();
    await expect(service.occurrencesIn('school-1', { from: '2026-01-01', to: '2027-06-01' })).rejects.toThrow('at most 400 days');
    await expect(service.occurrencesIn('school-1', { from: '2026-10-31', to: '2026-10-01' })).rejects.toThrow("To can't be before from");
    prisma.batch.findFirst.mockResolvedValueOnce({ programId: 'p1' });
    await service.occurrencesIn('school-1', { from: '2026-10-01', to: '2026-10-31', batchId: 'b1' });
    const where = prisma.calendarEvent.findMany.mock.calls[0][0].where;
    expect(where.schoolId).toBe('school-1');
    expect(where.AND[0]).toEqual({ OR: [{ programId: null, batchId: null }, { batchId: 'b1' }, { programId: 'p1', batchId: null }] });
    expect(where.AND[1].OR[0]).toEqual({ endDate: { gte: d('2026-10-01') } });
    // A repeat that stopped up to a month before the range can still have an occurrence running into it.
    expect(where.AND[1].OR[1]).toEqual({ repeat: { not: 'NONE' }, OR: [{ repeatUntil: null }, { repeatUntil: { gte: d('2026-08-31') } }] });
    expect(where.startDate).toEqual({ lte: d('2026-10-31') });
    // A one-day range (from = to) is fine.
    await expect(service.occurrencesIn('school-1', { from: '2026-10-01', to: '2026-10-01' })).resolves.toEqual([]);
  });

  it("the batch filter checks the batch is this school's", async () => {
    const { service, prisma } = build();
    prisma.batch.findFirst.mockResolvedValueOnce(null);
    await expect(service.occurrencesIn('school-1', { from: '2026-10-01', to: '2026-10-31', batchId: 'b-x' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.batch.findFirst.mock.calls[0][0].where).toEqual({ id: 'b-x', schoolId: 'school-1' });
    expect(prisma.calendarEvent.findMany).not.toHaveBeenCalled();
  });

  it("the program filter finds batch events through the batch's current program", async () => {
    const { service, prisma } = build();
    await service.occurrencesIn('school-1', { from: '2026-10-01', to: '2026-10-31', programId: 'p2' });
    expect(prisma.calendarEvent.findMany.mock.calls[0][0].where.AND[0]).toEqual({
      OR: [{ programId: null, batchId: null }, { programId: 'p2' }, { batch: { programId: 'p2' } }],
    });
  });

  it("a batch event shows its batch's current program", async () => {
    const { service, prisma } = build();
    prisma.calendarEvent.findMany.mockResolvedValue([
      { id: 'e3', title: 'Exam', type: 'EXAM', description: null, program: null, batch: { id: 'b1', name: 'M1', program: { id: 'p2', name: 'NEET' } }, startDate: d('2026-10-07'), endDate: d('2026-10-07'), repeat: 'NONE', repeatUntil: null },
    ]);
    const [o] = await service.occurrencesIn('school-1', { from: '2026-10-01', to: '2026-10-31' });
    expect(o).toMatchObject({ scope: 'BATCH', batch: { id: 'b1', name: 'M1' }, program: { id: 'p2', name: 'NEET' } });
    expect(o.batch).toEqual({ id: 'b1', name: 'M1' });
  });

  it('Upcoming starts today (in IST) and looks a year ahead', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-13T20:00:00Z') }); // 14 Oct, 01:30 IST
    try {
      const { service, prisma } = build();
      prisma.calendarEvent.findMany.mockResolvedValue([
        { id: 'e4', title: 'Today', type: 'EVENT', description: null, program: null, batch: null, startDate: d('2026-10-14'), endDate: d('2026-10-14'), repeat: 'NONE', repeatUntil: null },
        { id: 'e5', title: 'Yesterday', type: 'EVENT', description: null, program: null, batch: null, startDate: d('2026-10-13'), endDate: d('2026-10-13'), repeat: 'NONE', repeatUntil: null },
      ]);
      const list = await service.upcoming('school-1', {});
      expect(list.map((o) => o.title)).toEqual(['Today']);
      const where = prisma.calendarEvent.findMany.mock.calls[0][0].where;
      expect(where.AND[1].OR[0]).toEqual({ endDate: { gte: d('2026-10-14') } });
      expect(where.startDate).toEqual({ lte: d('2027-10-14') });
    } finally {
      vi.useRealTimers();
    }
  });

  it('expands repeats into dated occurrences, in date order', async () => {
    const { service, prisma } = build();
    prisma.calendarEvent.findMany.mockResolvedValue([
      { id: 'e1', title: 'Unit Test', type: 'EXAM', description: null, program: null, batch: null, startDate: d('2026-10-05'), endDate: d('2026-10-05'), repeat: 'WEEKLY', repeatUntil: d('2026-10-19') },
      { id: 'e2', title: 'PTM', type: 'PARENT_MEETING', description: null, program: { id: 'p1', name: 'JEE' }, batch: null, startDate: d('2026-10-10'), endDate: d('2026-10-10'), repeat: 'NONE', repeatUntil: null },
    ]);
    const list = await service.occurrencesIn('school-1', { from: '2026-10-01', to: '2026-10-31' });
    expect(list.map((o) => `${o.date} ${o.title}`)).toEqual(['2026-10-05 Unit Test', '2026-10-10 PTM', '2026-10-12 Unit Test', '2026-10-19 Unit Test']);
    expect(list[1]).toMatchObject({ key: 'e2:2026-10-10', scope: 'PROGRAM', endsOn: '2026-10-10' });
  });

  // Scoped in the write itself: another school's event and one deleted a moment ago are both a 404, never a 500.
  it("edit and delete are scoped to the school and 404 when nothing matched", async () => {
    const { service, prisma } = build();
    prisma.calendarEvent.updateMany.mockResolvedValue({ count: 0 });
    prisma.calendarEvent.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.update('school-1', 'e-x', dto())).rejects.toThrow('Event not found');
    await expect(service.remove('school-1', 'e-x')).rejects.toThrow('Event not found');
    expect(prisma.calendarEvent.updateMany.mock.calls[0][0].where).toEqual({ id: 'e-x', schoolId: 'school-1' });
    expect(prisma.calendarEvent.deleteMany.mock.calls[0][0].where).toEqual({ id: 'e-x', schoolId: 'school-1' });
    prisma.calendarEvent.deleteMany.mockResolvedValue({ count: 1 });
    await expect(service.remove('school-1', 'e1')).resolves.toEqual({ ok: true });
  });
});
