import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { academicYearIst, todayIst, timeAgo } from './dates'

describe('todayIst', () => {
  it('is already the next day just after midnight IST (still the old day in UTC)', () => {
    expect(todayIst(new Date('2026-12-31T19:00:00Z'))).toBe('2027-01-01')
  })
  it('is still the same day late in the evening IST', () => {
    expect(todayIst(new Date('2026-12-31T18:00:00Z'))).toBe('2026-12-31')
  })
})

describe('academicYearIst', () => {
  // Run in a zone that is neither IST nor UTC, so a browser-local calculation can't pass by accident.
  beforeAll(() => {
    vi.stubEnv('TZ', 'America/New_York')
  })
  afterAll(() => {
    vi.unstubAllEnvs()
  })
  it('starts the new academic year at midnight IST on the 1st of the start month', () => {
    // 31 March 19:00 UTC is already 1 April 00:30 in India.
    expect(academicYearIst(4, new Date('2027-03-31T19:00:00Z'))).toBe('2027-2028')
    expect(academicYearIst(4, new Date('2027-03-31T18:00:00Z'))).toBe('2026-2027')
  })
  it('handles a January start', () => {
    expect(academicYearIst(1, new Date('2026-12-31T19:00:00Z'))).toBe('2027-2028')
  })
})

describe('timeAgo', () => {
  const now = Date.parse('2026-10-20T12:00:00Z')
  it('reads as just now, minutes, hours, then the IST day', () => {
    expect(timeAgo('2026-10-20T11:59:30Z', now)).toBe('just now')
    expect(timeAgo('2026-10-20T11:55:00Z', now)).toBe('5 min ago')
    expect(timeAgo('2026-10-20T09:00:00Z', now)).toBe('3 h ago')
    // 20:00 UTC on 18 Oct is already 19 Oct in India.
    expect(timeAgo('2026-10-18T20:00:00Z', now)).toBe('19 Oct')
  })
})
