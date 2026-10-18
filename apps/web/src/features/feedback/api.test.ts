import { describe, expect, it } from 'vitest'
import { rowsToRecords } from '@/lib/spreadsheet'
import { FEEDBACK_COLUMNS, sampleRows } from './sheet'
import { dayLabel, importInChunks, keywordTone, percent } from './api'

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

describe('importing a sheet in chunks', () => {
  const sheet = Array.from({ length: 450 }, (_, i) => ({ type: 'Teacher -> Management', rating: '4', content: `Row ${i}` }))

  it('sends 200 rows at a time, numbered from their sheet row, with the keys of the rows before', async () => {
    const calls: { firstRow: number; size: number; prior: number; lastPrior: number | undefined }[] = []
    const out = await importInChunks(
      async ({ rows, firstRow, priorKeys }) => {
        calls.push({ firstRow, size: rows.length, prior: priorKeys.length, lastPrior: priorKeys.at(-1)?.row })
        // The server: every row new, except sheet row 5 (an error, so no key).
        const result = rows.map((_, i) => ({ row: firstRow + i, label: '', action: firstRow + i === 5 ? ('error' as const) : ('create' as const), errors: [], ...(firstRow + i === 5 ? {} : { key: `k${firstRow + i}` }) }))
        return { applied: false, created: result.filter((r) => r.key).length, updated: 0, skipped: result.filter((r) => !r.key).length, rows: result }
      },
      sheet,
      true,
    )
    expect(calls).toEqual([
      { firstRow: 2, size: 200, prior: 0, lastPrior: undefined },
      { firstRow: 202, size: 200, prior: 199, lastPrior: 201 },
      { firstRow: 402, size: 50, prior: 399, lastPrior: 401 },
    ])
    expect(out).toMatchObject({ applied: false, created: 449, skipped: 1 })
    expect(out.rows.map((r) => r.row)).toEqual(Array.from({ length: 450 }, (_, i) => i + 2))
  })

  it('a chunk failing while applying says how many rows were already imported', async () => {
    let n = 0
    const send = async ({ rows, firstRow }: { rows: unknown[]; firstRow: number }) => {
      if (n++ === 1) throw new Error('That teacher was just removed from the school.')
      return { applied: true, created: rows.length, updated: 0, skipped: 0, rows: rows.map((_, i) => ({ row: firstRow + i, label: '', action: 'create' as const, errors: [], key: `k${firstRow + i}` })) }
    }
    await expect(importInChunks(send, sheet, false)).rejects.toThrow('That teacher was just removed from the school. (200 rows were imported before this; uploading the sheet again skips them.)')
  })
})
