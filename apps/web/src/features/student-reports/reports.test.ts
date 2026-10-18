import { describe, expect, it } from 'vitest'
import type { PaperQuestion, ResultsView } from '@/features/assessments/api'
import { pct } from './api'
import { reportSections } from './exportReport'
import { checkResults, presentOf, resultHeader, resultTemplate } from './resultsSheet'
import type { StudentReport } from './api'

const q = (id: string, position: number, type: PaperQuestion['type']): PaperQuestion => ({ id, questionId: null, position, subject: 'Physics', chapterName: null, topic: 'Heat', difficulty: 'EASY', type, text: 'Q', options: [], correctAnswer: null, marks: 4, negativeMarks: 0 })

const view = (paper: PaperQuestion[] = []): ResultsView =>
  ({
    test: { id: 't1', title: 'Mock', totalMarks: 20, date: '2026-10-17' },
    paper,
    stats: {},
    canGrade: true,
    rows: [
      { student: { id: 's1', fullName: 'Aarav Mehta', rollNumber: 'R01', inBatch: true }, result: null },
      { student: { id: 's2', fullName: 'Diya Shah', rollNumber: 'R02', inBatch: true }, result: { present: true } },
      { student: { id: 's3', fullName: 'No Roll', rollNumber: null, inBatch: true }, result: null },
    ],
  }) as unknown as ResultsView

describe('Import Test Results sheet', () => {
  it('the template lists the roster, with Q columns when the test has a paper', () => {
    const paper = [q('p1', 1, 'MCQ'), q('p2', 2, 'SUBJECTIVE')]
    expect(resultHeader(paper)).toEqual(['Roll No', 'Name', 'Present', 'Marks', 'Correct', 'Incorrect', 'Unattempted', 'Q1', 'Q2', 'Remarks'])
    expect(resultTemplate(view(paper))[0]).toEqual(['R01', 'Aarav Mehta', '', '', '', '', '', '', '', ''])
  })

  it('reads present as Yes / P / 1 and absent as No / A / 0', () => {
    expect(['Yes', 'p', '1', 'Present'].map(presentOf)).toEqual([true, true, true, true])
    expect(['No', 'A', '0', 'absent'].map(presentOf)).toEqual([false, false, false, false])
    expect(presentOf('')).toBeNull()
    expect(presentOf('maybe')).toBe('bad')
  })

  it('marks-only results: matched by roll (any case), new or updating, every problem reported', () => {
    const { rows, missing } = checkResults(
      [
        ['Roll No', 'Name', 'Present', 'Marks', 'Correct', 'Incorrect', 'Unattempted', 'Remarks'],
        ['r01', 'Aarav', 'Yes', '15.5', '6', '2', '', 'Good'],
        ['R02', 'Diya', 'No', '', '', '', '', ''],
        ['R09', 'Ghost', 'Yes', '5', '', '', '', ''],
        ['R01', 'Aarav', 'Yes', '25', 'x', '', '', ''],
        ['', '', 'Yes', '', '', '', '', ''],
      ],
      view(),
    )
    expect(missing).toEqual([])
    expect(rows[0]).toMatchObject({ action: 'create', result: { studentId: 's1', present: true, marks: 15.5, correct: 6, incorrect: 2, unattempted: null, remarks: 'Good' } })
    expect(rows[1]).toMatchObject({ action: 'update', result: { studentId: 's2', present: false } })
    expect(rows[2].errors).toEqual(["No student with Roll No R09 on this test's roster"])
    expect(rows[3].errors).toEqual(['Roll No R01 appears twice in this file (row 2)', "Marks can't be more than the test's 20", 'Correct must be a whole number'])
    expect(rows[4].errors).toEqual(['Roll No is required', 'Marks is required'])
  })

  it('a paper: answers by question (marks for subjective), an absent student with answers refused', () => {
    const paper = [q('p1', 1, 'MCQ'), q('p2', 2, 'SUBJECTIVE')]
    const { rows } = checkResults(
      [
        ['Roll No', 'Present', 'Q1', 'Q2'],
        ['R01', '', 'B', '3'],
        ['R02', 'A', 'C', ''],
        ['R01x', 'Yes', '', ''],
      ],
      view(paper),
    )
    expect(rows[0]).toMatchObject({ action: 'create', result: { studentId: 's1', present: true, answers: [{ testQuestionId: 'p1', response: 'B' }, { testQuestionId: 'p2', marksAwarded: 3 }] } })
    expect(rows[1].errors).toEqual(["An absent student can't have marks or answers"])
    expect(rows[2].errors).toContain('Enter the marks, or each question’s answer (Q columns)')
  })

  it('a sheet without Roll No or Present (or Marks, for a test without a paper) is refused', () => {
    expect(checkResults([['Name', 'Marks'], ['A', '1']], view()).missing).toEqual(['Roll No', 'Present'])
    expect(checkResults([['Roll No', 'Present'], ['R01', 'Yes']], view()).missing).toEqual(['Marks'])
  })
})

