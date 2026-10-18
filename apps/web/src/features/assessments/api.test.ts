import { describe, expect, it } from 'vitest'
import {
  answerLabel,
  durationLabel,
  emptyQuestion,
  emptyTest,
  entryOf,
  entryPayload,
  filterRows,
  previewScore,
  questionPayload,
  questionProblem,
  quickFill,
  resultChunks,
  resultsCsvRows,
  testPayload,
  testProblem,
  time12,
  weekDays,
  type PaperQuestion,
  type QuestionForm,
  type ResultRow,
  type ResultsView,
} from './api'
import { linesOf } from './pdf'

const defaults = { marks: 4, negativeMarks: 0, source: 'Custom', durationMinutes: 180, totalMarks: 300 }
const mcq: QuestionForm = { ...emptyQuestion(defaults), subject: 'Physics', topic: 'Heat', difficulty: 'EASY', text: 'Unit of temperature?', options: ['Celsius', 'Kelvin', 'Fahrenheit', 'Rankine'], correctAnswer: 'B', negativeMarks: '-1' }

const pq = (id: string, over: Partial<PaperQuestion> = {}): PaperQuestion => ({
  id,
  questionId: null,
  position: 1,
  subject: 'Physics',
  chapterName: null,
  topic: 'Heat',
  difficulty: 'EASY',
  type: 'MCQ',
  text: 'Q',
  options: ['a', 'b', 'c', 'd'],
  correctAnswer: 'B',
  marks: 4,
  negativeMarks: 1,
  ...over,
})
const paper = [pq('q1'), pq('q2', { type: 'INTEGER', correctAnswer: '12', options: [], negativeMarks: 0 }), pq('q3', { type: 'SUBJECTIVE', correctAnswer: null, options: [], marks: 5, negativeMarks: 0 })]

describe('question form', () => {
  it('defaults: marks 4, negative 0, source Custom; checks fields in form order', () => {
    expect(emptyQuestion(defaults)).toMatchObject({ type: 'MCQ', marks: '4', negativeMarks: '0', source: 'Custom' })
    expect(questionProblem(emptyQuestion(defaults), true)).toBe('Select a subject')
    expect(questionProblem({ ...mcq, options: ['a', '', 'c', 'd'] }, false)).toBe('Fill in all four options, A to D')
    expect(questionProblem({ ...mcq, correctAnswer: '' }, false)).toBe('Choose the correct option')
    expect(questionProblem({ ...mcq, type: 'INTEGER', correctAnswer: '4.5' }, false)).toBe('Enter the correct answer as a whole number')
    expect(questionProblem({ ...mcq, negativeMarks: '-10' }, false)).toBe('Negative marks must be 0 to -9')
    expect(questionProblem({ ...mcq, source: ' ' }, true)).toBe('Enter the source')
    expect(questionProblem(mcq, false)).toBeNull()
  })

  it('payload: negative marks as written (-1 or 1) become marks taken off; options only for an MCQ; source only when asked', () => {
    expect(questionPayload(mcq, false)).toEqual({ subject: 'Physics', chapterId: null, topic: 'Heat', difficulty: 'EASY', type: 'MCQ', text: 'Unit of temperature?', options: ['Celsius', 'Kelvin', 'Fahrenheit', 'Rankine'], correctAnswer: 'B', marks: 4, negativeMarks: 1 })
    expect(questionPayload({ ...mcq, type: 'NUMERICAL', correctAnswer: '9.81', negativeMarks: '2' }, true)).toMatchObject({ options: [], correctAnswer: '9.81', negativeMarks: 2, source: 'Custom' })
  })

  it('answer as the bank shows it', () => {
    expect(answerLabel({ type: 'MCQ', options: ['Celsius', 'Kelvin', 'F', 'R'], correctAnswer: 'B' })).toBe('B) Kelvin')
    expect(answerLabel({ type: 'INTEGER', options: [], correctAnswer: '42' })).toBe('42')
    expect(answerLabel({ type: 'SUBJECTIVE', options: [], correctAnswer: null })).toBe('—')
  })
})

