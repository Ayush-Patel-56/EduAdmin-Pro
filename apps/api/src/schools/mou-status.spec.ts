import { describe, expect, it } from 'vitest';
import { mouStatus } from './schools.service.js';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('mouStatus uses the Indian calendar date', () => {
  it('an MOU ending 31 Dec expires at midnight IST, not midnight UTC', () => {
    const end = day('2026-12-31');
    // 1 Jan 2027 00:30 IST = 31 Dec 19:00 UTC.
    expect(mouStatus(null, end, new Date('2026-12-31T19:00:00Z'))).toBe(
      'EXPIRED',
    );
    // 31 Dec 23:30 IST = 31 Dec 18:00 UTC.
    expect(mouStatus(null, end, new Date('2026-12-31T18:00:00Z'))).toBe(
      'ACTIVE',
    );
  });

  it('an MOU starting 1 Apr is active from midnight IST', () => {
    const start = day('2027-04-01');
    expect(mouStatus(start, null, new Date('2027-03-31T18:31:00Z'))).toBe(
      'ACTIVE',
    );
    expect(mouStatus(start, null, new Date('2027-03-31T18:29:00Z'))).toBe(
      'UPCOMING',
    );
  });

  it('is NOT_SET without dates', () => {
    expect(mouStatus(null, null)).toBe('NOT_SET');
  });
});
