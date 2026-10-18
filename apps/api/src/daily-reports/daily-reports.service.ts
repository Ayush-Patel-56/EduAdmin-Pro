import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { TeacherScope } from '../academic/access.service.js';
import { istToday, parseDate, toIsoDate } from '../common/dates.js';
import { duplicateAsConflict } from '../common/unique-violation.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AdminReportQuery, DailyReportDto } from './daily-reports.dto.js';

/** How many of a teacher's own reports "Your Recent Submissions" lists. */
export const RECENT_LIMIT = 50;
/** A report saved again this long after it was first submitted shows as edited. */
const EDIT_GRACE_MS = 60_000;

const include = {
  batch: { select: { id: true, name: true, program: { select: { id: true, name: true } } } },
} satisfies Prisma.DailyReportInclude;
type ReportRow = Prisma.DailyReportGetPayload<{ include: typeof include }>;

const duplicate = (subject: string) =>
  `You already submitted a ${subject} report for this batch on that date. Edit it in Your Recent Submissions instead.`;

/**
 * A report is On Time only when it is first submitted on the day it is about
 * (in India); one sent the next day or later, or for an earlier day, is Late.
 */
export function isLate(reportDate: Date, submittedAt: Date): boolean {
  return reportDate.getTime() < istToday(submittedAt).getTime();
}

/**
 * How many of today's classes still need a report: one report per batch and
 * subject covers that subject's classes in the batch (a double period is one
 * report); a class without a subject is covered by any report for its batch.
 */
export function pendingReports(
  classes: { batch: { id: string }; subject: string | null }[],
  reports: { batchId: string; subject: string }[],
): number {
  const done = new Set(reports.map((r) => `${r.batchId}|${r.subject.toLowerCase()}`));
  const batchesDone = new Set(reports.map((r) => r.batchId));
  const pending = new Set<string>();
  for (const c of classes) {
    const covered = c.subject ? done.has(`${c.batch.id}|${c.subject.toLowerCase()}`) : batchesDone.has(c.batch.id);
    if (!covered) pending.add(`${c.batch.id}|${(c.subject ?? '').toLowerCase()}`);
  }
  return pending.size;
}

/**
 * Daily class reports (PRD 4.8 admin view, 5.6 faculty form). A teacher files
 * and edits only their own reports, for batches assigned to them; admins read
 * every report of their school, day by day.
 */
