import { BadRequestException } from '@nestjs/common';

/** Parses a YYYY-MM-DD calendar date as UTC midnight. */
export function parseDate(value: string, label: string): Date {
  const date = new Date(`${value}T00:00:00Z`);
  // Rejects impossible dates like 2026-02-30, which Date would roll over.
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException(`${label} is invalid`);
  }
  return date;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Today's calendar date in India (UTC midnight of that date), for @db.Date columns. */
export function istToday(now = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()),
  );
}

/** The instant 1 January 00:00 IST of the current Indian calendar year began. */
export function istYearStart(now = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), 0, 1) - IST_OFFSET_MS);
}

/** "2026-10-20 15:30 IST" for an instant. */
export function formatIst(date: Date): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return `${ist.toISOString().slice(0, 16).replace('T', ' ')} IST`;
}

/** A @db.Date column back to YYYY-MM-DD. */
export function toIsoDate(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/** "2026-10-20" + "15:30" entered in India -> the instant (stored as UTC). */
export function istInstant(date: string, time: string, label: string): Date {
  const day = parseDate(date, label);
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) throw new BadRequestException(`${label} needs a time like 15:30`);
  return new Date(
    day.getTime() +
      (Number(match[1]) * 60 + Number(match[2])) * 60_000 -
      IST_OFFSET_MS,
  );
}

/** An instant as the date and time an Indian user would enter: ["2026-10-20", "15:30"]. */
export function istParts(instant: Date): [string, string] {
  const ist = new Date(instant.getTime() + IST_OFFSET_MS).toISOString();
  return [ist.slice(0, 10), ist.slice(11, 16)];
}

/** Monday 00:00 IST of the week `now` falls in. */
export function istWeekStart(now = new Date()): Date {
  const today = istToday(now); // UTC midnight of the IST date
  const daysSinceMonday = (today.getUTCDay() + 6) % 7;
  return new Date(today.getTime() - daysSinceMonday * 86_400_000 - IST_OFFSET_MS);
}

/** The 1st of the current IST month, 00:00 IST. */
export function istMonthStart(now = new Date()): Date {
  const today = istToday(now);
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1) - IST_OFFSET_MS);
}