describe('5-in-1 exports', () => {
  const report = {
    generatedAt: '2026-10-18T10:00:00Z',
    year: { year: 2026, label: '2026-27', from: '2026-04-01', to: '2027-03-31', current: 2026 },
    student: { id: 's1', fullName: 'Aarav Mehta', rollNumber: 'R01', admissionNumber: 'ADM1', classLevel: '11th', status: 'ACTIVE', batch: { id: 'b1', name: 'JEE A' }, program: 'JEE' },
    summary: { overallPercent: 63.64, grade: 'B+', marks: 21, totalMarks: 33, testsTaken: 2, testsAbsent: 0, batchRank: { rank: 1, of: 3, percentile: 100, topPercent: 33 }, accuracy: null, attemptRate: null, behaviourScore: 4, attendanceRate: null, ptmMeetings: 0 },
    performance: { subjects: [], tests: [] },
    analysis: { questions: 0, attempted: 0, correct: 0, incorrect: 0, unattempted: 0, accuracy: null, attemptRate: null, testsCounted: 0, answered: 0, byType: [], byDifficulty: [] },
    topics: { strong: [], average: [], weak: [] },
    mistakes: { incorrect: 0, partial: 0, unattempted: 0, bySubject: [], recent: [] },
    feedback: { ratings: null, recentRatings: [], attendance: { present: 0, late: 0, absent: 0, excused: 0, classes: 0, rate: null }, ptm: { meetings: 0, parentAttended: 0, parentAttendanceRate: null, notes: [] } },
    coverage: { tests: 2, answers: 0, gradedAssignments: 0, ratings: 1, classes: 0, ptmNotes: 0 },
  } as unknown as StudentReport

  it('every section is a table; missing figures stay empty (never 0), with coverage and generation time', () => {
    const sections = reportSections(report)
    expect(sections.map((s) => s.name)).toEqual(['Summary', 'Performance', 'Tests', 'Test Analysis', 'Topic Strength', 'Error Log', 'Teacher Feedback', 'PTM Notes'])
    const summary = Object.fromEntries(sections[0].rows.map(([k, v]) => [k, v]))
    expect(summary).toMatchObject({ 'Overall %': 63.64, Grade: 'B+', 'Batch rank': '1 of 3', 'Accuracy %': null, 'Attendance %': null, 'Behaviour score (/5)': 4 })
    expect(String(summary.Generated)).toContain('IST')
    expect(String(summary['Worked out from'])).toContain('2 test result(s)')
  })

  it('carries no contact details', () => {
    const text = JSON.stringify(reportSections(report)).toLowerCase()
    for (const word of ['phone', 'aadhar', 'address', 'guardian', 'email']) expect(text).not.toContain(word)
  })

  it('shows a missing value as a dash, not 0%', () => {
    expect(pct(null)).toBe('—')
    expect(pct(0)).toBe('0%')
    expect(pct(63.6449, 2)).toBe('63.64%')
  })
})