@Injectable()
export class DailyReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // Admin

  async adminList(schoolId: string, query: AdminReportQuery) {
    const date = parseDate(query.date, 'Date');
    const rows = await this.prisma.dailyReport.findMany({
      where: {
        schoolId,
        reportDate: date,
        ...(query.batchId ? { batchId: query.batchId } : query.programId ? { batch: { programId: query.programId } } : {}),
      },
      include,
      orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
    });
    // The KPIs count the whole day (for the program/batch filter); the status tab only narrows the list.
    const late = rows.filter((r) => r.late).length;
    const items = query.status ? rows.filter((r) => r.late === (query.status === 'LATE')) : rows;
    return {
      date: query.date,
      kpis: {
        submitted: rows.length,
        late,
        teachers: new Set(rows.map((r) => r.facultyId ?? `name:${r.teacherName}`)).size,
        classes: new Set(rows.map((r) => r.batchId)).size,
      },
      items: items.map(toReport),
    };
  }

  // Faculty

  /** The form's choices: today's date (IST), the teacher's batches, and subjects to pick from. */
  async options(scope: TeacherScope) {
    const today = toIsoDate(istToday())!;
    if (!scope.active || !scope.facultyId) return { today, active: false, batches: [], subjects: ['General'] };
    const [batches, faculty, slots, specials] = await Promise.all([
      this.prisma.batch.findMany({
        where: { schoolId: scope.schoolId, id: { in: scope.batchIds } },
        select: { id: true, name: true, program: { select: { name: true } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.faculty.findUnique({ where: { id: scope.facultyId }, select: { primarySubject: true, subjects: true } }),
      this.prisma.scheduleSlot.findMany({
        where: { schoolId: scope.schoolId, facultyId: scope.facultyId, batchId: { in: scope.batchIds } },
        select: { subject: true },
        distinct: ['subject'],
      }),
      this.prisma.specialClass.findMany({
        where: { schoolId: scope.schoolId, facultyId: scope.facultyId, batchId: { in: scope.batchIds }, subject: { not: null } },
        select: { subject: true },
        distinct: ['subject'],
      }),
    ]);
    // The teacher's own subjects first, then what their timetable says they teach, then General.
    const scheduled = [...slots.map((s) => s.subject), ...specials.map((s) => s.subject!)].sort((a, b) => a.localeCompare(b));
    const seen = new Set<string>();
    const subjects: string[] = [];
    for (const s of [faculty?.primarySubject, ...(faculty?.subjects ?? []), ...scheduled, 'General']) {
      const name = s?.trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      subjects.push(name);
    }
    return {
      today,
      active: true,
      batches: batches.map((b) => ({ id: b.id, name: b.name, program: b.program.name })),
      subjects,
    };
  }

  /** Your Recent Submissions: the teacher's own reports, newest day first. Kept readable after they leave. */
  async teacherList(scope: TeacherScope) {
    if (!scope.facultyId) return [];
    const rows = await this.prisma.dailyReport.findMany({
      where: { schoolId: scope.schoolId, facultyId: scope.facultyId },
      include,
      orderBy: [{ reportDate: 'desc' }, { submittedAt: 'desc' }],
      take: RECENT_LIMIT,
    });
    return rows.map(toReport);
  }

  async submit(scope: TeacherScope, dto: DailyReportDto) {
    const facultyId = requireTeacher(scope);
    const now = new Date();
    const date = reportDay(dto.date, now);
    requireBatch(scope, dto.batchId);
    return duplicateAsConflict(
      () =>
        this.prisma.$transaction(async (tx) => {
          // Shared: a batch being deleted holds it FOR UPDATE, so this waits and then sees it gone.
          await lockBatch(tx, scope.schoolId, dto.batchId);
          const faculty = await tx.faculty.findUniqueOrThrow({ where: { id: facultyId }, select: { name: true } });
          const row = await tx.dailyReport.create({
            data: {
              schoolId: scope.schoolId,
              facultyId,
              teacherName: faculty.name,
              batchId: dto.batchId,
              reportDate: date,
              ...fields(dto),
              late: isLate(date, now),
              submittedAt: now,
            },
            select: { id: true, late: true },
          });
          return { id: row.id, late: row.late };
        }),
      duplicate(dto.subject),
    );
  }

  /**
   * Editing keeps the report's On Time / Late status: it was submitted when it
   * was. Moving it to another day makes it a report for that day, submitted
   * now, so its status is worked out again.
   */
  async update(scope: TeacherScope, id: string, dto: DailyReportDto) {
    const facultyId = requireTeacher(scope);
    const now = new Date();
    const date = reportDay(dto.date, now);
    requireBatch(scope, dto.batchId);
    const current = await this.own(scope, facultyId, id);
    const moved = current.reportDate.getTime() !== date.getTime();
    const submittedAt = moved ? now : current.submittedAt;
    return duplicateAsConflict(
      () =>
        this.prisma.$transaction(async (tx) => {
          await lockBatch(tx, scope.schoolId, dto.batchId);
          // Scoped in the write, so a report deleted meanwhile is a 404, not a 500.
          const { count } = await tx.dailyReport.updateMany({
            where: { id, schoolId: scope.schoolId, facultyId },
            data: { batchId: dto.batchId, reportDate: date, ...fields(dto), submittedAt, late: isLate(date, submittedAt) },
          });
          if (!count) throw new NotFoundException('Report not found');
          return { id, late: isLate(date, submittedAt) };
        }),
      duplicate(dto.subject),
    );
  }

  async remove(scope: TeacherScope, id: string) {
    const facultyId = requireTeacher(scope);
    await this.own(scope, facultyId, id);
    const { count } = await this.prisma.dailyReport.deleteMany({ where: { id, schoolId: scope.schoolId, facultyId } });
    if (!count) throw new NotFoundException('Report not found');
    return { ok: true };
  }

  /** The teacher's own report, for a batch still assigned to them. */
  private async own(scope: TeacherScope, facultyId: string, id: string) {
    const row = await this.prisma.dailyReport.findFirst({
      where: { id, schoolId: scope.schoolId, facultyId },
      select: { batchId: true, reportDate: true, submittedAt: true },
    });
    if (!row) throw new NotFoundException('Report not found');
    if (!scope.batchIds.includes(row.batchId)) {
      throw new ForbiddenException("This report is for a batch you're no longer assigned to");
    }
    return row;
  }
}

function requireTeacher(scope: TeacherScope): string {
  if (!scope.active || !scope.facultyId) throw new ForbiddenException('Only active faculty can submit daily reports');
  return scope.facultyId;
}

function requireBatch(scope: TeacherScope, batchId: string) {
  if (!scope.batchIds.includes(batchId)) throw new ForbiddenException("You aren't assigned to that batch");
}

/** The day taught: any day up to today (IST), never a day still to come. */
function reportDay(value: string, now: Date): Date {
  const date = parseDate(value, 'Date');
  if (date > istToday(now)) throw new BadRequestException("You can't report a day that hasn't happened yet");
  return date;
}

async function lockBatch(tx: Prisma.TransactionClient, schoolId: string, batchId: string) {
  const rows = await tx.$queryRaw<unknown[]>`
    SELECT 1 FROM "Batch" WHERE "id" = ${batchId} AND "schoolId" = ${schoolId} FOR SHARE`;
  if (!rows.length) throw new BadRequestException('Select one of your batches');
}

function fields(dto: DailyReportDto) {
  return {
    subject: dto.subject,
    chapter: dto.chapter ?? null,
    topics: dto.topics,
    homework: dto.homework ?? null,
    observations: dto.observations ?? null,
  };
}

function toReport(r: ReportRow) {
  return {
    id: r.id,
    date: toIsoDate(r.reportDate)!,
    teacher: { id: r.facultyId, name: r.teacherName },
    batch: { id: r.batch.id, name: r.batch.name },
    program: r.batch.program,
    subject: r.subject,
    chapter: r.chapter,
    topics: r.topics,
    homework: r.homework,
    observations: r.observations,
    late: r.late,
    submittedAt: r.submittedAt.toISOString(),
    edited: r.updatedAt.getTime() - r.submittedAt.getTime() > EDIT_GRACE_MS,
  };
}
