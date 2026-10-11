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
