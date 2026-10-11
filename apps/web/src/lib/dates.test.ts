import { describe, expect, it } from 'vitest'
import { todayIst } from './dates'

describe('todayIst', () => {
  it('is already the next day just after midnight IST (still the old day in UTC)', () => {
    expect(todayIst(new Date('2026-12-31T19:00:00Z'))).toBe('2027-01-01')
  })
  it('is still the same day late in the evening IST', () => {
    expect(todayIst(new Date('2026-12-31T18:00:00Z'))).toBe('2026-12-31')
  })
})
