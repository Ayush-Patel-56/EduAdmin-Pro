import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { TeacherScope } from '../academic/access.service.js';
import { isForeignKeyViolation } from '../assessments/tests.service.js';
import { istToday, parseDate, toIsoDate } from '../common/dates.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RATING_LEVELS } from './report-math.js';
import type { RatingSheetQuery, RatingsDto } from './student-reports.dto.js';

const dayLabel = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Student Ratings (PRD 5.7), faculty only. A teacher rates the students of
 * their own batches for a day on four dimensions; each teacher's rating of a
 * student for a day is their own row, so two teachers never overwrite each
 * other. The 5-in-1 report averages them all into the behaviour score.
 */
@Injectable()
export class RatingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The page's choices: today (India), the rating levels and the teacher's batches. */
  async options(scope: TeacherScope) {
    const today = toIsoDate(istToday())!;
    if (!scope.active || !scope.facultyId) return { today, active: false, levels: RATING_LEVELS, batches: [] };
    const batches = await this.prisma.batch.findMany({
      where: { schoolId: scope.schoolId, id: { in: scope.batchIds } },
      select: { id: true, name: true, program: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    return { today, active: true, levels: RATING_LEVELS, batches: batches.map((b) => ({ id: b.id, name: b.name, program: b.program.name })) };
  }

  /**
   * The rating grid for a day: the batch's active students, with the ratings
   * this teacher gave them that day (and anyone they rated in this batch that
   * day who has since left it, so a saved rating never disappears from view).
   */
  async sheet(scope: TeacherScope, query: RatingSheetQuery) {
    const date = parseDate(query.date, 'Date');
    if (!scope.active || !scope.facultyId) return { date: query.date, students: [] };
    if (!scope.batchIds.includes(query.batchId)) throw new ForbiddenException("You aren't assigned to that batch");
    const facultyId = scope.facultyId;
    const [students, ratings] = await Promise.all([
      this.prisma.student.findMany({
        where: {
          schoolId: scope.schoolId,
          OR: [{ batchId: query.batchId, status: 'ACTIVE' }, { ratings: { some: { date, facultyId, batchId: query.batchId } } }],
        },
        select: { id: true, fullName: true, rollNumber: true },
        orderBy: [{ rollNumber: { sort: 'asc', nulls: 'last' } }, { fullName: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.dailyRating.findMany({
        where: { schoolId: scope.schoolId, date, facultyId, batchId: query.batchId },
        select: { studentId: true, attitude: true, behaviour: true, focus: true, interaction: true, notes: true, updatedAt: true },
      }),
    ]);
    const byStudent = new Map(ratings.map((r) => [r.studentId, r]));
    return {
      date: query.date,
      students: students.map((s) => {
        const r = byStudent.get(s.id);
        return {
          student: s,
          rating: r ? { attitude: r.attitude, behaviour: r.behaviour, focus: r.focus, interaction: r.interaction, notes: r.notes, updatedAt: r.updatedAt.toISOString() } : null,
        };
      }),
    };
  }

  /**
   * Saves the ratings for a day (Save All Ratings): one statement inserting or
   * updating this teacher's row for each student. The students must be active
   * in the batch now; the day can't be in the future, before the batch began or after it ended.
   */
  async save(scope: TeacherScope, dto: RatingsDto) {
    const facultyId = requireTeacher(scope);
    if (!scope.batchIds.includes(dto.batchId)) throw new ForbiddenException("You aren't assigned to that batch");
    const date = parseDate(dto.date, 'Date');
    if (date > istToday()) throw new BadRequestException("You can't rate a day that hasn't come yet");
    const ids = dto.ratings.map((r) => r.studentId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Each student can be rated once per save');
    const faculty = await this.prisma.faculty.findUniqueOrThrow({ where: { id: facultyId }, select: { name: true } });
    try {
      await this.prisma.$transaction(async (tx) => {
        // The batch and students shared-locked, so neither is deleted or moved mid-save.
        const [batch] = await tx.$queryRaw<{ startDate: Date; endDate: Date | null }[]>`SELECT "startDate", "endDate" FROM "Batch" WHERE "id" = ${dto.batchId} AND "schoolId" = ${scope.schoolId} FOR SHARE`;
        if (!batch) throw new NotFoundException('Batch not found');
        if (date < batch.startDate) throw new BadRequestException(`Pick a day on or after the batch started (${dayLabel.format(batch.startDate)})`);
        if (batch.endDate && date > batch.endDate) throw new BadRequestException(`Pick a day on or before the batch ended (${dayLabel.format(batch.endDate)})`);
        const inBatch = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Student" WHERE "id" IN (${Prisma.join(ids)}) AND "schoolId" = ${scope.schoolId} AND "batchId" = ${dto.batchId} AND "status" = 'ACTIVE' FOR SHARE`;
        if (inBatch.length !== ids.length) throw new BadRequestException('Some students are no longer active in this batch. Refresh and try again.');
        const rows = dto.ratings.map(
          (r) =>
            Prisma.sql`(${randomUUID()}, ${scope.schoolId}, ${r.studentId}, ${dto.batchId}, ${facultyId}, ${faculty.name}, ${date}::date, ${r.attitude}::int, ${r.behaviour}::int, ${r.focus}::int, ${r.interaction}::int, ${r.notes ?? null}::text, now(), now())`,
        );
        await tx.$executeRaw`
          INSERT INTO "DailyRating" ("id", "schoolId", "studentId", "batchId", "facultyId", "raterName", "date", "attitude", "behaviour", "focus", "interaction", "notes", "createdAt", "updatedAt")
          VALUES ${Prisma.join(rows)}
          ON CONFLICT ("studentId", "date", "facultyId") DO UPDATE SET
            "batchId" = EXCLUDED."batchId", "raterName" = EXCLUDED."raterName", "attitude" = EXCLUDED."attitude", "behaviour" = EXCLUDED."behaviour",
            "focus" = EXCLUDED."focus", "interaction" = EXCLUDED."interaction", "notes" = EXCLUDED."notes", "updatedAt" = now()`;
      });
    } catch (err) {
      // The teacher's profile deleted by an admin mid-save (the locks make anything else rare).
      if (isForeignKeyViolation(err)) throw new BadRequestException('Your faculty profile or a student was just changed. Refresh and try again.');
      throw err;
    }
    return { saved: dto.ratings.length };
  }

  /** Clears the rating this teacher gave a student for a day (in one of their batches). */
  async remove(scope: TeacherScope, studentId: string, day: string) {
    const facultyId = requireTeacher(scope);
    const date = parseDate(day, 'Date');
    const { count } = await this.prisma.dailyRating.deleteMany({ where: { schoolId: scope.schoolId, studentId, date, facultyId, batchId: { in: scope.batchIds } } });
    if (!count) throw new NotFoundException('No rating of yours for that student on that day');
    return { ok: true };
  }
}

function requireTeacher(scope: TeacherScope): string {
  if (!scope.active || !scope.facultyId) throw new ForbiddenException('Only active faculty can rate students');
  return scope.facultyId;
}
