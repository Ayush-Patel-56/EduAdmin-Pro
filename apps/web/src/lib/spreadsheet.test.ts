import { describe, expect, it } from 'vitest'
import { toCsv } from './spreadsheet'

describe('toCsv', () => {
  it('neutralises cells a spreadsheet would run as formulas, including ones hidden behind a tab or carriage return', () => {
    const csv = toCsv([['=HYPERLINK("http://x")', '+1', '-2', '@SUM(A1)', '\t=cmd', '\r=cmd', 'plain', -5]])
    expect(csv.split(',')).toEqual(["\"'=HYPERLINK(\"\"http://x\"\")\"", "'+1", "'-2", "'@SUM(A1)", "'\t=cmd", "\"'\r=cmd\"", 'plain', '-5'])
  })
})
