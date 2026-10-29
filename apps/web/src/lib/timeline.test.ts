import { describe, expect, it } from 'vitest'
import { chapterTimeline, parseTargetRange } from './timeline'

// An April-start academic year, seen from 29 Oct 2026 (the 2026-27 year).
const today = '2026-10-29'
const range = (t: string) => parseTargetRange(t, 4, today)

describe('parseTargetRange', () => {
  it('reads the formats the tracker and its import use', () => {
    expect(range('Aug 01 - Aug 20')).toEqual({ start: '2026-08-01', end: '2026-08-20' })
    expect(range('Oct 15 – Nov 15')).toEqual({ start: '2026-10-15', end: '2026-11-15' })
    expect(range('1 Aug to 20 Aug')).toEqual({ start: '2026-08-01', end: '2026-08-20' })
    expect(range('Aug 01 - 20')).toEqual({ start: '2026-08-01', end: '2026-08-20' })
    expect(range('15 Oct')).toEqual({ start: '2026-10-15', end: '2026-10-15' })
    expect(range('01/08 - 20/08')).toEqual({ start: '2026-08-01', end: '2026-08-20' })
    expect(range('2026-08-01 - 2026-08-20')).toEqual({ start: '2026-08-01', end: '2026-08-20' })
    expect(range('September 3rd - September 18th')).toEqual({ start: '2026-09-03', end: '2026-09-18' })
  })

  it('reads day-month numbers with dashes or dots, and ranges of days in one month', () => {
    expect(range('01-08 - 20-08')).toEqual({ start: '2026-08-01', end: '2026-08-20' })
    expect(range('01-08')).toEqual({ start: '2026-08-01', end: '2026-08-01' })
    expect(range('01.08.2026 to 20.08.2026')).toEqual({ start: '2026-08-01', end: '2026-08-20' })
    expect(range('1st-15th Aug')).toEqual({ start: '2026-08-01', end: '2026-08-15' })
    expect(range('1 - 15 Aug 2026')).toEqual({ start: '2026-08-01', end: '2026-08-15' })
    expect(range('5th to 25th November')).toEqual({ start: '2026-11-05', end: '2026-11-25' })
    expect(range('20-12 - 10-01')).toEqual({ start: '2026-12-20', end: '2027-01-10' })
  })

  it('puts months before the start month in the next calendar year, and rolls a range across new year', () => {
    expect(range('Jan 05 - Jan 25')).toEqual({ start: '2027-01-05', end: '2027-01-25' })
    expect(range('Dec 15 - Jan 10')).toEqual({ start: '2026-12-15', end: '2027-01-10' })
    // In February 2027 the year is still 2026-27: "Aug" is last August.
    expect(parseTargetRange('Aug 01 - Aug 20', 4, '2027-02-10')).toEqual({ start: '2026-08-01', end: '2026-08-20' })
  })

  it("returns null for text it can't read", () => {
    for (const t of ['', '   ', 'Term 1', 'next week', 'Q3', 'Feb 30', 'Aug 40 - Aug 50', '1st-15th Smarch', '32-08 - 40-08', '15-15', null, undefined]) {
      expect(range(t as string)).toBeNull()
    }
  })
})

describe('chapterTimeline', () => {
  const r = (start: string, end: string) => ({ start, end })
  it('green when completed, whatever the dates', () => {
    expect(chapterTimeline('COMPLETED', r('2026-01-01', '2026-01-02'), today)).toEqual({ tone: 'green', label: 'Completed' })
    expect(chapterTimeline('COMPLETED', null, today)?.tone).toBe('green')
  })
  it('red once the end date has passed and it is not done', () => {
    expect(chapterTimeline('IN_PROGRESS', r('2026-10-01', '2026-10-20'), today)).toEqual({ tone: 'red', label: 'Overdue by 9 days' })
    expect(chapterTimeline('NOT_STARTED', r('2026-10-01', '2026-10-28'), today)).toEqual({ tone: 'red', label: 'Overdue by 1 day' })
  })
  it('amber within 7 days of the end, or when it should have started', () => {
    expect(chapterTimeline('IN_PROGRESS', r('2026-10-20', '2026-10-29'), today)).toEqual({ tone: 'amber', label: 'Due today' })
    expect(chapterTimeline('IN_PROGRESS', r('2026-10-20', '2026-11-05'), today)).toEqual({ tone: 'amber', label: 'Due in 7 days' })
    expect(chapterTimeline('NOT_STARTED', r('2026-10-25', '2026-11-30'), today)).toEqual({ tone: 'amber', label: 'Should have started' })
  })
  it('green while on track', () => {
    expect(chapterTimeline('IN_PROGRESS', r('2026-10-20', '2026-11-06'), today)).toEqual({ tone: 'green', label: 'On track' })
    expect(chapterTimeline('NOT_STARTED', r('2026-11-10', '2026-11-30'), today)).toEqual({ tone: 'green', label: 'Starts in 12 days' })
  })
  it('neutral without readable dates', () => {
    expect(chapterTimeline('IN_PROGRESS', null, today)).toBeNull()
  })
})
