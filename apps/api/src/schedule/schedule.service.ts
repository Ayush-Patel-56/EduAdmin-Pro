import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { TeacherScope } from '../academic/access.service.js';
import { istToday, parseDate, toIsoDate } from '../common/dates.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  type AdminSlotDto,
  type AdminSpecialClassDto,
  DAY_NAMES,
  formatMinute,
  type ScheduleQuery,
  type SpecialClassType,
  type TeacherSlotDto,
  type TeacherSpecialClassDto,
  toMinute,
} from './schedule.dto.js';

type Db = Prisma.TransactionClient;

const people = {
  faculty: { select: { id: true, name: true, email: true } },
  batch: { select: { id: true, name: true, program: { select: { id: true, name: true } } } },
  _count: { select: { occurrences: true } },
} as const;

type SlotRow = Prisma.ScheduleSlotGetPayload<{ include: typeof people }>;
type SpecialRow = Prisma.SpecialClassGetPayload<{ include: typeof people }>;

type SlotInput = {
  facultyId: string;
  batchId: string;
  subject: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  room: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  active: boolean;
};

type SpecialInput = {
  title: string;
  type: SpecialClassType;
  subject: string | null;
  batchId: string;
  facultyId: string | null;
  date: Date;
  startMinute: number;
  endMinute: number;
  room: string | null;
  notes: string | null;
};

/** One class on one date, from a weekly slot or a special class. */
export type DayClass = {
  key: string;
  kind: 'SLOT' | 'SPECIAL';
  id: string;
  title: string;
  subject: string | null;
  type: SpecialClassType | null;
  batch: { id: string; name: string; program: string };
  teacher: { id: string; name: string } | null;
  startMinute: number;
  endMinute: number;
  time: string;
  room: string | null;
};

const HH_MM = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const span = (start: number, end: number) => `${formatMinute(start)} - ${formatMinute(end)}`;
const DAY_MS = 86_400_000;

/**
 * Weekly slots and special classes (PRD 4.1, 5.2), and the classes they put on
 * a given day: the dashboards' Today's Schedule and the attendance class
 * picker read them from here. Every write runs under a per-school lock, so
 * the clash check (teacher, batch, room) can't be raced.
 */
