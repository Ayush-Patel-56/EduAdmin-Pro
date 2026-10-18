import { describe, expect, it } from 'vitest'
import { emptyPtmForm, ptmFormOf, ptmProblem, shortDay, studentLabel, toPtmPayload, type PtmNote } from './api'
import { removalLines } from '@/features/students/api'
import { ptmReportPdf } from './ptmReport'

const note: PtmNote = {
  id: 'n1',
  date: '2026-10-18',
  student: { id: 'st-1', fullName: 'Ayush Rajeshkumar Patel', rollNumber: null },
  batch: { id: 'b1', name: 'Batch 1A' },
  teacherName: 'Ayush',
  parentName: null,
  parentAttended: true,
  discussion: 'progress report',
  actionItems: null,
  followUpDate: null,
  createdAt: '2026-10-18T05:00:00.000Z',
}

describe('PTM form', () => {
  it('starts on today with the first batch, and says what is missing before sending', () => {
    const f = emptyPtmForm('2026-10-18', 'b1')
    expect(f).toMatchObject({ batchId: 'b1', date: '2026-10-18', parentAttended: true })
    expect(ptmProblem(f, '2026-10-18')).toBe('Select a student')
    expect(ptmProblem({ ...f, studentId: 'st-1' }, '2026-10-18')).toBe('Write the discussion notes')
    expect(ptmProblem({ ...f, studentId: 'st-1', discussion: 'x', date: '2026-10-19' }, '2026-10-18')).toBe("You can't log a meeting that hasn't happened yet")
    expect(ptmProblem({ ...f, studentId: 'st-1', discussion: 'x', followUpDate: '2026-10-17' }, '2026-10-18')).toBe("The follow-up can't be before the meeting")
    expect(ptmProblem({ ...f, studentId: 'st-1', discussion: 'x', followUpDate: '2026-11-01' }, '2026-10-18')).toBeNull()
  })

  it('a note whose batch was deleted is corrected without a batch (it keeps the recorded one); a new note needs one', () => {
    const orphan: PtmNote = { ...note, batch: { id: null, name: 'A3' } }
    const f = { ...ptmFormOf(orphan), discussion: 'Corrected' }
    expect(f.batchId).toBe('')
    expect(ptmProblem(f, '2026-10-18')).toBe('Select a batch')
    expect(ptmProblem(f, '2026-10-18', { studentId: 'st-1' })).toBeNull()
    expect(ptmProblem({ ...f, studentId: 'st-2' }, '2026-10-18', { studentId: 'st-1' })).toBe('Select a batch')
    expect(toPtmPayload(f).batchId).toBeNull()
    expect(removalLines({ ptmNotes: 5, counselingSessions: 1 })).toEqual(['5 PTM notes', '1 counseling session'])
    expect(removalLines({ ptmNotes: 0, counselingSessions: 0 })).toEqual([])
  })

  it('sends blank optional fields as null and round-trips a note for editing', () => {
    expect(toPtmPayload({ ...ptmFormOf(note), parentName: '  ', actionItems: '', followUpDate: '' })).toEqual({
      batchId: 'b1',
      date: '2026-10-18',
      studentId: 'st-1',
      parentName: null,
      parentAttended: true,
      discussion: 'progress report',
      actionItems: null,
      followUpDate: null,
    })
  })

  // The web tests also run under TZ=America/Los_Angeles and Pacific/Kiritimati: days stay calendar days.
  it('labels read like the screenshots', () => {
    expect(studentLabel(note.student)).toBe('Ayush Rajeshkumar Patel (N/A)')
    expect(studentLabel({ fullName: 'Diya', rollNumber: 'RN-12' })).toBe('Diya (RN-12)')
    expect(shortDay('2026-10-18')).toBe('18 Oct 2026')
  })
})

describe('Parent-Teacher Meeting Report', () => {
  it('is one A4 page for a short note, and flows onto more pages for a long one', async () => {
    const short = await ptmReportPdf(note)
    expect(short.fileName).toBe('ptm-ayush-rajeshkumar-patel-2026-10-18.pdf')
    expect(short.doc.getNumberOfPages()).toBe(1)
    const long = await ptmReportPdf({ ...note, discussion: 'Long discussion line. '.repeat(400), actionItems: 'Daily self-study. '.repeat(100), followUpDate: '2026-11-01' })
    expect(long.doc.getNumberOfPages()).toBeGreaterThan(1)
  })
})
