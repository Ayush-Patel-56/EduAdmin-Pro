import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AgendaItemDto, MeetingDto } from './meetings.dto.js';
import { MeetingsService, splitAttendees } from './meetings.service.js';

const meeting = (over: Partial<MeetingDto> = {}) =>
  ({ title: 'Weekly Alignment', date: '2026-10-17', time: '15:28', type: 'MANAGEMENT', attendees: 'Principal, HODs', ...over }) as MeetingDto;
const item = (over: Partial<AgendaItemDto> = {}) => ({ title: 'Fee follow-up', priority: 'MEDIUM', status: 'NOT_STARTED', ...over }) as AgendaItemDto;

function build() {
  const prisma = {
    meeting: {
      findFirst: vi.fn().mockResolvedValue({ id: 'm1' }),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'm1' }),
      update: vi.fn(),
      delete: vi.fn(),
    },
    meetingAgendaItem: {
      findFirst: vi.fn().mockResolvedValue({ id: 'a1' }),
      create: vi.fn().mockResolvedValue({ id: 'a1' }),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
  return { prisma, service: new MeetingsService(prisma as unknown as PrismaService) };
}

describe('MeetingsService', () => {
  it('attendees are split on commas, without blanks or repeats', () => {
    expect(splitAttendees('Principal, HODs,, principal ;  Office  Secretary')).toEqual(['Principal', 'HODs', 'Office Secretary']);
    expect(splitAttendees(null)).toEqual([]);
    expect(() => splitAttendees('x'.repeat(81))).toThrow(BadRequestException);
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

  it("another school's meeting or agenda item is a 404 (always looked up with the school)", async () => {
    const { service, prisma } = build();
    prisma.meeting.findFirst.mockResolvedValue(null);
    await expect(service.get('school-1', 'm-x')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update('school-1', 'm-x', meeting())).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove('school-1', 'm-x')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.addAgendaItem('school-1', 'm-x', item())).rejects.toBeInstanceOf(NotFoundException);
    for (const call of prisma.meeting.findFirst.mock.calls) expect(call[0].where).toMatchObject({ id: 'm-x', schoolId: 'school-1' });
    prisma.meetingAgendaItem.findFirst.mockResolvedValue(null);
    await expect(service.setAgendaState('school-1', 'm1', 'a-x', { status: 'COMPLETED' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.meetingAgendaItem.findFirst.mock.calls[0][0].where).toEqual({ id: 'a-x', meetingId: 'm1', schoolId: 'school-1' });
    expect(prisma.meeting.delete).not.toHaveBeenCalled();
    expect(prisma.meetingAgendaItem.update).not.toHaveBeenCalled();
  });

  it('the status and priority pills change only what they set', async () => {
    const { service, prisma } = build();
    await service.setAgendaState('school-1', 'm1', 'a1', { priority: 'HIGH' });
    expect(prisma.meetingAgendaItem.update.mock.calls[0][0].data).toEqual({ priority: 'HIGH' });
    await expect(service.setAgendaState('school-1', 'm1', 'a1', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('an agenda item added to a meeting deleted meanwhile is a 404, not a 500', async () => {
    const { service, prisma } = build();
    prisma.meetingAgendaItem.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 't' }));
    await expect(service.addAgendaItem('school-1', 'm1', item({ targetDate: '2026-10-20' }))).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.meetingAgendaItem.create.mock.calls[0][0].data).toMatchObject({ schoolId: 'school-1', meetingId: 'm1', targetDate: new Date('2026-10-20T00:00:00Z') });
  });

  it('the log is newest first and reads back times as HH:MM', async () => {
    const { service, prisma } = build();
    prisma.meeting.findMany.mockResolvedValue([
      { id: 'm1', title: 'hi', type: 'MANAGEMENT', date: new Date('2026-10-17T00:00:00Z'), startMinute: 928, _count: { agendaItems: 2 } },
    ]);
    await expect(service.list('school-1', { q: 'hi' })).resolves.toEqual([
      { id: 'm1', title: 'hi', type: 'MANAGEMENT', date: '2026-10-17', time: '15:28', agendaCount: 2 },
    ]);
    expect(prisma.meeting.findMany.mock.calls[0][0].where.schoolId).toBe('school-1');
  });
});
