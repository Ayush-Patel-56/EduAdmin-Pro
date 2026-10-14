import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AgendaItemDto, MeetingDto } from './meetings.dto.js';
import { MEETING_LIST_LIMIT, MeetingsService, splitAttendees } from './meetings.service.js';

const meeting = (over: Partial<MeetingDto> = {}) =>
  ({ title: 'Weekly Alignment', date: '2026-10-17', time: '15:28', type: 'MANAGEMENT', attendees: 'Principal, HODs', ...over }) as MeetingDto;
const item = (over: Partial<AgendaItemDto> = {}) => ({ title: 'Fee follow-up', priority: 'MEDIUM', status: 'NOT_STARTED', ...over }) as AgendaItemDto;

function build() {
  const prisma = {
    meeting: {
      findFirst: vi.fn().mockResolvedValue({ id: 'm1' }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: 'm1' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    meetingAgendaItem: {
      create: vi.fn().mockResolvedValue({ id: 'a1' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  return { prisma, service: new MeetingsService(prisma as unknown as PrismaService) };
}

describe('MeetingsService', () => {
  it('attendees are split on commas, without blanks or repeats', () => {
    expect(splitAttendees('Principal, HODs,, principal ;  Office  Secretary')).toEqual(['Principal', 'HODs', 'Office Secretary']);
    expect(splitAttendees(null)).toEqual([]);
    expect(() => splitAttendees('x'.repeat(81))).toThrow(BadRequestException);
  });

  it('a meeting lists at most 100 attendees', () => {
    const names = (n: number) => Array.from({ length: n }, (_, i) => `Member ${i + 1}`).join(', ');
    expect(splitAttendees(names(100))).toHaveLength(100);
    expect(() => splitAttendees(names(101))).toThrow('at most 100 attendees');
  });

  it('saves the time as minutes and refuses a next meeting before this one', async () => {
    const { service, prisma } = build();
    await service.create('school-1', 'admin', meeting());
    expect(prisma.meeting.create.mock.calls[0][0].data).toMatchObject({
      schoolId: 'school-1',
      createdById: 'admin',
      startMinute: 928,
      attendees: ['Principal', 'HODs'],
      date: new Date('2026-10-17T00:00:00Z'),
    });
    await expect(service.create('school-1', 'u', meeting({ nextMeetingDate: '2026-10-01' }))).rejects.toThrow("can't be before this one");
  });

  it("another school's meeting is a 404 (always looked up with the school)", async () => {
    const { service, prisma } = build();
    prisma.meeting.findFirst.mockResolvedValue(null);
    await expect(service.get('school-1', 'm-x')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.addAgendaItem('school-1', 'm-x', item())).rejects.toBeInstanceOf(NotFoundException);
    for (const call of prisma.meeting.findFirst.mock.calls) expect(call[0].where).toMatchObject({ id: 'm-x', schoolId: 'school-1' });
    expect(prisma.meetingAgendaItem.create).not.toHaveBeenCalled();
  });

  // The write itself carries the school (and the meeting, for items), so another
  // school's row and a row deleted a moment ago are both "nothing matched": a 404, never a 500.
  it('edits and deletes are scoped in the write and 404 when nothing matched', async () => {
    const { service, prisma } = build();
    prisma.meeting.updateMany.mockResolvedValue({ count: 0 });
    prisma.meeting.deleteMany.mockResolvedValue({ count: 0 });
    prisma.meetingAgendaItem.updateMany.mockResolvedValue({ count: 0 });
    prisma.meetingAgendaItem.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.update('school-1', 'm-x', meeting())).rejects.toThrow('Meeting not found');
    await expect(service.remove('school-1', 'm-x')).rejects.toThrow('Meeting not found');
    await expect(service.updateAgendaItem('school-1', 'm1', 'a-x', item())).rejects.toThrow('Agenda item not found');
    await expect(service.setAgendaState('school-1', 'm1', 'a-x', { status: 'COMPLETED' })).rejects.toThrow('Agenda item not found');
    await expect(service.removeAgendaItem('school-1', 'm1', 'a-x')).rejects.toThrow('Agenda item not found');
    expect(prisma.meeting.updateMany.mock.calls[0][0].where).toEqual({ id: 'm-x', schoolId: 'school-1' });
    expect(prisma.meeting.deleteMany.mock.calls[0][0].where).toEqual({ id: 'm-x', schoolId: 'school-1' });
    const scoped = { id: 'a-x', meetingId: 'm1', schoolId: 'school-1' };
    expect(prisma.meetingAgendaItem.updateMany.mock.calls.map((c) => c[0].where)).toEqual([scoped, scoped]);
    expect(prisma.meetingAgendaItem.deleteMany.mock.calls[0][0].where).toEqual(scoped);
  });

  it('a write that matched returns normally', async () => {
    const { service } = build();
    await expect(service.update('school-1', 'm1', meeting())).resolves.toEqual({ id: 'm1' });
    await expect(service.remove('school-1', 'm1')).resolves.toEqual({ ok: true });
    await expect(service.removeAgendaItem('school-1', 'm1', 'a1')).resolves.toEqual({ ok: true });
  });

  it('the status and priority pills change only what they set', async () => {
    const { service, prisma } = build();
    await service.setAgendaState('school-1', 'm1', 'a1', { priority: 'HIGH' });
    expect(prisma.meetingAgendaItem.updateMany.mock.calls[0][0].data).toEqual({ priority: 'HIGH' });
    await expect(service.setAgendaState('school-1', 'm1', 'a1', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('an agenda item added to a meeting deleted meanwhile is a 404, not a 500', async () => {
    const { service, prisma } = build();
    prisma.meetingAgendaItem.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 't' }));
    await expect(service.addAgendaItem('school-1', 'm1', item({ targetDate: '2026-10-20' }))).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.meetingAgendaItem.create.mock.calls[0][0].data).toMatchObject({ schoolId: 'school-1', meetingId: 'm1', targetDate: new Date('2026-10-20T00:00:00Z') });
  });

  it('the log is newest first, capped, counts every match and reads back times as HH:MM', async () => {
    const { service, prisma } = build();
    prisma.meeting.count.mockResolvedValue(612);
    prisma.meeting.findMany.mockResolvedValue([
      { id: 'm1', title: 'hi', type: 'MANAGEMENT', date: new Date('2026-10-17T00:00:00Z'), startMinute: 928, _count: { agendaItems: 2 } },
    ]);
    await expect(service.list('school-1', {})).resolves.toEqual({
      total: 612,
      items: [{ id: 'm1', title: 'hi', type: 'MANAGEMENT', date: '2026-10-17', time: '15:28', agendaCount: 2 }],
    });
    const args = prisma.meeting.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ schoolId: 'school-1' });
    expect(prisma.meeting.count.mock.calls[0][0].where).toBe(args.where);
    expect(args.orderBy).toEqual([{ date: 'desc' }, { startMinute: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }]);
    expect(args.take).toBe(MEETING_LIST_LIMIT);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('attendee search is partial and any case, within the school, with % and _ taken literally', async () => {
    const { service, prisma } = build();
    prisma.$queryRaw.mockResolvedValue([{ id: 'm7' }]);
    await service.list('school-1', { q: 'princ_100%' });
    const [sql, ...values] = prisma.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(sql.join('?')).toMatch(/unnest\(m\."attendees"\).*ILIKE/s);
    expect(values).toEqual(['school-1', '%princ\\_100\\%%']);
    const where = prisma.meeting.findMany.mock.calls[0][0].where;
    expect(where.schoolId).toBe('school-1');
    expect(where.OR).toContainEqual({ id: { in: ['m7'] } });
    expect(where.OR).toContainEqual({ title: { contains: 'princ_100%', mode: 'insensitive' } });
  });
});
