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

/** A @db.Date column back to YYYY-MM-DD. */
export function toIsoDate(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}
