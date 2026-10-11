import { formatIst, istToday, istYearStart } from './dates.js';

describe('Indian calendar helpers', () => {
  it('istToday is already the next day between 00:00 and 05:30 IST', () => {
    // 2026-12-31 19:00 UTC is 2027-01-01 00:30 IST.
    expect(istToday(new Date('2026-12-31T19:00:00Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
    expect(istToday(new Date('2026-12-31T18:00:00Z')).toISOString()).toBe(
      '2026-12-31T00:00:00.000Z',
    );
  });

  it('a hire at 00:30 IST on 1 January counts toward the new year', () => {
    const hired = new Date('2026-12-31T19:00:00Z');
    expect(hired >= istYearStart(hired)).toBe(true);
    expect(istYearStart(hired).toISOString()).toBe('2026-12-31T18:30:00.000Z');
  });

  it('a hire at 23:30 IST on 31 December belongs to the old year', () => {
    const hired = new Date('2026-12-31T18:00:00Z');
    expect(hired >= istYearStart(new Date('2027-06-01T00:00:00Z'))).toBe(false);
    expect(istYearStart(hired).toISOString()).toBe('2025-12-31T18:30:00.000Z');
  });

  it('formatIst shows the school’s wall-clock time', () => {
    expect(formatIst(new Date('2026-10-20T10:00:00Z'))).toBe('2026-10-20 15:30 IST');
  });
});
