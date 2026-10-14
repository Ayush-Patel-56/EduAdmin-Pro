import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { istToday, parseDate, toIsoDate } from '../common/dates.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { occurrences, spanProblem } from './calendar-rules.js';
import type { CalendarEventDto, EventRangeQuery, UpcomingQuery } from './calendar.dto.js';

const DAY = 86_400_000;
/** The widest range one request may expand (a month view asks for six weeks). */
const MAX_RANGE_DAYS = 400;

const include = {
  program: { select: { id: true, name: true } },
  batch: { select: { id: true, name: true } },
} satisfies Prisma.CalendarEventInclude;
type EventRow = Prisma.CalendarEventGetPayload<{ include: typeof include }>;

/**
 * The Academic Calendar (PRD 4.15), admin only. Events are stored once and
 * expanded into their occurrences for the dates asked for, so the month,
 * week and list views and Upcoming Events all read the same records.
 */
@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every occurrence overlapping [from, to], in date order. */
  async occurrencesIn(schoolId: string, query: EventRangeQuery) {
    const from = parseDate(query.from, 'From');
    const to = parseDate(query.to, 'To');
    if (to < from) throw new BadRequestException("To can't be before from");
    if ((to.getTime() - from.getTime()) / DAY > MAX_RANGE_DAYS) throw new BadRequestException(`Ask for at most ${MAX_RANGE_DAYS} days at a time`);
    const scope = await this.scopeWhere(schoolId, query);
    return this.expand(schoolId, scope, from, to);
  }

  /** The next occurrences from today, within a year. */
  async upcoming(schoolId: string, query: UpcomingQuery) {
    const today = istToday();
    const scope = await this.scopeWhere(schoolId, query);
    const list = await this.expand(schoolId, scope, today, new Date(today.getTime() + 365 * DAY));
    return list.slice(0, query.limit ?? 5);
  }

  async create(schoolId: string, userId: string, dto: CalendarEventDto) {
    const data = await this.eventData(schoolId, dto);
    const row = await this.prisma.calendarEvent.create({ data: { schoolId, createdById: userId, ...data }, select: { id: true } });
    return { id: row.id };
  }

  /** Changes a repeating event's whole series. */
  async update(schoolId: string, id: string, dto: CalendarEventDto) {
    await this.find(schoolId, id);
    await this.prisma.calendarEvent.update({ where: { id }, data: await this.eventData(schoolId, dto) });
    return { id };
  }

  async remove(schoolId: string, id: string) {
    await this.find(schoolId, id);
    await this.prisma.calendarEvent.delete({ where: { id } });
    return { ok: true };
  }

  private async expand(schoolId: string, scope: Prisma.CalendarEventWhereInput, from: Date, to: Date) {
    const rows = await this.prisma.calendarEvent.findMany({
      where: {
        schoolId,
        startDate: { lte: to },
        // Both are OR-lists, so they are combined, never merged into one key.
        AND: [
          scope,
          {
            OR: [
              { endDate: { gte: from } },
              { repeat: { not: 'NONE' }, OR: [{ repeatUntil: null }, { repeatUntil: { gte: new Date(from.getTime() - 31 * DAY) } }] },
            ],
          },
        ],
      },
      include,
      orderBy: [{ startDate: 'asc' }, { title: 'asc' }],
    });
    return rows
      .flatMap((e) =>
        occurrences(e, from, to).map((o) => ({
          key: `${e.id}:${toIsoDate(o.start)}`,
          ...toEvent(e),
          date: toIsoDate(o.start)!,
          endsOn: toIsoDate(o.end)!,
        })),
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  }

  /**
   * The sidebar's Program / Batch filter: school-wide events, plus those for
   * the chosen program (and its batches) or the chosen batch (and its program).
   */
  private async scopeWhere(schoolId: string, q: { programId?: string | null; batchId?: string | null }): Promise<Prisma.CalendarEventWhereInput> {
    const schoolWide = { programId: null, batchId: null };
    if (q.batchId) {
      const batch = await this.prisma.batch.findFirst({ where: { id: q.batchId, schoolId }, select: { programId: true } });
      if (!batch) throw new NotFoundException('Batch not found');
      return { OR: [schoolWide, { batchId: q.batchId }, { programId: batch.programId, batchId: null }] };
    }
    if (q.programId) return { OR: [schoolWide, { programId: q.programId }] };
    return {};
  }

  private async find(schoolId: string, id: string) {
    const row = await this.prisma.calendarEvent.findFirst({ where: { id, schoolId }, select: { id: true } });
    if (!row) throw new NotFoundException('Event not found');
  }

  /** Checks the dates, the repeat and the scope (a batch brings its program). */
  private async eventData(schoolId: string, dto: CalendarEventDto) {
    const startDate = parseDate(dto.startDate, 'Start date');
    const endDate = parseDate(dto.endDate, 'End date');
    const repeatUntil = dto.repeatUntil ? parseDate(dto.repeatUntil, 'Repeat until') : null;
    const problem = spanProblem({ startDate, endDate, repeat: dto.repeat, repeatUntil });
    if (problem) throw new BadRequestException(problem);
    let programId: string | null = null;
    let batchId: string | null = null;
    if (dto.scope === 'BATCH') {
      const batch = await this.prisma.batch.findFirst({ where: { id: dto.batchId!, schoolId }, select: { id: true, programId: true } });
      if (!batch) throw new BadRequestException('Select a batch of this school');
      batchId = batch.id;
      programId = batch.programId;
    } else if (dto.scope === 'PROGRAM') {
      const program = await this.prisma.program.findFirst({ where: { id: dto.programId!, schoolId }, select: { id: true } });
      if (!program) throw new BadRequestException('Select a program of this school');
      programId = program.id;
    }
    return {
      title: dto.title,
      type: dto.type,
      programId,
      batchId,
      startDate,
      endDate,
      description: dto.description ?? null,
      repeat: dto.repeat,
      repeatUntil,
    };
  }
}

function toEvent(e: EventRow) {
  return {
    id: e.id,
    title: e.title,
    type: e.type,
    description: e.description,
    scope: e.batch ? ('BATCH' as const) : e.program ? ('PROGRAM' as const) : ('SCHOOL' as const),
    program: e.program,
    batch: e.batch,
    startDate: toIsoDate(e.startDate)!,
    endDate: toIsoDate(e.endDate)!,
    repeat: e.repeat,
    repeatUntil: toIsoDate(e.repeatUntil),
  };
}
