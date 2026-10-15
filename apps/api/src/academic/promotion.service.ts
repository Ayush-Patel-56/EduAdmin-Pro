import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { toIsoDate } from '../common/dates.js';
import { Prisma } from '../generated/prisma/client.js';
import type { PromotionStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CLASS_OPTIONS } from '../schools/school-options.js';

type Db = Pick<PrismaService, 'student'>;

/** The class a student moves up to: the next grade, if the school offers it. 12th and later aren't promoted. */
export function nextClass(classLevel: string, offered: string[]) {
  const i = CLASS_OPTIONS.indexOf(classLevel as (typeof CLASS_OPTIONS)[number]);
  if (i === -1 || i >= CLASS_OPTIONS.indexOf('12th')) return null;
  const next = CLASS_OPTIONS[i + 1];
  return offered.includes(next) ? next : null;
}

/**
 * Who moves where this cycle. Active students admitted before the boundary
 * move up one class; new admissions (admitted on or after it) are held, Class
 * 12 is left for the school to handle, and students without a class (or whose
 * next class the school doesn't offer) stay where they are. A student in a
 * batch meant for one class leaves that batch when they move up (the school
 * puts them in next year's batch); `leavingBatch` counts them.
 */
export async function planPromotion(
  db: Db,
  schoolId: string,
  offered: string[],
  boundaryDate: Date,
) {
  const students = await db.student.findMany({
    where: { schoolId, status: 'ACTIVE' },
    select: { id: true, classLevel: true, admissionDate: true, batch: { select: { classLevel: true } } },
  });
  const groups = new Map<string, { toClass: string; ids: string[] }>();
  const leavingBatch: string[] = [];
  let heldNewAdmissions = 0;
  let class12Excluded = 0;
  let notPromoted = 0;
  for (const s of students) {
    if (s.admissionDate && s.admissionDate >= boundaryDate) heldNewAdmissions++;
    else if (s.classLevel === '12th') class12Excluded++;
    else {
      const to = s.classLevel ? nextClass(s.classLevel, offered) : null;
      if (!to) notPromoted++;
      else {
        const group = groups.get(s.classLevel!) ?? { toClass: to, ids: [] };
        group.ids.push(s.id);
        groups.set(s.classLevel!, group);
        if (s.batch?.classLevel != null) leavingBatch.push(s.id);
      }
    }
  }
  const order = (c: string) => CLASS_OPTIONS.indexOf(c as (typeof CLASS_OPTIONS)[number]);
  return {
    studentsTracked: students.length > 0,
    groups: [...groups.entries()]
      .sort(([a], [b]) => order(a) - order(b))
      .map(([fromClass, g]) => ({ fromClass, toClass: g.toClass, ids: g.ids })),
    heldNewAdmissions,
    class12Excluded,
    notPromoted,
    leavingBatch,
  };
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * The academic year that started on the most recent boundary (1st of the
 * school's start month) on or before `today`, e.g. April 2026 -> "2026-2027".
 */
export function currentAcademicYear(startMonth: number, today = new Date()) {
  // Schools run on Indian time: the new year begins at midnight IST (18:30 UTC
  // the day before), not 05:30 IST.
  const ist = new Date(today.getTime() + IST_OFFSET_MS);
  const year = ist.getUTCFullYear();
  // Both sides are compared as IST wall-clock times, expressed in UTC fields.
  const thisYearsBoundary = Date.UTC(year, startMonth - 1, 1);
  const startYear = ist.getTime() >= thisYearsBoundary ? year : year - 1;
  return {
    academicYear: `${startYear}-${startYear + 1}`,
    boundaryDate: new Date(Date.UTC(startYear, startMonth - 1, 1)),
  };
}

@Injectable()
export class PromotionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Computed on every request, so the "daily check" is always current: once a
   * school passes its academic-year boundary, that year's promotion is pending
   * until an admin confirms or dismisses it.
   */
  async overview(schoolId: string) {
    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { academicYearStartMonth: true, classes: true },
    });
    const { academicYear, boundaryDate } = currentAcademicYear(
      school.academicYearStartMonth,
    );
    const history = await this.prisma.promotionCycle.findMany({
      where: { schoolId },
      orderBy: { decidedAt: 'desc' },
      take: 20,
    });
    const decided = history.some((c) => c.academicYear === academicYear);
    const plan = decided
      ? null
      : await planPromotion(this.prisma, schoolId, school.classes, boundaryDate);
    return {
      checkedAt: new Date().toISOString(),
      pending: plan
        ? {
            academicYear,
            boundaryDate: toIsoDate(boundaryDate),
            studentsTracked: plan.studentsTracked,
            rows: plan.groups.map((g) => ({
              fromClass: g.fromClass,
              toClass: g.toClass,
              students: g.ids.length,
            })),
            heldNewAdmissions: plan.heldNewAdmissions,
            class12Excluded: plan.class12Excluded,
            notPromoted: plan.notPromoted,
            leavingBatch: plan.leavingBatch.length,
          }
        : null,
      history: history.map((c) => ({
        id: c.id,
        academicYear: c.academicYear,
        boundaryDate: toIsoDate(c.boundaryDate),
        status: c.status,
        studentCount: c.studentCount,
        decidedAt: c.decidedAt.toISOString(),
      })),
    };
  }

  /** Records the decision for the pending year. The unique (school, year) key makes it one-time. */
  async decide(
    schoolId: string,
    userId: string,
    academicYear: string,
    status: PromotionStatus,
  ) {
    const { pending } = await this.overview(schoolId);
    if (!pending || pending.academicYear !== academicYear) {
      throw new BadRequestException(
        `There is no pending promotion for ${academicYear}`,
      );
    }
    // Each year can be decided once. Confirming before student records exist
    // would use that year up with nobody promoted, so wait until they do.
    // (Dismissing is always allowed.)
    if (status === 'CONFIRMED' && !pending.studentsTracked) {
      throw new ConflictException(
        'Promotion can be confirmed once student records exist. Until then you can dismiss it.',
      );
    }
    const boundaryDate = new Date(`${pending.boundaryDate}T00:00:00Z`);
    try {
      await this.prisma.$transaction(async (tx) => {
        const school = await tx.school.findUniqueOrThrow({
          where: { id: schoolId },
          select: { classes: true },
        });
        // Planned again inside the transaction, so it moves exactly the
        // students that exist now.
        const plan =
          status === 'CONFIRMED'
            ? await planPromotion(tx, schoolId, school.classes, boundaryDate)
            : null;
        // The cycle row goes first: a second confirm hits its unique key and
        // rolls back before any student moves.
        await tx.promotionCycle.create({
          data: {
            schoolId,
            academicYear,
            boundaryDate,
            status,
            studentCount:
              plan?.groups.reduce((sum, g) => sum + g.ids.length, 0) ?? 0,
            decidedById: userId,
          },
        });
        // Each group was collected before any update, so nobody moves twice.
        for (const group of plan?.groups ?? []) {
          await tx.student.updateMany({
            where: { id: { in: group.ids }, schoolId },
            data: { classLevel: group.toClass },
          });
        }
        // Their batch is for the class they've left: unassign them and close
        // the enrollment, so batch and class never disagree.
        if (plan && plan.leavingBatch.length > 0) {
          await tx.student.updateMany({
            where: { id: { in: plan.leavingBatch }, schoolId },
            data: { batchId: null },
          });
          // It ends on the boundary, or the day it started if that came later
          // (put in the batch after the boundary): never before it began.
          await tx.$executeRaw`
            UPDATE "StudentEnrollment" SET "endedOn" = GREATEST("enrolledOn", ${boundaryDate}::date)
            WHERE "studentId" = ANY(${plan.leavingBatch}::text[]) AND "schoolId" = ${schoolId} AND "endedOn" IS NULL`;
        }
      }, { timeout: 60_000, maxWait: 10_000 });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `Promotion for ${academicYear} was already decided`,
        );
      }
      throw err;
    }
    return { ok: true };
  }
}