@Injectable()
export class ScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  // Admin (Calendar > Class Schedules)

  async adminSlots(schoolId: string, query: ScheduleQuery) {
    const rows = await this.prisma.scheduleSlot.findMany({
      where: { schoolId, ...batchFilter(query) },
      orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
      include: people,
    });
    return rows.map(toSlot);
  }

  /** Coming special classes (today on), or with `past` the last 60 days. */
  async adminSpecialClasses(schoolId: string, query: ScheduleQuery) {
    const today = istToday();
    const rows = await this.prisma.specialClass.findMany({
      where: {
        schoolId,
        date: query.past ? { gte: new Date(today.getTime() - 60 * DAY_MS), lt: today } : { gte: today },
        ...batchFilter(query),
      },
      orderBy: [{ date: query.past ? 'desc' : 'asc' }, { startMinute: 'asc' }],
      include: people,
      take: 500,
    });
    return rows.map(toSpecial);
  }

  /** Teachers who can be given a class, with their batches (a slot needs one of them). */
  async facultyOptions(schoolId: string) {
    const faculty = await this.prisma.faculty.findMany({
      where: { schoolId, status: { not: 'INACTIVE' } },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        primarySubject: true,
        subjects: true,
        batchAssignments: { select: { batchId: true } },
      },
    });
    return faculty.map((f) => ({
      id: f.id,
      name: f.name,
      email: f.email,
      subject: f.primarySubject ?? f.subjects[0] ?? null,
      batchIds: f.batchAssignments.map((b) => b.batchId),
    }));
  }

  async createSlot(schoolId: string, userId: string, dto: AdminSlotDto) {
    return this.writeSlot(schoolId, slotInput(dto, dto.facultyId, dto.active), { createdById: userId });
  }

  async updateSlot(schoolId: string, id: string, dto: AdminSlotDto) {
    return this.writeSlot(schoolId, slotInput(dto, dto.facultyId, dto.active), { id });
  }

  async deleteSlot(schoolId: string, id: string) {
    await this.prisma.$transaction(async (tx) => {
      await lockSource(tx, 'ScheduleSlot', schoolId, id);
      await this.removeSlot(tx, id);
    });
    return { ok: true };
  }

  async createSpecialClass(schoolId: string, userId: string, dto: AdminSpecialClassDto) {
    return this.writeSpecial(schoolId, specialInput(dto, dto.facultyId ?? null), { createdById: userId });
  }

  async updateSpecialClass(schoolId: string, id: string, dto: AdminSpecialClassDto) {
    return this.writeSpecial(schoolId, specialInput(dto, dto.facultyId ?? null), { id });
  }

  async deleteSpecialClass(schoolId: string, id: string) {
    await this.prisma.$transaction(async (tx) => {
      await lockSource(tx, 'SpecialClass', schoolId, id);
      await this.removeSpecial(tx, id);
    });
    return { ok: true };
  }

  // Teacher (Schedule page): their own slots and special classes, in their batches

  async teacherSchedule(scope: TeacherScope) {
    if (!scope.active || !scope.facultyId) return { slots: [], specialClasses: [] };
    const [slots, specials] = await Promise.all([
      this.prisma.scheduleSlot.findMany({
        where: { schoolId: scope.schoolId, facultyId: scope.facultyId, batchId: { in: scope.batchIds } },
        orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
        include: people,
      }),
      this.prisma.specialClass.findMany({
        where: {
          schoolId: scope.schoolId,
          date: { gte: istToday() },
          batchId: { in: scope.batchIds },
          OR: [{ facultyId: scope.facultyId }, { facultyId: null }],
        },
        orderBy: [{ date: 'asc' }, { startMinute: 'asc' }],
        include: people,
        take: 200,
      }),
    ]);
    return {
      slots: slots.map(toSlot),
      specialClasses: specials.map((s) => ({ ...toSpecial(s), mine: s.facultyId === scope.facultyId })),
    };
  }

  async teacherCreateSlot(scope: TeacherScope, userId: string, dto: TeacherSlotDto) {
    const facultyId = requireTeacher(scope);
    requireBatch(scope, dto.batchId);
    return this.writeSlot(scope.schoolId, slotInput(dto, facultyId, true), { createdById: userId });
  }

  async teacherUpdateSlot(scope: TeacherScope, id: string, dto: TeacherSlotDto) {
    const facultyId = requireTeacher(scope);
    requireBatch(scope, dto.batchId);
    const current = await this.ownSlot(scope, id);
    return this.writeSlot(scope.schoolId, slotInput(dto, facultyId, current.active), { id });
  }

  async teacherDeleteSlot(scope: TeacherScope, id: string) {
    await this.prisma.$transaction(async (tx) => {
      await lockSource(tx, 'ScheduleSlot', scope.schoolId, id);
      await this.ownSlot(scope, id, tx);
      await this.removeSlot(tx, id);
    });
    return { ok: true };
  }

  async teacherCreateSpecialClass(scope: TeacherScope, userId: string, dto: TeacherSpecialClassDto) {
    const facultyId = requireTeacher(scope);
    requireBatch(scope, dto.batchId);
    return this.writeSpecial(scope.schoolId, specialInput(dto, facultyId), { createdById: userId });
  }

  async teacherUpdateSpecialClass(scope: TeacherScope, id: string, dto: TeacherSpecialClassDto) {
    const facultyId = requireTeacher(scope);
    requireBatch(scope, dto.batchId);
    await this.ownSpecial(scope, id);
    return this.writeSpecial(scope.schoolId, specialInput(dto, facultyId), { id });
  }

  async teacherDeleteSpecialClass(scope: TeacherScope, id: string) {
    await this.prisma.$transaction(async (tx) => {
      await lockSource(tx, 'SpecialClass', scope.schoolId, id);
      await this.ownSpecial(scope, id, tx);
      await this.removeSpecial(tx, id);
    });
    return { ok: true };
  }

  // Classes on a day

  /**
   * The classes on `date`: weekly slots running that day plus special classes
   * on it. A slot that already has attendance for the day is included even if
   * it was ended or switched off since, so that attendance stays reachable.
   * `who` limits it to one teacher: their slots, and special classes they
   * take (or that have no teacher yet), in their batches.
   */
  async classesOn(
    schoolId: string,
    date: Date,
    who: { facultyId: string; batchIds: string[] } | null = null,
    db: Db = this.prisma,
  ): Promise<DayClass[]> {
    const [slots, specials] = await Promise.all([
      db.scheduleSlot.findMany({
        where: {
          schoolId,
          ...(who && { facultyId: who.facultyId, batchId: { in: who.batchIds } }),
          OR: [
            {
              dayOfWeek: date.getUTCDay(),
              active: true,
              effectiveFrom: { lte: date },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
            },
            { occurrences: { some: { date } } },
          ],
        },
        include: people,
      }),
      db.specialClass.findMany({
        where: {
          schoolId,
          date,
          ...(who && {
            batchId: { in: who.batchIds },
            OR: [{ facultyId: who.facultyId }, { facultyId: null }],
          }),
        },
        include: people,
      }),
    ]);
    return [
      ...slots.map((s): DayClass => ({
        key: `slot:${s.id}`,
        kind: 'SLOT',
        id: s.id,
        title: s.subject,
        subject: s.subject,
        type: null,
        batch: { id: s.batch.id, name: s.batch.name, program: s.batch.program.name },
        teacher: { id: s.faculty.id, name: s.faculty.name },
        startMinute: s.startMinute,
        endMinute: s.endMinute,
        time: span(s.startMinute, s.endMinute),
        room: s.room,
      })),
      ...specials.map((s): DayClass => ({
        key: `special:${s.id}`,
        kind: 'SPECIAL',
        id: s.id,
        title: s.title,
        subject: s.subject,
        type: s.type,
        batch: { id: s.batch.id, name: s.batch.name, program: s.batch.program.name },
        teacher: s.faculty ? { id: s.faculty.id, name: s.faculty.name } : null,
        startMinute: s.startMinute,
        endMinute: s.endMinute,
        time: span(s.startMinute, s.endMinute),
        room: s.room,
      })),
    ].sort((a, b) => a.startMinute - b.startMinute || a.title.localeCompare(b.title));
  }

  /** The teacher's classes on `date` (none while inactive). */
  teacherClassesOn(scope: TeacherScope, date: Date, db: Db = this.prisma) {
    if (!scope.active || !scope.facultyId) return Promise.resolve([]);
    return this.classesOn(scope.schoolId, date, { facultyId: scope.facultyId, batchIds: scope.batchIds }, db);
  }

  /** The admin dashboard's Today's Class Schedule. */
  async adminToday(schoolId: string) {
    const classes = await this.classesOn(schoolId, istToday());
    return classes.map((c) => ({
      id: c.key,
      time: c.time,
      className: c.title,
      type: c.type,
      batch: c.batch.name,
      teacher: c.teacher?.name ?? '—',
      room: c.room ?? '—',
    }));
  }

  // Helpers

  private async writeSlot(schoolId: string, input: SlotInput, target: { id: string } | { createdById: string }) {
    checkTimes(input.startMinute, input.endMinute);
    if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) {
      throw new BadRequestException("Effective to can't be before effective from");
    }
    await this.checkTeacherAndBatch(schoolId, input.facultyId, input.batchId);
    const id = await this.prisma.$transaction(async (tx) => {
      await lockSchedule(tx, schoolId);
      if ('id' in target) {
        const current = await tx.scheduleSlot.findFirst({
          where: { id: target.id, schoolId },
          select: { batchId: true, _count: { select: { occurrences: true } } },
        });
        if (!current) throw new NotFoundException('Slot not found');
        if (current.batchId !== input.batchId && current._count.occurrences > 0) {
          throw new BadRequestException(
            'Attendance is recorded for this slot, so it stays with its batch. Set Effective To and add a new slot instead.',
          );
        }
      }
      if (input.active) {
        const clash = await slotClash(tx, schoolId, input, 'id' in target ? target.id : null);
        if (clash) throw new ConflictException(clash);
      }
      if ('id' in target) {
        await tx.scheduleSlot.update({ where: { id: target.id }, data: input });
        return target.id;
      }
      const row = await tx.scheduleSlot.create({
        data: { schoolId, ...input, createdById: target.createdById },
        select: { id: true },
      });
      return row.id;
    });
    return { id };
  }

  private async writeSpecial(schoolId: string, input: SpecialInput, target: { id: string } | { createdById: string }) {
    checkTimes(input.startMinute, input.endMinute);
    if (input.facultyId) await this.checkTeacherAndBatch(schoolId, input.facultyId, input.batchId);
    else await this.checkBatch(schoolId, input.batchId);
    const id = await this.prisma.$transaction(async (tx) => {
      await lockSchedule(tx, schoolId);
      if ('id' in target) {
        const current = await tx.specialClass.findFirst({
          where: { id: target.id, schoolId },
          select: { batchId: true, date: true, _count: { select: { occurrences: true } } },
        });
        if (!current) throw new NotFoundException('Special class not found');
        if (
          current._count.occurrences > 0 &&
          (current.batchId !== input.batchId || current.date.getTime() !== input.date.getTime())
        ) {
          throw new BadRequestException(
            "Attendance is recorded for this class, so its batch and date can't change",
          );
        }
      }
      const clash = await specialClash(tx, schoolId, input, 'id' in target ? target.id : null);
      if (clash) throw new ConflictException(clash);
      if ('id' in target) {
        await tx.specialClass.update({ where: { id: target.id }, data: input });
        return target.id;
      }
      const row = await tx.specialClass.create({
        data: { schoolId, ...input, createdById: target.createdById },
        select: { id: true },
      });
      return row.id;
    });
    return { id };
  }

  /** A teacher of this school (not inactive) who is assigned to the batch. */
  private async checkTeacherAndBatch(schoolId: string, facultyId: string, batchId: string) {
    const [faculty, batch] = await Promise.all([
      this.prisma.faculty.findFirst({
        where: { id: facultyId, schoolId, status: { not: 'INACTIVE' } },
        select: { name: true, batchAssignments: { where: { batchId }, select: { batchId: true } } },
      }),
      this.checkBatch(schoolId, batchId),
    ]);
    if (!faculty) throw new BadRequestException('Select a teacher of this school');
    if (faculty.batchAssignments.length === 0) {
      throw new BadRequestException(
        `${faculty.name} isn't assigned to ${batch.name}. Assign the batch on their Teacher Portal profile first.`,
      );
    }
  }

  private async checkBatch(schoolId: string, batchId: string) {
    const batch = await this.prisma.batch.findFirst({ where: { id: batchId, schoolId }, select: { name: true } });
    if (!batch) throw new BadRequestException('Select a batch of this school');
    return batch;
  }

  /** A slot with attendance stays (its sheets point at it); it can be ended or switched off instead. */
  private async removeSlot(tx: Db, id: string) {
    const taken = await tx.classOccurrence.count({ where: { slotId: id } });
    if (taken > 0) {
      throw new ConflictException(
        'Attendance is recorded for this slot, so it stays. Mark it inactive or set Effective To instead.',
      );
    }
    await tx.scheduleSlot.delete({ where: { id } });
  }

  private async removeSpecial(tx: Db, id: string) {
    const taken = await tx.classOccurrence.count({ where: { specialClassId: id } });
    if (taken > 0) {
      throw new ConflictException("Attendance is recorded for this class, so it can't be deleted");
    }
    await tx.specialClass.delete({ where: { id } });
  }

  /** The teacher's own slot, in a batch that is still theirs. */
  private async ownSlot(scope: TeacherScope, id: string, db: Db = this.prisma) {
    const facultyId = requireTeacher(scope);
    const row = await db.scheduleSlot.findFirst({
      where: { id, schoolId: scope.schoolId },
      select: { facultyId: true, batchId: true, active: true },
    });
    if (!row) throw new NotFoundException('Slot not found');
    if (row.facultyId !== facultyId) throw new ForbiddenException('Only your own slots can be changed here');
    if (!scope.batchIds.includes(row.batchId)) throw new ForbiddenException('That batch is no longer assigned to you');
    return row;
  }

  private async ownSpecial(scope: TeacherScope, id: string, db: Db = this.prisma) {
    const facultyId = requireTeacher(scope);
    const row = await db.specialClass.findFirst({
      where: { id, schoolId: scope.schoolId },
      select: { facultyId: true, batchId: true },
    });
    if (!row) throw new NotFoundException('Special class not found');
    if (row.facultyId !== facultyId) throw new ForbiddenException('Only special classes you take can be changed here');
    if (!scope.batchIds.includes(row.batchId)) throw new ForbiddenException('That batch is no longer assigned to you');
    return row;
  }
}

