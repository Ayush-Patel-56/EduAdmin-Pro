import { describe, expect, it } from 'vitest'
import { academicYearIst, todayIst } from './dates'

describe('todayIst', () => {
  it('is already the next day just after midnight IST (still the old day in UTC)', () => {
    expect(todayIst(new Date('2026-12-31T19:00:00Z'))).toBe('2027-01-01')
  })
  it('is still the same day late in the evening IST', () => {
    expect(todayIst(new Date('2026-12-31T18:00:00Z'))).toBe('2026-12-31')
  })
})

describe('academicYearIst', () => {
  it('starts the new academic year at midnight IST on the 1st of the start month', () => {
    // 31 March 19:00 UTC is already 1 April 00:30 in India.
    expect(academicYearIst(4, new Date('2027-03-31T19:00:00Z'))).toBe('2027-2028')
    expect(academicYearIst(4, new Date('2027-03-31T18:00:00Z'))).toBe('2026-2027')
  })
  it('handles a January start', () => {
    expect(academicYearIst(1, new Date('2026-12-31T19:00:00Z'))).toBe('2027-2028')
  })
})
