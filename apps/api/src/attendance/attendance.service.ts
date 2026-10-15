import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { TeacherScope } from '../academic/access.service.js';
import { istToday, parseDate, toIsoDate } from '../common/dates.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  type DayClass,
  lockSource,
  ScheduleService,
} from '../schedule/schedule.service.js';
import { FilesService } from '../storage/files.service.js';
import type {
  AttendanceStatus,
  DayQuery,
  OverviewQuery,
  SheetQuery,
  SubmitAttendanceDto,
} from './attendance.dto.js';

type Db = Prisma.TransactionClient;
const DAY_MS = 86_400_000;

type Counts = Record<AttendanceStatus, number>;
const noCounts = (): Counts => ({ PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 });

/**
 * Attendance (PRD 4.11, 5.10). A teacher marks one class on one date (a
 * "class occurrence"): every student of its batch, saved in one transaction.
 *
 * Rates count student-days: a student is present on a day if they were
 * Present or Late in any class of it, absent if they missed every class that
 * wasn't Excused, and a day that was only Excused doesn't count either way.
 * Days without records (Sundays, holidays, unmarked days) are not absences.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schedule: ScheduleService,
    private readonly files: FilesService,
  ) {}

  // Teacher: Attendance Marking

  /** The teacher's classes on the date, each with what was already submitted. */
  async teacherClasses(scope: TeacherScope, query: DayQuery) {
    const date = parseDate(query.date, 'Date');
    const classes = await this.schedule.teacherClassesOn(scope, date);
    const sheets = await this.occurrences(scope.schoolId, date, classes);
    return classes.map((c) => {
      const sheet = sheets.get(c.key);
      return {
        ...c,
        attendance: sheet
          ? {
              submittedAt: sheet.submittedAt.toISOString(),
              counts: count(sheet.records),
            }
          : null,
      };
    });
  }

  /** One class's sheet: the batch's active students (and anyone already marked), with their marks. */
  async sheet(scope: TeacherScope, query: SheetQuery) {
    const date = parseDate(query.date, 'Date');
    const cls = await this.teacherClass(scope, date, query.class);
    const occurrence = (
      await this.occurrences(scope.schoolId, date, [cls])
    ).get(cls.key);
    const students = await roster(
      this.prisma,
      scope.schoolId,
      occurrence?.batchId ?? cls.batch.id,
      occurrence?.id ?? null,
    );
    const marks = new Map(
      occurrence?.records.map((r) => [r.studentId, r]) ?? [],
    );
    return {
      date: query.date,
      class: cls,
      // A future class can be seen but not marked.
      canSubmit: date <= istToday(),
      submittedAt: occurrence?.submittedAt.toISOString() ?? null,
      students: await Promise.all(
        students.map(async (s) => ({
          id: s.id,
          fullName: s.fullName,
          rollNumber: s.rollNumber,
          photoUrl: s.photo ? await this.files.url(s.photo) : s.profileImageUrl,
          status: marks.get(s.id)?.status ?? null,
          note: marks.get(s.id)?.note ?? null,
        })),
      ),
    };
  }

  /**
   * Saves the whole sheet at once. The class row is locked, so two
   * submissions for the same class queue up instead of mixing their marks,
   * and the roster is re-read inside the lock: a sheet that no longer matches
   * it (a student added or moved meanwhile) is refused, not half-saved.
   *
   * Locks are taken in the order deleting a batch takes them (the batch,
   * then its classes), so a submit racing a batch delete waits instead of
   * deadlocking: the batch gets a shared lock before the class row.
   */
  async submit(scope: TeacherScope, userId: string, dto: SubmitAttendanceDto) {
    if (!scope.active || !scope.facultyId)
      throw new ForbiddenException('Only active faculty can mark attendance');
    const date = parseDate(dto.date, 'Date');
    if (date > istToday())
      throw new BadRequestException(
        "Attendance can't be marked for a future date",
      );
    const ids = dto.records.map((r) => r.studentId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException('Each student can be marked only once');
    const [kind, sourceId] = dto.class.split(':') as [
      'slot' | 'special',
      string,
    ];

    return this.prisma
      .$transaction(
        async (tx) => {
          const source =
            kind === 'slot'
              ? await tx.scheduleSlot.findFirst({
                  where: { id: sourceId, schoolId: scope.schoolId },
                  select: { batchId: true },
                })
              : await tx.specialClass.findFirst({
                  where: { id: sourceId, schoolId: scope.schoolId },
                  select: { batchId: true },
                });
          if (!source)
            throw new NotFoundException(
              "That isn't one of your classes on this date",
            );
          const batch = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Batch" WHERE "id" = ${source.batchId} AND "schoolId" = ${scope.schoolId} FOR SHARE`;
          if (batch.length === 0)
            throw new NotFoundException(
              "That isn't one of your classes on this date",
            );
          await lockSource(
            tx,
            kind === 'slot' ? 'ScheduleSlot' : 'SpecialClass',
            scope.schoolId,
            sourceId,
          );
          const cls = await this.teacherClass(scope, date, dto.class, tx);
          // Moved to another batch between the read and the lock.
          if (cls.batch.id !== source.batchId) {
            throw new ConflictException(
              'This class changed batch. Refresh and mark again.',
            );
          }
          const existing = (
            await this.occurrences(scope.schoolId, date, [cls], tx)
          ).get(cls.key);
          const batchId = existing?.batchId ?? cls.batch.id;
          const onRoster = new Set(
            (
              await roster(tx, scope.schoolId, batchId, existing?.id ?? null)
            ).map((s) => s.id),
          );
          if (ids.some((id) => !onRoster.has(id))) {
            throw new BadRequestException(
              'The student list has changed. Refresh and mark again.',
            );
          }
          const left = onRoster.size - ids.length;
          if (left > 0)
            throw new BadRequestException(
              `Mark every student first (${left} left)`,
            );

          const details = {
            title: cls.title,
            subject: cls.subject,
            type: cls.type,
            startMinute: cls.startMinute,
            endMinute: cls.endMinute,
            room: cls.room,
            facultyId: scope.facultyId,
            markedById: userId,
            submittedAt: new Date(),
          };
          const occurrenceId = existing
            ? (
                await tx.classOccurrence.update({
                  where: { id: existing.id },
                  data: details,
                  select: { id: true },
                })
              ).id
            : (
                await tx.classOccurrence.create({
                  data: {
                    schoolId: scope.schoolId,
                    date,
                    batchId,
                    ...(kind === 'slot'
                      ? { slotId: sourceId }
                      : { specialClassId: sourceId }),
                    ...details,
                  },
                  select: { id: true },
                })
              ).id;
          await tx.attendanceRecord.deleteMany({ where: { occurrenceId } });
          await tx.attendanceRecord.createMany({
            data: dto.records.map((r) => ({
              schoolId: scope.schoolId,
              occurrenceId,
              studentId: r.studentId,
              status: r.status,
              note: r.note ?? null,
            })),
          });
          return {
            submittedAt: details.submittedAt.toISOString(),
            counts: count(dto.records),
          };
        },
        { timeout: 20_000, maxWait: 10_000 },
      )
      .catch((err: unknown) => {
        // A student deleted while the sheet was being saved.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2003'
        ) {
          throw new ConflictException(
            'The student list has changed. Refresh and mark again.',
          );
        }
        throw err;
      });
  }

  // Admin: Attendance Overview

  async overview(schoolId: string, query: OverviewQuery) {
    const days = query.days ?? 30;
    const to = istToday();
    const from = new Date(to.getTime() - (days - 1) * DAY_MS);
    const previousFrom = new Date(from.getTime() - days * DAY_MS);
    const half = new Date(from.getTime() + Math.floor(days / 2) * DAY_MS);
    const scopeSql = Prisma.sql`
      FROM "AttendanceRecord" r
      JOIN "ClassOccurrence" o ON o."id" = r."occurrenceId" AND o."schoolId" = r."schoolId"
      JOIN "Batch" b ON b."id" = o."batchId" AND b."schoolId" = o."schoolId"
      WHERE r."schoolId" = ${schoolId}
        ${query.programId ? Prisma.sql`AND b."programId" = ${query.programId}` : Prisma.empty}
        ${query.batchId ? Prisma.sql`AND o."batchId" = ${query.batchId}` : Prisma.empty}`;

    // Student-days per batch and date, over this period and the one before (for the trend).
    const batchDays = await this.prisma.$queryRaw<
      { batchId: string; date: Date; present: number; absent: number }[]
    >`
      WITH sd AS (
        SELECT r."studentId", o."batchId", o."date",
               bool_or(r."status" IN ('PRESENT', 'LATE')) AS present,
               bool_and(r."status" = 'EXCUSED') AS excused
        ${scopeSql}
          AND o."date" BETWEEN ${iso(previousFrom)}::date AND ${iso(to)}::date
        GROUP BY 1, 2, 3)
      SELECT "batchId", "date",
             count(*) FILTER (WHERE present)::int AS present,
             count(*) FILTER (WHERE NOT present AND NOT excused)::int AS absent
      FROM sd GROUP BY 1, 2`;
    // Per student over this period (a day in two batches counts once).
    const studentDays = await this.prisma.$queryRaw<
      {
        studentId: string;
        present: number;
        absent: number;
        lastAbsent: Date | null;
      }[]
    >`
      WITH sd AS (
        SELECT r."studentId", o."date",
               bool_or(r."status" IN ('PRESENT', 'LATE')) AS present,
               bool_and(r."status" = 'EXCUSED') AS excused
        ${scopeSql}
          AND o."date" BETWEEN ${iso(from)}::date AND ${iso(to)}::date
        GROUP BY 1, 2)
      SELECT "studentId",
             count(*) FILTER (WHERE present)::int AS present,
             count(*) FILTER (WHERE NOT present AND NOT excused)::int AS absent,
             max("date") FILTER (WHERE NOT present AND NOT excused) AS "lastAbsent"
      FROM sd GROUP BY 1`;

    const current = batchDays.filter((d) => d.date >= from);
    const previous = batchDays.filter((d) => d.date < from);
    const batchIds = [...new Set(current.map((d) => d.batchId))];
    const [batches, students] = await Promise.all([
      this.prisma.batch.findMany({
        where: { schoolId, id: { in: batchIds } },
        select: { id: true, name: true, program: { select: { name: true } } },
      }),
      this.prisma.student.findMany({
        where: { schoolId, id: { in: studentDays.map((s) => s.studentId) } },
        select: {
          id: true,
          fullName: true,
          rollNumber: true,
          batch: { select: { name: true } },
        },
      }),
    ]);

    const dates = Array.from({ length: days }, (_, i) =>
      iso(new Date(from.getTime() + i * DAY_MS)),
    );
    const batchRows = batches
      .map((b) => {
        const mine = current.filter((d) => d.batchId === b.id);
        const byDate = new Map(mine.map((d) => [iso(d.date), d]));
        const firstHalf = rate(mine.filter((d) => d.date < half));
        const secondHalf = rate(mine.filter((d) => d.date >= half));
        return {
          id: b.id,
          name: b.name,
          program: b.program.name,
          rate: rate(mine),
          // Lower by 5 points or more in the second half of the period.
          declining:
            firstHalf !== null &&
            secondHalf !== null &&
            secondHalf <= firstHalf - 5,
          cells: dates.map((date) => {
            const d = byDate.get(date);
            return {
              date,
              present: d?.present ?? 0,
              absent: d?.absent ?? 0,
              rate: d ? rate([d]) : null,
            };
          }),
        };
      })
      .sort(
        (a, b) =>
          a.program.localeCompare(b.program) || a.name.localeCompare(b.name),
      );

    const studentById = new Map(students.map((s) => [s.id, s]));
    const studentRows = studentDays
      .filter((s) => studentById.has(s.studentId))
      .map((s) => {
        const student = studentById.get(s.studentId)!;
        return {
          id: s.studentId,
          fullName: student.fullName,
          rollNumber: student.rollNumber,
          batch: student.batch?.name ?? null,
          presentDays: s.present,
          absentDays: s.absent,
          rate:
            s.present + s.absent
              ? round((s.present / (s.present + s.absent)) * 100)
              : null,
          lastAbsent: toIsoDate(s.lastAbsent),
        };
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName));

    const overall = rate(current);
    const before = rate(previous);
    return {
      range: { from: iso(from), to: iso(to), days },
      kpis: {
        rate: overall,
        // Change in percentage points against the period before (null without data then).
        change:
          overall !== null && before !== null ? round(overall - before) : null,
        batchesBelow75: batchRows.filter((b) => b.rate !== null && b.rate < 75)
          .length,
        perfectAttendance: studentRows.filter(
          (s) => s.presentDays > 0 && s.absentDays === 0,
        ).length,
      },
      heatmap: { dates, batches: batchRows },
      attention: batchRows
        .filter((b) => (b.rate !== null && b.rate < 75) || b.declining)
        .sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0))
        .map(({ cells: _cells, ...b }) => b),
      students: studentRows,
    };
  }

  // Helpers

  /** One of the teacher's classes on the date, or a 404. */
  private async teacherClass(
    scope: TeacherScope,
    date: Date,
    key: string,
    db?: Db,
  ) {
    const cls = (await this.schedule.teacherClassesOn(scope, date, db)).find(
      (c) => c.key === key,
    );
    if (!cls)
      throw new NotFoundException(
        "That isn't one of your classes on this date",
      );
    return cls;
  }

  /** The submitted sheets of these classes on the date, by class key. */
  private async occurrences(
    schoolId: string,
    date: Date,
    classes: DayClass[],
    db: Db = this.prisma,
  ) {
    const slotIds = classes.filter((c) => c.kind === 'SLOT').map((c) => c.id);
    const specialIds = classes
      .filter((c) => c.kind === 'SPECIAL')
      .map((c) => c.id);
    const rows =
      slotIds.length + specialIds.length === 0
        ? []
        : await db.classOccurrence.findMany({
            where: {
              schoolId,
              OR: [
                { slotId: { in: slotIds }, date },
                { specialClassId: { in: specialIds } },
              ],
            },
            select: {
              id: true,
              batchId: true,
              slotId: true,
              specialClassId: true,
              submittedAt: true,
              records: {
                select: { studentId: true, status: true, note: true },
              },
            },
          });
    return new Map(
      rows.map((o) => [
        o.slotId ? `slot:${o.slotId}` : `special:${o.specialClassId}`,
        o,
      ]),
    );
  }
}

