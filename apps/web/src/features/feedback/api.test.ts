import { describe, expect, it } from 'vitest'
import { rowsToRecords } from '@/lib/spreadsheet'
import { FEEDBACK_COLUMNS, sampleRows } from './sheet'
import { dayLabel, keywordTone, percent } from './api'

describe('feedback display', () => {
  it('rating shares round, and are 0 with no feedback', () => {
    expect(percent(1, 3)).toBe(33)
    expect(percent(2, 2)).toBe(100)
    expect(percent(0, 0)).toBe(0)
  })

  it('keyword colour follows the average rating of the feedback that mentions it', () => {
    expect(keywordTone({ phrase: 'Doubt Clearing', mentions: 3, averageRating: 4.7 })).toBe('positive')
    expect(keywordTone({ phrase: 'Transport Delays', mentions: 2, averageRating: 1.5 })).toBe('negative')
    expect(keywordTone({ phrase: 'Pace', mentions: 2, averageRating: 3 })).toBe('neutral')
  })

  // The web tests also run under TZ=America/Los_Angeles and Pacific/Kiritimati: days are calendar days.
  it('days read as Today, Yesterday or a date', () => {
    expect(dayLabel('2026-10-18', '2026-10-18')).toBe('Today')
    expect(dayLabel('2026-10-17', '2026-10-18')).toBe('Yesterday')
    expect(dayLabel('2026-09-30', '2026-10-01')).toBe('Yesterday')
    expect(dayLabel('2026-10-01', '2026-10-18')).toBe('1 Oct 2026')
  })
})

describe('feedback sheet columns', () => {
  it("reads a sheet laid out like the old console's (Batch as the target, Content (Comment))", () => {
    const { records, missing } = rowsToRecords(
      [
        ['Type', 'Sender', 'Rating', 'Content (Comment)', 'Subject', 'Batch', 'Category', 'Date'],
        ['Management -> Teacher', 'Principal Mehta', '5', 'Excellent results', 'alice@school.example', 'Alice Teacher', 'Academics', '2026-10-18'],
      ],
      FEEDBACK_COLUMNS,
    )
    expect(missing).toEqual([])
    expect(records[0]).toEqual({ type: 'Management -> Teacher', sender: 'Principal Mehta', rating: '5', content: 'Excellent results', subject: 'alice@school.example', target: 'Alice Teacher', category: 'Academics', date: '2026-10-18' })
  })

  it('the template rows use today and the two directions', () => {
    const rows = sampleRows('2026-10-18')
    expect(rows.map((r) => r[0])).toEqual(['Management -> Teacher', 'Teacher -> Management'])
    expect(rows.every((r) => r[7] === '2026-10-18')).toBe(true)
  })
})
