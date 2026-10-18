import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { parseDate, toIsoDate } from '../common/dates.js';
import { likeEscape } from '../common/like-escape.js';
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

/** The log shows this many meetings; a search narrows it. */
export const MEETING_LIST_LIMIT = 500;

const agendaOrder = [{ createdAt: 'asc' }, { id: 'asc' }] satisfies Prisma.MeetingAgendaItemOrderByWithRelationInput[];

/**
 * Meetings (PRD 4.14), admin only: the Meetings Log and each meeting's agenda
 * items, which are its minutes. Everything is looked up with the school, so
 * another school's ids answer 404. Writes are scoped to the school (and the
 * meeting, for items) in the same statement, so a row deleted meanwhile is a
 * 404 too.
 */
@Injectable()
export class MeetingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(schoolId: string, query: MeetingQuery) {
    const q = query.q?.trim();
    const where: Prisma.MeetingWhereInput = { schoolId };
    if (q) {
      // Prisma's `contains` is a LIKE, so % and _ are escaped to be taken literally.
      const text = { contains: likeEscape(q), mode: 'insensitive' } as const;
      where.OR = [
        { title: text },
        { venue: text },
        { minutesPreparedBy: text },
        { id: { in: await this.attendeeMatches(schoolId, q) } },
        { agendaItems: { some: { title: text } } },
      ];
    }
    const [total, rows] = await Promise.all([
      this.prisma.meeting.count({ where }),
      this.prisma.meeting.findMany({
        where,
        orderBy: [{ date: 'desc' }, { startMinute: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        select: { id: true, title: true, type: true, date: true, startMinute: true, _count: { select: { agendaItems: true } } },
        take: MEETING_LIST_LIMIT,
      }),
    ]);
    return {
      total,
      items: rows.map((m) => ({
        id: m.id,
        title: m.title,
        type: m.type,
        date: toIsoDate(m.date)!,
        time: m.startMinute === null ? null : HH_MM(m.startMinute),
        agendaCount: m._count.agendaItems,
      })),
    };
  }

  /** Meetings with an attendee containing the text, in any letter case (like the other search fields). */
  private async attendeeMatches(schoolId: string, q: string) {
    const pattern = `%${likeEscape(q)}%`;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT m."id" FROM "Meeting" m
      WHERE m."schoolId" = ${schoolId}
        AND EXISTS (SELECT 1 FROM unnest(m."attendees") AS a(name) WHERE a.name ILIKE ${pattern})`;
    return rows.map((r) => r.id);
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
    const { count } = await this.prisma.meeting.updateMany({ where: { id, schoolId }, data: meetingData(dto) });
    if (!count) throw new NotFoundException('Meeting not found');
    return { id };
  }

  /** Removes the meeting with its agenda items. */
  async remove(schoolId: string, id: string) {
    const { count } = await this.prisma.meeting.deleteMany({ where: { id, schoolId } });
    if (!count) throw new NotFoundException('Meeting not found');
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
    const { count } = await this.prisma.meetingAgendaItem.updateMany({ where: { id: itemId, meetingId, schoolId }, data: agendaData(dto) });
    if (!count) throw new NotFoundException('Agenda item not found');
    return { id: itemId };
  }

  async setAgendaState(schoolId: string, meetingId: string, itemId: string, dto: AgendaStateDto) {
    if (!dto.status && !dto.priority) throw new BadRequestException('Choose a status or a priority');
    const { count } = await this.prisma.meetingAgendaItem.updateMany({
      where: { id: itemId, meetingId, schoolId },
      data: { ...(dto.status && { status: dto.status }), ...(dto.priority && { priority: dto.priority }) },
    });
    if (!count) throw new NotFoundException('Agenda item not found');
    return { id: itemId };
  }

  async removeAgendaItem(schoolId: string, meetingId: string, itemId: string) {
    const { count } = await this.prisma.meetingAgendaItem.deleteMany({ where: { id: itemId, meetingId, schoolId } });
    if (!count) throw new NotFoundException('Agenda item not found');
    return { ok: true };
  }

  private async find(schoolId: string, id: string) {
    const row = await this.prisma.meeting.findFirst({ where: { id, schoolId }, select: { id: true } });
    if (!row) throw new NotFoundException('Meeting not found');
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