describe('test form', () => {
  it('defaults 180 minutes and 300 marks; required fields named', () => {
    const f = emptyTest(defaults, '2026-10-20')
    expect(f).toMatchObject({ date: '2026-10-20', durationMinutes: '180', totalMarks: '300' })
    expect(testProblem(f)).toBe('Enter the test title')
    const full = { ...f, title: ' Mock 1 ', batchId: 'b1', type: 'MOCK' as const, subject: 'Physics', time: '10:00' }
    expect(testProblem({ ...full, durationMinutes: '0' })).toBe('Duration must be 1 to 720 minutes')
    expect(testProblem({ ...full, time: '25:00' })).toBe('Select the time')
    expect(testProblem(full)).toBeNull()
    expect(testPayload(full)).toEqual({ title: 'Mock 1', type: 'MOCK', subject: 'Physics', batchId: 'b1', date: '2026-10-20', time: '10:00', durationMinutes: 180, totalMarks: 300 })
  })

  it('week days, 12-hour times and durations (the same in every browser time zone)', () => {
    expect(weekDays('2026-10-26')).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'])
    expect([time12('00:05'), time12('10:00'), time12('12:30'), time12('23:59')]).toEqual(['12:05 AM', '10:00 AM', '12:30 PM', '11:59 PM'])
    expect([durationLabel(45), durationLabel(180), durationLabel(90)]).toEqual(['45 min', '3 h', '1 h 30 min'])
  })
})

describe('results entry', () => {
  const row = (over: Partial<ResultRow['result']> | null, id = 's1', name = 'Aarav Shah', roll: string | null = '01'): ResultRow => ({
    student: { id, fullName: name, rollNumber: roll, inBatch: true },
    result: over && { present: true, marks: 10, correct: null, incorrect: null, unattempted: null, remarks: null, percent: 50, passed: true, rank: 1, percentile: 100, gradedBy: 'A', updatedAt: '', answers: [], ...over },
  })

  it('an entry from a saved result: objective responses, and marks given for subjective', () => {
    const e = entryOf(
      row({ answers: [{ testQuestionId: 'q1', response: 'C', outcome: 'INCORRECT', marksAwarded: -1 }, { testQuestionId: 'q3', response: null, outcome: 'PARTIAL', marksAwarded: 2.5 }, { testQuestionId: 'q2', response: null, outcome: 'UNATTEMPTED', marksAwarded: 0 }] }),
      paper,
    )
    expect(e).toEqual({ present: true, marks: '10', correct: '', incorrect: '', unattempted: '', remarks: '', answers: { q1: 'C', q3: '2.5' } })
    expect(entryOf(row(null), paper).present).toBeNull()
  })

  it('payloads: absent, total marks with counts, or answers (a blank sheet goes in as total marks)', () => {
    const blank = entryOf(row(null), paper)
    expect(entryPayload('s1', blank, 'marks', paper)).toBe('Mark the student present or absent')
    expect(entryPayload('s1', { ...blank, present: false, remarks: ' Unwell ' }, 'marks', paper)).toEqual({ studentId: 's1', present: false, remarks: 'Unwell' })
    expect(entryPayload('s1', { ...blank, present: true }, 'marks', paper)).toBe('Enter the marks')
    expect(entryPayload('s1', { ...blank, present: true, marks: '-3.5', correct: '2' }, 'marks', paper)).toEqual({ studentId: 's1', present: true, remarks: null, marks: -3.5, correct: 2, incorrect: null, unattempted: null })
    expect(entryPayload('s1', { ...blank, present: true, marks: '10', correct: '1.5' }, 'marks', paper)).toBe('Counts must be whole numbers')
    expect(entryPayload('s1', { ...blank, present: true }, 'answers', paper)).toBe('Enter the answers (or switch to Total marks for a blank sheet)')
    expect(entryPayload('s1', { ...blank, present: true, answers: { q1: 'B', q3: '4' } }, 'answers', paper)).toEqual({
      studentId: 's1',
      present: true,
      remarks: null,
      answers: [
        { testQuestionId: 'q1', response: 'B' },
        { testQuestionId: 'q3', marksAwarded: 4 },
      ],
    })
  })

  it('preview score by the grading rules; quick fill in paper order', () => {
    expect(previewScore(paper, { q1: 'b', q2: '12', q3: '3' })).toEqual({ marks: 11, answered: 3 })
    expect(previewScore(paper, { q1: 'A', q2: '11' })).toEqual({ marks: -1, answered: 2 })
    expect(quickFill(paper, 'b, 12, 3')).toEqual({ q1: 'B', q2: '12', q3: '3' })
    expect(quickFill(paper, '- 7')).toEqual({ q2: '7' })
    expect(quickFill(paper, 'E')).toBe('Q1 is an MCQ: answer A, B, C or D')
    expect(quickFill(paper, 'A B')).toBe('Q2 needs a number')
    expect(quickFill(paper, 'A 1 2 3')).toBe("That's 4 answers for a 3-question paper")
  })

  it('filters (All / Present / Absent / Passed / Failed) and search by name or roll number', () => {
    const rows = [row({}), row({ present: false, marks: null, percent: null, passed: null }, 's2', 'Diya Rao', '02'), row({ percent: 20, passed: false }, 's3', 'Kabir Jain', null), row(null, 's4', 'Meera Iyer', '04')]
    const ids = (f: Parameters<typeof filterRows>[1], q = '') => filterRows(rows, f, q).map((r) => r.student.id)
    expect(ids('all')).toEqual(['s1', 's2', 's3', 's4'])
    expect(ids('present')).toEqual(['s1', 's3'])
    expect(ids('absent')).toEqual(['s2'])
    expect(ids('passed')).toEqual(['s1'])
    expect(ids('failed')).toEqual(['s3'])
    expect(ids('all', '04')).toEqual(['s4'])
    expect(ids('all', 'diya')).toEqual(['s2'])
  })

  it('CSV rows: one per student, graded or not', () => {
    const view = { test: { totalMarks: 300 }, rows: [row({ marks: 150, percent: 50, passed: true, rank: 1, percentile: 100, remarks: 'Good' }), row(null, 's2', 'Diya Rao', null)] } as unknown as ResultsView
    const [header, first, second] = resultsCsvRows(view)
    expect(header[0]).toBe('Student')
    expect(first).toEqual(['Aarav Shah', '01', 'Present', 150, 300, '', '', '', 50, 'Passed', 1, 100, 'Good'])
    expect(second.slice(0, 4)).toEqual(['Diya Rao', '', 'Not graded', ''])
  })
})

