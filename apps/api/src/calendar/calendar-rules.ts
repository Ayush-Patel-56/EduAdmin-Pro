// Repeating events (PRD 4.15), expanded into concrete dates. All dates are
// calendar dates at UTC midnight, so no time zone can shift a day.

export type Repeat = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
export type Span = { startDate: Date; endDate: Date; repeat: Repeat; repeatUntil: Date | null };

const DAY = 86_400_000;
const days = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

/** The same day of the month `months` later; a day the month lacks becomes its last day (31 Jan -> 28 Feb). */
export function addMonths(d: Date, months: number) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last)));
}

/**
 * The occurrences of an event that overlap [from, to] (inclusive), in order.
 * Each keeps the event's length; a repeating one starts again every day,
 * week or month from its start, up to `repeatUntil` if set.
 */
export function occurrences(e: Span, from: Date, to: Date): { start: Date; end: Date }[] {
  const length = days(e.startDate, e.endDate);
  const out: { start: Date; end: Date }[] = [];
  const push = (start: Date) => {
    const end = addDays(start, length);
    if (start <= to && end >= from) out.push({ start, end });
  };
  if (e.repeat === 'NONE') {
    push(e.startDate);
    return out;
  }
  const last = e.repeatUntil && e.repeatUntil < to ? e.repeatUntil : to;
  if (e.repeat === 'MONTHLY') {
    // Start a month early so an occurrence running into `from` is kept.
    let i = Math.max(0, (from.getUTCFullYear() - e.startDate.getUTCFullYear()) * 12 + from.getUTCMonth() - e.startDate.getUTCMonth() - 1);
    for (let start = addMonths(e.startDate, i); start <= last; start = addMonths(e.startDate, ++i)) push(start);
    return out;
  }
  const step = e.repeat === 'DAILY' ? 1 : 7;
  // The first occurrence whose end reaches `from`.
  const k = Math.max(0, Math.ceil((days(e.startDate, from) - length) / step));
  for (let start = addDays(e.startDate, k * step); start <= last; start = addDays(start, step)) push(start);
  return out;
}

/** Why a period and repeat don't fit together, or null when they do (mirrors the database checks). */
export function spanProblem(e: Span): string | null {
  const length = days(e.startDate, e.endDate);
  if (length < 0) return "The end date can't be before the start date";
  if (e.repeat === 'NONE' && e.repeatUntil) return 'Repeat until only applies to a repeating event';
  if (e.repeatUntil && e.repeatUntil < e.startDate) return "Repeat until can't be before the start date";
  if (e.repeat === 'DAILY' && length > 0) return 'A daily event lasts one day; set the end date to the start date';
  if (e.repeat === 'WEEKLY' && length >= 7) return 'A weekly event can last at most 7 days';
  if (e.repeat === 'MONTHLY' && length >= 28) return 'A monthly event can last at most 28 days';
  return null;
}
