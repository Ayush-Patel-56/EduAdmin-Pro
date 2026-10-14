import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { parseDate, toIsoDate } from '../common/dates.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AgendaItemDto, AgendaStateDto, MeetingDto, MeetingQuery } from './meetings.dto.js';

const HH_MM = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const toMinute = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

/** "Principal, HODs,, principal" -> ["Principal", "HODs"] (no blanks or repeats, any case). */
export function splitAttendees(text: string | null | undefined) {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of (text ?? '').split(/[,;\n]/)) {
    const name = raw.trim().replace(/\s+/g, ' ');
    if (!name || seen.has(name.toLowerCase())) continue;
    if (name.length > 80) throw new BadRequestException(`Attendee "${name.slice(0, 30)}…" is too long; separate attendees with commas`);
    seen.add(name.toLowerCase());
    names.push(name);
  }
  if (names.length > 100) throw new BadRequestException('List at most 100 attendees');
  return names;
}

const agendaOrder = [{ createdAt: 'asc' }, { id: 'asc' }] satisfies Prisma.MeetingAgendaItemOrderByWithRelationInput[];

/**
 * Meetings (PRD 4.14), admin only: the Meetings Log and each meeting's agenda
 * items, which are its minutes. Everything is looked up with the school, so
 * another school's ids answer 404.
 */
@Injectable()
export class MeetingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(schoolId: string, query: MeetingQuery) {
    const q = query.q?.trim();
    const rows = await this.prisma.meeting.findMany({
      where: {
        schoolId,
        ...(q && {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { venue: { contains: q, mode: 'insensitive' } },
            { minutesPreparedBy: { contains: q, mode: 'insensitive' } },
            { attendees: { has: q } },
            { agendaItems: { some: { title: { contains: q, mode: 'insensitive' } } } },
          ],
        }),
      },
      orderBy: [{ date: 'desc' }, { startMinute: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      select: { id: true, title: true, type: true, date: true, startMinute: true, _count: { select: { agendaItems: true } } },
      take: 500,
    });
    return rows.map((m) => ({
      id: m.id,
      title: m.title,
      type: m.type,
      date: toIsoDate(m.date)!,
      time: m.startMinute === null ? null : HH_MM(m.startMinute),
      agendaCount: m._count.agendaItems,
    }));
  }

  async get(schoolId: string, id: string) {
    const m = await this.prisma.meeting.findFirst({
      where: { id, schoolId },
      include: { agendaItems: { orderBy: agendaOrder } },
    });
    if (!m) throw new NotFoundException('Meeting not found');
    return {
      id: m.id,
      title: m.title,
      type: m.type,
      date: toIsoDate(m.date)!,
      time: m.startMinute === null ? null : HH_MM(m.startMinute),
      venue: m.venue,
      attendees: m.attendees,
      minutesPreparedBy: m.minutesPreparedBy,
      nextMeetingDate: toIsoDate(m.nextMeetingDate),
      agendaItems: m.agendaItems.map((a) => ({
        id: a.id,
        title: a.title,
        discussion: a.discussion,
        action: a.action,
        responsible: a.responsible,
        targetDate: toIsoDate(a.targetDate),
        communicatedTo: a.communicatedTo,
        communicatedBy: a.communicatedBy,
        priority: a.priority,
        status: a.status,
      })),
    };
  }

  async create(schoolId: string, userId: string, dto: MeetingDto) {
    const row = await this.prisma.meeting.create({
      data: { schoolId, createdById: userId, ...meetingData(dto) },
      select: { id: true },
    });
    return { id: row.id };
  }

  async update(schoolId: string, id: string, dto: MeetingDto) {
    await this.find(schoolId, id);
    await this.prisma.meeting.update({ where: { id }, data: meetingData(dto) });
    return { id };
  }

  /** Removes the meeting with its agenda items. */
  async remove(schoolId: string, id: string) {
    await this.find(schoolId, id);
    await this.prisma.meeting.delete({ where: { id } });
    return { ok: true };
  }

  async addAgendaItem(schoolId: string, meetingId: string, dto: AgendaItemDto) {
    await this.find(schoolId, meetingId);
    try {
      const row = await this.prisma.meetingAgendaItem.create({
        data: { schoolId, meetingId, ...agendaData(dto) },
        select: { id: true },
      });
      return { id: row.id };
    } catch (err) {
      // The meeting was deleted meanwhile.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') throw new NotFoundException('Meeting not found');
      throw err;
    }
  }

  async updateAgendaItem(schoolId: string, meetingId: string, itemId: string, dto: AgendaItemDto) {
    await this.findItem(schoolId, meetingId, itemId);
    await this.prisma.meetingAgendaItem.update({ where: { id: itemId }, data: agendaData(dto) });
    return { id: itemId };
  }

  async setAgendaState(schoolId: string, meetingId: string, itemId: string, dto: AgendaStateDto) {
    if (!dto.status && !dto.priority) throw new BadRequestException('Choose a status or a priority');
    await this.findItem(schoolId, meetingId, itemId);
    await this.prisma.meetingAgendaItem.update({
      where: { id: itemId },
      data: { ...(dto.status && { status: dto.status }), ...(dto.priority && { priority: dto.priority }) },
    });
    return { id: itemId };
  }

  async removeAgendaItem(schoolId: string, meetingId: string, itemId: string) {
    await this.findItem(schoolId, meetingId, itemId);
    await this.prisma.meetingAgendaItem.delete({ where: { id: itemId } });
    return { ok: true };
  }

  private async find(schoolId: string, id: string) {
    const row = await this.prisma.meeting.findFirst({ where: { id, schoolId }, select: { id: true } });
    if (!row) throw new NotFoundException('Meeting not found');
  }

  private async findItem(schoolId: string, meetingId: string, itemId: string) {
    const row = await this.prisma.meetingAgendaItem.findFirst({
      where: { id: itemId, meetingId, schoolId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Agenda item not found');
  }
}

function meetingData(dto: MeetingDto) {
  const date = parseDate(dto.date, 'Date');
  const next = dto.nextMeetingDate ? parseDate(dto.nextMeetingDate, 'Next meeting date') : null;
  if (next && next < date) throw new BadRequestException("The next meeting can't be before this one");
  return {
    title: dto.title,
    type: dto.type,
    date,
    startMinute: dto.time ? toMinute(dto.time) : null,
    venue: dto.venue ?? null,
    attendees: splitAttendees(dto.attendees),
    minutesPreparedBy: dto.minutesPreparedBy ?? null,
    nextMeetingDate: next,
  };
}

function agendaData(dto: AgendaItemDto) {
  return {
    title: dto.title,
    discussion: dto.discussion ?? null,
    action: dto.action ?? null,
    responsible: dto.responsible ?? null,
    targetDate: dto.targetDate ? parseDate(dto.targetDate, 'Target date') : null,
    communicatedTo: dto.communicatedTo ?? null,
    communicatedBy: dto.communicatedBy ?? null,
    priority: dto.priority,
    status: dto.status,
  };
}
