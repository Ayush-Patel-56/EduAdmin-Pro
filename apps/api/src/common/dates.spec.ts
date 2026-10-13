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

describe('IST date-time helpers', () => {
  it('a time entered in India is stored as the right instant, and read back the same', async () => {
    const { istInstant, istParts } = await import('./dates.js');
    const at = istInstant('2026-10-20', '15:30', 'Date');
    expect(at.toISOString()).toBe('2026-10-20T10:00:00.000Z');
    expect(istParts(at)).toEqual(['2026-10-20', '15:30']);
    // 23:59 IST is still the same Indian date.
    expect(istParts(istInstant('2026-12-31', '23:59', 'Date'))).toEqual(['2026-12-31', '23:59']);
    expect(() => istInstant('2026-10-20', '25:00', 'Date')).toThrow(/time like 15:30/);
  });

  it('weeks start on Monday and months on the 1st, both at midnight IST', async () => {
    const { istMonthStart, istWeekStart } = await import('./dates.js');
    // Wednesday 2026-10-14 10:00 IST
    const wed = new Date('2026-10-14T04:30:00Z');
    expect(istWeekStart(wed).toISOString()).toBe('2026-10-11T18:30:00.000Z'); // Mon 12 Oct 00:00 IST
    expect(istMonthStart(wed).toISOString()).toBe('2026-09-30T18:30:00.000Z'); // 1 Oct 00:00 IST
    // Monday 00:10 IST is already the new week.
    expect(istWeekStart(new Date('2026-10-11T18:40:00Z')).toISOString()).toBe('2026-10-11T18:30:00.000Z');
  });
});