/** Who is on a class's sheet: the batch's active students, plus anyone already marked on it. */
function roster(
  db: Db,
  schoolId: string,
  batchId: string,
  occurrenceId: string | null,
) {
  return db.student.findMany({
    where: {
      schoolId,
      OR: [
        { batchId, status: 'ACTIVE' },
        ...(occurrenceId ? [{ attendance: { some: { occurrenceId } } }] : []),
      ],
    },
    orderBy: [{ rollNumber: 'asc' }, { fullName: 'asc' }],
    select: {
      id: true,
      fullName: true,
      rollNumber: true,
      profileImageUrl: true,
      photo: { select: { key: true, originalName: true, contentType: true } },
    },
  });
}

function count(records: { status: AttendanceStatus }[]) {
  const counts = noCounts();
  for (const r of records) counts[r.status] += 1;
  return counts;
}

/** Present student-days over present + absent, in percent (one decimal); null with nothing to count. */
function rate(rows: { present: number; absent: number }[]) {
  const present = rows.reduce((n, r) => n + r.present, 0);
  const absent = rows.reduce((n, r) => n + r.absent, 0);
  return present + absent ? round((present / (present + absent)) * 100) : null;
}

const round = (n: number) => Math.round(n * 10) / 10;
const iso = (d: Date) => d.toISOString().slice(0, 10);