/** One schedule change per school at a time, so clash checks see each other. */
async function lockSchedule(tx: Db, schoolId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`schedule:${schoolId}`}))`;
}

/** Locks a slot or special class of this school (404 for anything else). */
export async function lockSource(tx: Db, table: 'ScheduleSlot' | 'SpecialClass', schoolId: string, id: string) {
  const rows =
    table === 'ScheduleSlot'
      ? await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "ScheduleSlot" WHERE "id" = ${id} AND "schoolId" = ${schoolId} FOR UPDATE`
      : await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "SpecialClass" WHERE "id" = ${id} AND "schoolId" = ${schoolId} FOR UPDATE`;
  if (rows.length === 0) {
    throw new NotFoundException(table === 'ScheduleSlot' ? 'Slot not found' : 'Special class not found');
  }
}

/**
 * Another active slot that same weekday, overlapping in time and period, or a
 * coming special class on that weekday within the period, with the same
 * teacher, batch or room.
 */
async function slotClash(tx: Db, schoolId: string, input: SlotInput, exceptId: string | null) {
  const other = await tx.scheduleSlot.findFirst({
    where: {
      schoolId,
      active: true,
      dayOfWeek: input.dayOfWeek,
      ...(exceptId && { id: { not: exceptId } }),
      startMinute: { lt: input.endMinute },
      endMinute: { gt: input.startMinute },
      ...(input.effectiveTo && { effectiveFrom: { lte: input.effectiveTo } }),
      AND: [
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: input.effectiveFrom } }] },
        { OR: sameResource(input.facultyId, input.batchId, input.room) },
      ],
    },
    include: people,
  });
  if (other) {
    return clashMessage(other, input, `${DAY_NAMES[other.dayOfWeek]} ${span(other.startMinute, other.endMinute)}`, other.subject);
  }
  // A special class still to come on that weekday, within the slot's period.
  const today = istToday();
  const specials = await tx.specialClass.findMany({
    where: {
      schoolId,
      date: { gte: input.effectiveFrom > today ? input.effectiveFrom : today, ...(input.effectiveTo && { lte: input.effectiveTo }) },
      startMinute: { lt: input.endMinute },
      endMinute: { gt: input.startMinute },
      OR: sameResource(input.facultyId, input.batchId, input.room),
    },
    orderBy: { date: 'asc' },
    include: people,
  });
  const special = specials.find((c) => c.date.getUTCDay() === input.dayOfWeek);
  return special
    ? clashMessage(special, input, `on ${toIsoDate(special.date)} ${span(special.startMinute, special.endMinute)}`, special.title)
    : null;
}

/** On the special class's date: another special class, or a running weekly slot, overlapping with the same teacher, batch or room. */
async function specialClash(tx: Db, schoolId: string, input: SpecialInput, exceptId: string | null) {
  const overlap = { startMinute: { lt: input.endMinute }, endMinute: { gt: input.startMinute } };
  const resource = sameResource(input.facultyId, input.batchId, input.room);
  const other = await tx.specialClass.findFirst({
    where: { schoolId, date: input.date, ...(exceptId && { id: { not: exceptId } }), ...overlap, OR: resource },
    include: people,
  });
  if (other) return clashMessage(other, input, span(other.startMinute, other.endMinute), other.title);
  const slot = await tx.scheduleSlot.findFirst({
    where: {
      schoolId,
      active: true,
      dayOfWeek: input.date.getUTCDay(),
      effectiveFrom: { lte: input.date },
      ...overlap,
      AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: input.date } }] }, { OR: resource }],
    },
    include: people,
  });
  return slot ? clashMessage(slot, input, `the weekly ${span(slot.startMinute, slot.endMinute)}`, slot.subject) : null;
}

function sameResource(facultyId: string | null, batchId: string, room: string | null) {
  return [
    ...(facultyId ? [{ facultyId }] : []),
    { batchId },
    ...(room ? [{ room: { equals: room, mode: 'insensitive' as const } }] : []),
  ];
}

function clashMessage(
  other: { facultyId: string | null; batchId: string; room: string | null; faculty: { name: string } | null; batch: { name: string } },
  input: { facultyId: string | null; batchId: string; room: string | null },
  when: string,
  what: string,
) {
  const reason =
    input.facultyId && other.facultyId === input.facultyId
      ? `${other.faculty?.name ?? 'This teacher'} already teaches then`
      : other.batchId === input.batchId
        ? `${other.batch.name} already has a class then`
        : `Room ${other.room} is already booked then`;
  return `${reason}: ${what} (${other.batch.name}), ${when}`;
}

function checkTimes(start: number, end: number) {
  if (end <= start) throw new BadRequestException('End time must be after the start time');
}

function requireTeacher(scope: TeacherScope) {
  if (!scope.active || !scope.facultyId) throw new ForbiddenException('Only active faculty can do this');
  return scope.facultyId;
}

function requireBatch(scope: TeacherScope, batchId: string) {
  if (!scope.batchIds.includes(batchId)) throw new ForbiddenException('Pick one of the batches assigned to you');
}

function batchFilter(query: ScheduleQuery) {
  if (query.batchId) return { batchId: query.batchId };
  if (query.programId) return { batch: { programId: query.programId } };
  return {};
}

function slotInput(dto: TeacherSlotDto, facultyId: string, active: boolean): SlotInput {
  return {
    facultyId,
    batchId: dto.batchId,
    subject: dto.subject,
    dayOfWeek: dto.dayOfWeek,
    startMinute: toMinute(dto.startTime),
    endMinute: toMinute(dto.endTime),
    room: dto.room ?? null,
    effectiveFrom: parseDate(dto.effectiveFrom, 'Effective from'),
    effectiveTo: dto.effectiveTo ? parseDate(dto.effectiveTo, 'Effective to') : null,
    active,
  };
}

function specialInput(dto: TeacherSpecialClassDto, facultyId: string | null): SpecialInput {
  return {
    title: dto.title,
    type: dto.type,
    subject: dto.subject ?? null,
    batchId: dto.batchId,
    facultyId,
    date: parseDate(dto.date, 'Date'),
    startMinute: toMinute(dto.startTime),
    endMinute: toMinute(dto.endTime),
    room: dto.room ?? null,
    notes: dto.notes ?? null,
  };
}

function toSlot(s: SlotRow) {
  return {
    id: s.id,
    subject: s.subject,
    dayOfWeek: s.dayOfWeek,
    day: DAY_NAMES[s.dayOfWeek],
    startTime: HH_MM(s.startMinute),
    endTime: HH_MM(s.endMinute),
    time: span(s.startMinute, s.endMinute),
    room: s.room,
    effectiveFrom: toIsoDate(s.effectiveFrom)!,
    effectiveTo: toIsoDate(s.effectiveTo),
    active: s.active,
    faculty: s.faculty,
    batch: { id: s.batch.id, name: s.batch.name },
    program: s.batch.program,
    hasAttendance: s._count.occurrences > 0,
  };
}

function toSpecial(s: SpecialRow) {
  return {
    id: s.id,
    title: s.title,
    type: s.type,
    subject: s.subject,
    date: toIsoDate(s.date)!,
    startTime: HH_MM(s.startMinute),
    endTime: HH_MM(s.endMinute),
    time: span(s.startMinute, s.endMinute),
    room: s.room,
    notes: s.notes,
    faculty: s.faculty,
    batch: { id: s.batch.id, name: s.batch.name },
    program: s.batch.program,
    hasAttendance: s._count.occurrences > 0,
  };
}
