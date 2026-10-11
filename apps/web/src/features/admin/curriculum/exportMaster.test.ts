import { afterEach, describe, expect, it, vi } from 'vitest'

const toFile = vi.fn()
vi.mock('write-excel-file/browser', () => ({ default: vi.fn(() => ({ toFile })) }))

const { exportMasterSheet } = await import('./exportMaster')

describe('exportMasterSheet file name', () => {
  afterEach(() => {
    vi.useRealTimers()
    toFile.mockReset()
  })

  it('uses the Indian calendar date (already the next day just after midnight IST)', async () => {
    vi.useFakeTimers()
    // 1 Jan 2027 00:30 IST = 31 Dec 2026 19:00 UTC.
    vi.setSystemTime(new Date('2026-12-31T19:00:00Z'))
    await exportMasterSheet([], 'St. Mary’s School')
    expect(toFile).toHaveBeenCalledWith('curriculum-st-mary-s-school-2027-01-01.xlsx')
  })
})
