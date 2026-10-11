import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { toIsoDate } from '../common/dates.js';
import { Prisma } from '../generated/prisma/client.js';
import type { PromotionStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

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
      select: { academicYearStartMonth: true },
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
    return {
      checkedAt: new Date().toISOString(),
      pending: decided
        ? null
        : {
            academicYear,
            boundaryDate: toIsoDate(boundaryDate),
            // Filled from student records once the Students module exists.
            studentsTracked: false,
            rows: [] as {
              fromClass: string;
              toClass: string;
              students: number;
            }[],
            heldNewAdmissions: 0,
            class12Excluded: 0,
          },
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
    try {
      await this.prisma.promotionCycle.create({
        data: {
          schoolId,
          academicYear,
          boundaryDate: new Date(`${pending.boundaryDate}T00:00:00Z`),
          status,
          studentCount: 0,
          decidedById: userId,
        },
      });
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
