import { describe, expect, it } from 'vitest'
import { addDays, addMonths, firstOfMonth, lastOfMonth, monthTitle, span, weekStart } from './api'

// The calendar works in "YYYY-MM-DD" with UTC maths, so the same dates come
// out in every time zone (India, a Mac set to UTC, a Windows laptop abroad).
describe('calendar dates', () => {
  it('weeks start on Monday', () => {
    expect(weekStart('2026-10-14')).toBe('2026-10-12') // Wednesday
    expect(weekStart('2026-10-12')).toBe('2026-10-12') // Monday
    expect(weekStart('2026-10-18')).toBe('2026-10-12') // Sunday
    expect(weekStart('2026-11-01')).toBe('2026-10-26') // across a month
  })

  it('months step across years and know their last day', () => {
    expect(addMonths('2026-12-31', 1)).toBe('2027-01-01')
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-01')
    expect(lastOfMonth('2028-02-10')).toBe('2028-02-29')
    expect(lastOfMonth('2026-02-10')).toBe('2026-02-28')
    expect(firstOfMonth('2026-10-14')).toBe('2026-10-01')
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
  })

  it('labels are the same dates in any time zone', () => {
    expect(monthTitle('2026-10-01')).toBe('October 2026')
    expect(span({ date: '2026-11-08', endsOn: '2026-11-10' })).toBe('8 Nov – 10 Nov')
  })

  it('the October 2026 grid starts on Monday 28 September', () => {
    expect(weekStart(firstOfMonth('2026-10-14'))).toBe('2026-09-28')
  })
})
