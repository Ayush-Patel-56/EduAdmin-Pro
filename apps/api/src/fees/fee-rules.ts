import type { FeeFrequency, FeeStatus } from './fees.dto.js';

// The fee arithmetic and calendar rules (HLD 8.4), kept free of the database
// so they are easy to test and the same everywhere they are used.

/** Rupees (at most two decimals) to whole paise, without float drift. */
export const toPaise = (rupees: number) => Math.round(rupees * 100);

export const net = (d: { amountPaise: number; discountPaise: number; lateFeePaise: number }) =>
  d.amountPaise - d.discountPaise + d.lateFeePaise;

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The due date for a billing month ("2026-10") and a due day. A due day the
 * month doesn't have (29-31) becomes its last day: 31 -> 30 Nov, 28/29 Feb.
 */
export function dueDateIn(month: string, dueDay: number): Date {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1, Math.min(dueDay, last)));
}

/** "2026-27" for a date, with the school's academic year starting in `startMonth` (1-12). */
export function academicYearOf(date: Date, startMonth: number) {
  const y = date.getUTCFullYear();
  const start = date.getUTCMonth() + 1 >= startMonth ? y : y - 1;
  return `${start}-${pad((start + 1) % 100)}`;
}

/**
 * Which billing period a due date falls in. A student owes a fee once per
 * period: once ever, per month, per calendar quarter (Apr-Jun is Q2) or per
 * academic year.
 */
export function periodOf(frequency: FeeFrequency, dueDate: Date, startMonth: number) {
  const y = dueDate.getUTCFullYear();
  const m = dueDate.getUTCMonth();
  switch (frequency) {
    case 'ONE_TIME':
      return 'ONCE';
    case 'MONTHLY':
      return `${y}-${pad(m + 1)}`;
    case 'QUARTERLY':
      return `${y}-Q${Math.floor(m / 3) + 1}`;
    case 'YEARLY':
      return academicYearOf(dueDate, startMonth);
  }
}

/**
 * The status a due shows: an admin's override if set, otherwise from the
 * amounts and the date. Fully paid (or nothing to pay) is Paid; past the due
 * date with money owed is Overdue; some money in is Partial; else Pending.
 */
export function statusOf(
  d: { netPaise: number; paidPaise: number; dueDate: Date; statusOverride: FeeStatus | null },
  today: Date,
): FeeStatus {
  if (d.statusOverride) return d.statusOverride;
  if (d.paidPaise >= d.netPaise) return 'PAID';
  if (d.dueDate < today) return 'OVERDUE';
  if (d.paidPaise > 0) return 'PARTIAL';
  return 'PENDING';
}

/** Money still owed on a due (nothing for Paid or Waived overrides). */
export function outstanding(d: { netPaise: number; paidPaise: number; statusOverride: FeeStatus | null }) {
  if (d.statusOverride === 'PAID' || d.statusOverride === 'WAIVED') return 0;
  return Math.max(d.netPaise - d.paidPaise, 0);
}

/** "₹12,500" / "₹12,500.50" */
export const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
