import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { isTeacher, type Actor } from '../assessments/actor.js';
import { istToday } from '../common/dates.js';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { PAST_YEARS, academicYearBounds, academicYearOf, yearLabel } from './report-math.js';

/**
 * Who sees which students' reports: an admin every batch of their school, a
 * teacher only the batches assigned to them now (none while inactive, as
 * teacherScope empties them). Every query filters by the school and these.
 */
export function batchScope(actor: Actor): string[] | null {
  return isTeacher(actor) ? actor.scope.batchIds : null;
}

export function requireBatchAccess(actor: Actor, batchId: string) {
  if (isTeacher(actor) && !actor.scope.batchIds.includes(batchId)) throw new ForbiddenException("You aren't assigned to that batch");
}

/** `AND <column> IN (…)` for the actor's batches: nothing for an admin, never true for a teacher without batches. */
export function inScope(column: string, batchIds: string[] | null): Prisma.Sql {
  if (batchIds === null) return Prisma.empty;
  if (!batchIds.length) return Prisma.sql`AND false`;
  return Prisma.sql`AND ${Prisma.raw(column)} IN (${Prisma.join(batchIds)})`;
}

/** The school's academic year settings and the year asked for (the current one by default). */
export async function yearContext(prisma: PrismaService, schoolId: string, year?: number | null) {
  const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { academicYearStartMonth: true } });
  const startMonth = school.academicYearStartMonth;
  const current = academicYearOf(istToday(), startMonth);
  const chosen = year ?? current;
  return { startMonth, current, year: chosen, label: yearLabel(chosen), ...academicYearBounds(chosen, startMonth) };
}

/** The years marks can be entered for: this academic year and the few before it. */
export function requireWritableYear(ctx: { current: number }, year: number) {
  if (year > ctx.current) throw new BadRequestException(`${yearLabel(year)} hasn't started yet`);
  if (year < ctx.current - PAST_YEARS) throw new BadRequestException(`Marks can be entered for ${yearLabel(ctx.current - PAST_YEARS)} to ${yearLabel(ctx.current)}`);
}

/** The year picker: the current academic year first, then the past ones. */
export function yearChoices(current: number) {
  return Array.from({ length: PAST_YEARS + 1 }, (_, i) => ({ year: current - i, label: yearLabel(current - i) }));
}
