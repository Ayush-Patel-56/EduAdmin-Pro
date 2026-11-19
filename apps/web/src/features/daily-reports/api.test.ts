import { describe, expect, it } from 'vitest'
import { classLine, dateTimeIst, emptyForm, formOf, formProblem, longDay, shortDay, timeIst, toPayload, type DailyReport, isSyllabusChapter, syllabusChapters } from './api'
import type { SyllabusItem } from '@/features/academic/api'

const report: DailyReport = {
  id: 'r1',
  date: '2026-10-18',
  teacher: { id: 'f1', name: 'Ayush' },
  batch: { id: 'b1', name: 'Batch 1A' },
  program: { id: 'p1', name: 'JEE' },
  subject: 'General',
  chapter: 'Chapter 1',
  topics: 'Chapter 1 basics',
  homework: 'NA',
  observations: null,
  late: false,
  submittedAt: '2026-10-18T04:45:00.000Z',
  edited: false,
}

describe('daily report form', () => {
  it('starts on today, and says what is missing before sending', () => {
    const f = emptyForm('2026-10-18')
    expect(f.date).toBe('2026-10-18')
    expect(formProblem(f, '2026-10-18')).toBe('Select a batch')
    expect(formProblem({ ...f, batchId: 'b1' }, '2026-10-18')).toBe('Select a subject')
    expect(formProblem({ ...f, batchId: 'b1', subject: 'Physics', topics: '   ' }, '2026-10-18')).toBe('Describe the topics covered')
    expect(formProblem({ ...f, batchId: 'b1', subject: 'Physics', topics: 'Kinematics', date: '2026-10-19' }, '2026-10-18')).toBe("You can't report a day that hasn't happened yet")
    expect(formProblem({ ...f, batchId: 'b1', subject: 'Physics', topics: 'Kinematics', date: '2026-10-17' }, '2026-10-18')).toBeNull()
  })

  it('sends blank optional fields as null and round-trips a report for editing', () => {
    expect(toPayload({ ...formOf(report), chapter: '  ', homework: '', observations: ' ok ' })).toEqual({
      date: '2026-10-18',
      batchId: 'b1',
      subject: 'General',
      chapter: null,
      topics: 'Chapter 1 basics',
      homework: null,
      observations: 'ok',
    })
    expect(formOf(report)).toMatchObject({ batchId: 'b1', homework: 'NA', observations: '' })
  })
})

describe('daily report display', () => {
  // TZ is set per run (the web tests also run under America/Los_Angeles and Pacific/Kiritimati): IST is shown regardless.
  it('shows submission times in India and days as calendar dates', () => {
    expect(timeIst('2026-10-18T04:45:00.000Z')).toBe('10:15 am')
    expect(dateTimeIst('2026-10-18T18:45:00.000Z')).toBe('19 Oct 2026, 12:15 am')
    expect(longDay('2026-10-18')).toBe('Sunday, 18 Oct 2026')
    expect(shortDay('2026-10-18')).toBe('18 Oct 2026')
    expect(classLine(report)).toBe('Batch 1A · General · Chapter 1')
    expect(classLine({ ...report, chapter: null })).toBe('Batch 1A · General')
  })
})

describe('chapters from the syllabus', () => {
  const item = (subject: string, title: string, status: SyllabusItem['status'] = 'NOT_STARTED') =>
    ({ id: `${subject}-${title}`, batchId: 'b1', subject, title, estimatedHours: null, targetDates: null, status, remarks: null, updatedAt: '' }) as SyllabusItem
  const items = [item('Physics', 'Physical World'), item('Chemistry', 'Atoms'), item(' physics ', 'Kinematics', 'IN_PROGRESS'), item('PHYSICS', 'Physical World')]

  it("lists the batch's chapters for the report's subject, in the board's order, matching the subject however it's typed", () => {
    expect(syllabusChapters(items, 'Physics')).toEqual([
      { title: 'Physical World', status: 'NOT_STARTED' },
      { title: 'Kinematics', status: 'IN_PROGRESS' },
    ])
    expect(syllabusChapters(items, 'chemistry').map((c) => c.title)).toEqual(['Atoms'])
    expect(syllabusChapters(items, 'Biology')).toEqual([])
    expect(syllabusChapters(items, '')).toEqual([])
    expect(syllabusChapters(undefined, 'Physics')).toEqual([])
  })

  it('a chapter typed earlier that is not on the syllabus is shown as typed, not lost', () => {
    const chapters = syllabusChapters(items, 'Physics')
    expect(isSyllabusChapter('Kinematics', chapters)).toBe(true)
    expect(isSyllabusChapter('kinematics ', chapters)).toBe(true)
    expect(isSyllabusChapter('Optics revision', chapters)).toBe(false)
    expect(isSyllabusChapter('', chapters)).toBe(true) // nothing chosen yet
  })
})