describe('PDF text lines', () => {
  const item = (str: string, y: number, hasEOL = false) => ({ str, transform: [1, 0, 0, 1, 0, y], height: 11, hasEOL })
  it('joins runs on a line, breaks at end-of-line marks and when the baseline moves', () => {
    const text = linesOf([item('Subject: ', 800), item('Physics', 800, true), item('1. What is', 760), item(' heat?', 760), item('(A) a (B) b', 740), { type: 'beginMarkedContent' }, item('ANSWER KEY', 700, true)])
    expect(text).toBe('Subject: Physics\n1. What is heat?\n(A) a (B) b\nANSWER KEY\n')
  })
})

describe('saving results in chunks', () => {
  const student = (answers: number) => ({ studentId: 's', present: true, answers: Array.from({ length: answers }, () => ({ testQuestionId: 'q' })) })
  it('starts a new chunk at 200 students or 12,000 answers, never splitting a student', () => {
    expect(resultChunks(Array.from({ length: 450 }, () => ({ studentId: 's', present: false, answers: [] }))).map((c) => c.length)).toEqual([200, 200, 50])
    // A 90-question paper: 133 students fit (11,970 answers), the 134th starts the next chunk.
    expect(resultChunks(Array.from({ length: 300 }, () => student(90))).map((c) => c.length)).toEqual([133, 133, 34])
    expect(resultChunks([student(20_000), student(1)]).map((c) => c.length)).toEqual([1, 1])
    expect(resultChunks([])).toEqual([])
    // Exactly 12,000 answers fit in one chunk; one more starts the next.
    expect(resultChunks([student(6000), student(6000)]).map((c) => c.length)).toEqual([2])
    expect(resultChunks([student(6000), student(6000), student(1)]).map((c) => c.length)).toEqual([2, 1])
  })
})
