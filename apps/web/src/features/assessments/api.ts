import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD'
export type QuestionType = 'MCQ' | 'NUMERICAL' | 'INTEGER' | 'SUBJECTIVE'
export type TestType = 'UNIT_TEST' | 'MOCK' | 'DPP'
export type TestPhase = 'SCHEDULED' | 'ONGOING' | 'COMPLETED' | 'CANCELLED'
export type Outcome = 'CORRECT' | 'PARTIAL' | 'INCORRECT' | 'UNATTEMPTED'

export type Question = {
  id: string
  subject: string
  chapter: { id: string | null; name: string | null } | null
  topic: string
  difficulty: Difficulty
  type: QuestionType
  text: string
  options: string[]
  correctAnswer: string | null
  marks: number
  negativeMarks: number
  source: string
  author: { facultyId: string | null; name: string }
  createdAt: string
}

export type Test = {
  id: string
  title: string
  type: TestType
  subject: string
  batch: { id: string; name: string }
  program: { id: string; name: string }
  /** IST day and time, YYYY-MM-DD and HH:MM. */
  date: string
  time: string
  startsAt: string
  durationMinutes: number
  totalMarks: number
  phase: TestPhase
  /** Who scheduled it: a teacher (with an id) or an admin. */
  faculty: { id: string | null; name: string }
  questions: number
  results: number
}

export type Page<T> = { total: number; page: number; pageSize: number; items: T[] }

export type Options = {
  today: string
  /** False for a teacher whose faculty profile is inactive (read-only). */
  active: boolean
  /** The signed-in teacher's faculty id; null for admins. */
  facultyId: string | null
  subjects: string[]
  difficulties: Difficulty[]
  questionTypes: QuestionType[]
  testTypes: TestType[]
  defaults: { durationMinutes: number; totalMarks: number; marks: number; negativeMarks: number; source: string }
  /** Curriculum chapters with their concepts (suggested as topics, so tests and assignments name topics alike). */
  chapters: { id: string; name: string; subject: string; concepts: string[] }[]
  batches: { id: string; name: string; program: { id: string; name: string } }[]
  faculty: { id: string; name: string }[]
  programs: { id: string; name: string }[]
}

export type Overview = {
  kpis: { scheduledThisWeek: number; totalQuestions: number; averageScore: number | null; pendingGrading: number }
  week: { from: string; tests: Test[] }
  batchAverages: { batch: { id: string; name: string }; test: { id: string; title: string; date: string }; averagePercent: number; students: number }[]
}

export type PaperQuestion = {
  id: string
  questionId: string | null
  position: number
  subject: string
  chapterName: string | null
  topic: string
  difficulty: Difficulty
  type: QuestionType
  text: string
  options: string[]
  correctAnswer: string | null
  marks: number
  negativeMarks: number
}

export type TestDetail = { test: Test; paper: { questions: PaperQuestion[]; totalMarks: number; locked: boolean }; canEdit: boolean }

export type Answer = { testQuestionId: string; response: string | null; outcome: Outcome; marksAwarded: number }

export type Result = {
  present: boolean
  marks: number | null
  correct: number | null
  incorrect: number | null
  unattempted: number | null
  remarks: string | null
  percent: number | null
  passed: boolean | null
  rank: number | null
  percentile: number | null
  gradedBy: string
  updatedAt: string
  answers: Answer[]
}

export type ResultRow = { student: { id: string; fullName: string; rollNumber: string | null; inBatch: boolean }; result: Result | null }

export type ClassStats = {
  students: number
  graded: number
  present: number
  absent: number
  averageMarks: number | null
  averagePercent: number | null
  highest: number | null
  lowest: number | null
  passed: number
  passPercent: number
  distribution: { label: string; count: number }[]
}

export type ResultsView = { test: Test; paper: PaperQuestion[]; stats: ClassStats; canGrade: boolean; rows: ResultRow[] }

export type ImportPreview = {
  applied: boolean
  created: number
  skipped: number
  /** `options`: an MCQ's four options as read from the file, so a wrong split shows before confirming. */
  rows: { row: number; label: string; action: 'create' | 'error'; errors: string[]; options?: string[] }[]
}

export const DIFFICULTY_LABELS: Record<Difficulty, string> = { EASY: 'Easy', MEDIUM: 'Medium', HARD: 'Hard' }
export const TYPE_LABELS: Record<QuestionType, string> = { MCQ: 'MCQ', NUMERICAL: 'Numerical', INTEGER: 'Integer', SUBJECTIVE: 'Subjective' }
export const TEST_TYPE_LABELS: Record<TestType, string> = { UNIT_TEST: 'Unit Test', MOCK: 'Mock', DPP: 'DPP' }
export const PHASE_LABELS: Record<TestPhase, string> = { SCHEDULED: 'Scheduled', ONGOING: 'Ongoing', COMPLETED: 'Completed', CANCELLED: 'Cancelled' }
export const LETTERS = ['A', 'B', 'C', 'D'] as const

/** Where a portal's assessment routes live: an admin's school, or the signed-in teacher's. */
export const assessmentsBase = (schoolId?: string) => (schoolId ? `/schools/${schoolId}/assessments` : '/teacher/assessments')

const query = (params: Record<string, string | number | null | undefined>) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v]) => [k, String(v)])).toString()

export function useAssessmentOptions(base: string) {
  return useQuery({ queryKey: [base, 'options'], queryFn: () => api<Options>(`${base}/options`), staleTime: 60_000 })
}

export function useOverview(base: string) {
  return useQuery({ queryKey: [base, 'overview'], queryFn: () => api<Overview>(`${base}/overview`) })
}

export type QuestionFilters = { q?: string; subject?: string; difficulty?: string; type?: string; chapterId?: string; author?: string; bank?: 'mine' | 'school'; page?: number; pageSize?: number }

export function useQuestions(base: string, f: QuestionFilters, enabled = true) {
  return useQuery({
    queryKey: [base, 'questions', f],
    queryFn: () => api<Page<Question>>(`${base}/questions?${query(f)}`),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export type TestFilters = { q?: string; batchId?: string; programId?: string; author?: string; type?: string; status?: string; from?: string; to?: string; page?: number; pageSize?: number }

export function useTests(base: string, f: TestFilters) {
  return useQuery({ queryKey: [base, 'tests', f], queryFn: () => api<Page<Test>>(`${base}/tests?${query(f)}`), placeholderData: keepPreviousData })
}

/**
 * Tests that have started, for picking one to grade (Academic Records):
 * running now first, then finished ones newest first, 50 at a time with "load
 * more", narrowed by a search (title, subject or batch). Paged by the API, so
 * no test is out of reach.
 */
export function useGradableTests(base: string, q: string) {
  const ongoing = useQuery({ queryKey: [base, 'tests', 'gradable', 'ongoing', q], queryFn: () => api<Page<Test>>(`${base}/tests?${query({ status: 'ONGOING', q, pageSize: 50 })}`) })
  const completed = useInfiniteQuery({
    queryKey: [base, 'tests', 'gradable', 'completed', q],
    queryFn: ({ pageParam }) => api<Page<Test>>(`${base}/tests?${query({ status: 'COMPLETED', q, page: pageParam, pageSize: 50 })}`),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  })
  const finished = completed.data?.pages.flatMap((p) => p.items) ?? []
  return {
    tests: [...(ongoing.data?.items ?? []), ...finished],
    loaded: !!ongoing.data && !!completed.data,
    error: ongoing.error ?? completed.error,
    remaining: Math.max(0, (completed.data?.pages.at(-1)?.total ?? 0) - finished.length),
    loadMore: () => completed.fetchNextPage(),
    loadingMore: completed.isFetchingNextPage,
  }
}

export function useTestDetail(base: string, id: string | null) {
  return useQuery({ queryKey: [base, 'test', id], queryFn: () => api<TestDetail>(`${base}/tests/${id}`), enabled: !!id })
}

export function useResults(base: string, id: string | null) {
  return useQuery({ queryKey: [base, 'results', id], queryFn: () => api<ResultsView>(`${base}/tests/${id}/results`), enabled: !!id })
}

/** After any change: this portal's assessment views, and the teacher dashboard's upcoming tests. */
export function useInvalidateAssessments(base: string) {
  const client = useQueryClient()
  return () => Promise.all([client.invalidateQueries({ queryKey: [base] }), client.invalidateQueries({ queryKey: ['teacher-dashboard'] })])
}

// Question form

export type QuestionForm = {
  subject: string
  chapterId: string
  topic: string
  difficulty: Difficulty | ''
  type: QuestionType
  text: string
  options: [string, string, string, string]
  correctAnswer: string
  marks: string
  /** As staff write it: "0", "-1" or "1" all work (stored as marks taken off). */
  negativeMarks: string
  source: string
}

export const emptyQuestion = (d: Pick<Options['defaults'], 'marks' | 'negativeMarks' | 'source'>): QuestionForm => ({
  subject: '',
  chapterId: '',
  topic: '',
  difficulty: '',
  type: 'MCQ',
  text: '',
  options: ['', '', '', ''],
  correctAnswer: '',
  marks: String(d.marks),
  negativeMarks: d.negativeMarks ? `-${d.negativeMarks}` : '0',
  source: d.source,
})

export const questionForm = (q: Question): QuestionForm => ({
  subject: q.subject,
  chapterId: q.chapter?.id ?? '',
  topic: q.topic,
  difficulty: q.difficulty,
  type: q.type,
  text: q.text,
  options: q.type === 'MCQ' ? [q.options[0] ?? '', q.options[1] ?? '', q.options[2] ?? '', q.options[3] ?? ''] : ['', '', '', ''],
  correctAnswer: q.correctAnswer ?? '',
  marks: String(q.marks),
  negativeMarks: q.negativeMarks ? `-${q.negativeMarks}` : '0',
  source: q.source,
})

const wholeNumber = (s: string) => (/^-?\d+$/.test(s.trim()) ? Number(s.trim()) : null)

/** What's missing or wrong, in the order of the form, or null when it can be saved. */
export function questionProblem(f: QuestionForm, withSource: boolean): string | null {
  if (!f.subject) return 'Select a subject'
  if (!f.topic.trim()) return 'Enter the concept or topic'
  if (!f.difficulty) return 'Select a difficulty'
  if (!f.text.trim()) return 'Enter the question text'
  if (f.type === 'MCQ') {
    if (f.options.some((o) => !o.trim())) return 'Fill in all four options, A to D'
    if (!LETTERS.includes(f.correctAnswer as (typeof LETTERS)[number])) return 'Choose the correct option'
  }
  if (f.type === 'INTEGER' && !/^-?\d+$/.test(f.correctAnswer.trim())) return 'Enter the correct answer as a whole number'
  if (f.type === 'NUMERICAL' && !/^-?\d+(\.\d+)?$/.test(f.correctAnswer.trim())) return 'Enter the correct answer as a number'
  const marks = wholeNumber(f.marks)
  if (marks === null || marks < 1 || marks > 100) return 'Marks must be a whole number from 1 to 100'
  const negative = wholeNumber(f.negativeMarks)
  if (negative === null || Math.abs(negative) > 9) return 'Negative marks must be 0 to -9'
  if (withSource && !f.source.trim()) return 'Enter the source'
  return null
}

export function questionPayload(f: QuestionForm, withSource: boolean) {
  return {
    subject: f.subject,
    chapterId: f.chapterId || null,
    topic: f.topic.trim(),
    difficulty: f.difficulty,
    type: f.type,
    text: f.text.trim(),
    options: f.type === 'MCQ' ? f.options.map((o) => o.trim()) : [],
    correctAnswer: f.correctAnswer.trim() || null,
    marks: Number(f.marks),
    negativeMarks: Math.abs(Number(f.negativeMarks)),
    ...(withSource ? { source: f.source.trim() } : {}),
  }
}

/** The answer as the bank table shows it: "B) Kelvin", "42" or "—". */
export function answerLabel(q: { type: QuestionType; options: string[]; correctAnswer: string | null }): string {
  if (!q.correctAnswer) return '—'
  if (q.type !== 'MCQ') return q.correctAnswer
  const i = LETTERS.indexOf(q.correctAnswer as (typeof LETTERS)[number])
  return i >= 0 && q.options[i] ? `${q.correctAnswer}) ${q.options[i]}` : q.correctAnswer
}

// Test form

export type TestForm = { title: string; type: TestType | ''; subject: string; batchId: string; date: string; time: string; durationMinutes: string; totalMarks: string }

export const emptyTest = (d: Pick<Options['defaults'], 'durationMinutes' | 'totalMarks'>, date = ''): TestForm => ({
  title: '',
  type: '',
  subject: '',
  batchId: '',
  date,
  time: '',
  durationMinutes: String(d.durationMinutes),
  totalMarks: String(d.totalMarks),
})

export const testForm = (t: Test): TestForm => ({
  title: t.title,
  type: t.type,
  subject: t.subject,
  batchId: t.batch.id,
  date: t.date,
  time: t.time,
  durationMinutes: String(t.durationMinutes),
  totalMarks: String(t.totalMarks),
})

export function testProblem(f: TestForm): string | null {
  if (!f.title.trim()) return 'Enter the test title'
  if (!f.batchId) return 'Select a batch'
  if (!f.type) return 'Select the test type'
  if (!f.subject) return 'Select a subject'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return 'Select the date'
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(f.time)) return 'Select the time'
  const duration = wholeNumber(f.durationMinutes)
  if (duration === null || duration < 1 || duration > 720) return 'Duration must be 1 to 720 minutes'
  const total = wholeNumber(f.totalMarks)
  if (total === null || total < 1 || total > 10000) return 'Total marks must be 1 to 10000'
  return null
}

export const testPayload = (f: TestForm) => ({
  title: f.title.trim(),
  type: f.type,
  subject: f.subject,
  batchId: f.batchId,
  date: f.date,
  time: f.time,
  durationMinutes: Number(f.durationMinutes),
  totalMarks: Number(f.totalMarks),
})

// Calendar

/** The seven IST days of the week starting `from` (a Monday), YYYY-MM-DD. */
export function weekDays(from: string): string[] {
  const start = new Date(`${from}T00:00:00Z`)
  return Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10))
}

/** "10:00" -> "10:00 AM" */
export function time12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** "180 min" or "3 h" or "1 h 30 min". */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

// Results entry

export type Entry = {
  /** null until the teacher marks the student present or absent. */
  present: boolean | null
  marks: string
  correct: string
  incorrect: string
  unattempted: string
  remarks: string
  /** Per question: the student's response (objective) or marks given (subjective). */
  answers: Record<string, string>
}

export function entryOf(row: ResultRow, paper: PaperQuestion[]): Entry {
  const r = row.result
  const answers: Record<string, string> = {}
  for (const a of r?.answers ?? []) {
    const q = paper.find((p) => p.id === a.testQuestionId)
    if (!q) continue
    if (q.type === 'SUBJECTIVE') {
      if (a.outcome !== 'UNATTEMPTED') answers[q.id] = String(a.marksAwarded)
    } else if (a.response) answers[q.id] = a.response
  }
  const n = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v))
  return { present: r ? r.present : null, marks: n(r?.marks), correct: n(r?.correct), incorrect: n(r?.incorrect), unattempted: n(r?.unattempted), remarks: r?.remarks ?? '', answers }
}

export const sameEntry = (a: Entry, b: Entry) => JSON.stringify(a) === JSON.stringify(b)

const optionalCount = (s: string) => (s.trim() === '' ? null : Number(s))

/**
 * One student's result for the API, or a message saying what's wrong. With
 * answers, the API works out the marks and counts; otherwise the marks typed.
 */
export function entryPayload(studentId: string, e: Entry, mode: 'marks' | 'answers', paper: PaperQuestion[]) {
  const remarks = e.remarks.trim() || null
  if (e.present === null) return 'Mark the student present or absent'
  if (!e.present) return { studentId, present: false, remarks }
  if (mode === 'answers') {
    const answers = paper.flatMap((q) => {
      const v = (e.answers[q.id] ?? '').trim()
      if (!v) return []
      return [q.type === 'SUBJECTIVE' ? { testQuestionId: q.id, marksAwarded: Number(v) } : { testQuestionId: q.id, response: v }]
    })
    for (const a of answers) if ('marksAwarded' in a && !Number.isFinite(a.marksAwarded)) return 'Marks for a subjective answer must be a number'
    // A blank sheet is entered as total marks (0), so a stray "present" never saves as a zero.
    if (!answers.length) return 'Enter the answers (or switch to Total marks for a blank sheet)'
    return { studentId, present: true, remarks, answers }
  }
  if (e.marks.trim() === '' || !Number.isFinite(Number(e.marks))) return 'Enter the marks'
  for (const c of [e.correct, e.incorrect, e.unattempted]) if (c.trim() !== '' && !/^\d+$/.test(c.trim())) return 'Counts must be whole numbers'
  return { studentId, present: true, remarks, marks: Number(e.marks), correct: optionalCount(e.correct), incorrect: optionalCount(e.incorrect), unattempted: optionalCount(e.unattempted) }
}

export type RowFilter = 'all' | 'present' | 'absent' | 'passed' | 'failed'

export function filterRows(rows: ResultRow[], filter: RowFilter, search: string): ResultRow[] {
  const q = search.trim().toLowerCase()
  return rows.filter((r) => {
    if (q && !r.student.fullName.toLowerCase().includes(q) && !(r.student.rollNumber ?? '').toLowerCase().includes(q)) return false
    const res = r.result
    if (filter === 'present') return res?.present === true
    if (filter === 'absent') return res?.present === false
    if (filter === 'passed') return res?.passed === true
    if (filter === 'failed') return res?.passed === false
    return true
  })
}

/** Test results as CSV rows (PRD 5.12 Export CSV), header first. */
export function resultsCsvRows(view: ResultsView): (string | number)[][] {
  return [
    ['Student', 'Roll No', 'Status', 'Marks', `Out of`, 'Correct', 'Incorrect', 'Unattempted', '%', 'Result', 'Rank', 'Percentile', 'Remarks'],
    ...view.rows.map(({ student: s, result: r }) => [
      s.fullName,
      s.rollNumber ?? '',
      r ? (r.present ? 'Present' : 'Absent') : 'Not graded',
      r?.marks ?? '',
      view.test.totalMarks,
      r?.correct ?? '',
      r?.incorrect ?? '',
      r?.unattempted ?? '',
      r?.percent ?? '',
      r?.passed === null || r?.passed === undefined ? '' : r.passed ? 'Passed' : 'Failed',
      r?.rank ?? '',
      r?.percentile ?? '',
      r?.remarks ?? '',
    ]),
  ]
}

/** The marks that count against the test's total when the paper is the whole test. */
export const paperTotal = (paper: { marks: number }[]) => paper.reduce((n, q) => n + q.marks, 0)

const mcqLetter = (s: string) => /^\s*(?:option\s*)?\(?\s*([a-d])\s*\)?\.?\s*$/i.exec(s)?.[1].toUpperCase() ?? null

/**
 * A preview of one student's score while answers are typed, by the same rules
 * the server grades with (it has the final word on save): right earns the
 * marks, wrong loses the negative marks, blank earns nothing, subjective
 * answers earn the marks given.
 */
export function previewScore(paper: PaperQuestion[], answers: Record<string, string>) {
  let marks = 0
  let answered = 0
  for (const q of paper) {
    const v = (answers[q.id] ?? '').trim()
    if (!v) continue
    answered++
    if (q.type === 'SUBJECTIVE') {
      const n = Number(v)
      if (Number.isFinite(n)) marks += n
      continue
    }
    const right = q.type === 'MCQ' ? mcqLetter(v) === q.correctAnswer : /^-?\d+(\.\d+)?$/.test(v) && q.correctAnswer !== null && Math.round(Number(v) * 100) === Math.round(Number(q.correctAnswer) * 100)
    marks += right ? q.marks : -q.negativeMarks
  }
  return { marks: Math.round(marks * 100) / 100, answered }
}

/**
 * Quick fill: a student's answers in paper order, separated by commas or
 * spaces ("B, C, 42, -, 3"). "-" leaves a question blank; a subjective
 * question takes the marks given. Returns the answers, or a message.
 */
export function quickFill(paper: PaperQuestion[], text: string): Record<string, string> | string {
  const tokens = text.split(/[\s,]+/).filter(Boolean)
  if (tokens.length > paper.length) return `That's ${tokens.length} answers for a ${paper.length}-question paper`
  const out: Record<string, string> = {}
  for (const [i, token] of tokens.entries()) {
    const q = paper[i]
    if (token === '-' || token === '_') continue
    if (q.type === 'MCQ' && !mcqLetter(token)) return `Q${i + 1} is an MCQ: answer A, B, C or D`
    if (q.type !== 'MCQ' && !/^-?\d+(\.\d+)?$/.test(token)) return `Q${i + 1} needs a number`
    out[q.id] = q.type === 'MCQ' ? mcqLetter(token)! : token
  }
  return out
}

/** Limits per save request: students, and answers in all (about 80 bytes each, well under the API's 2 MB). */
export const SAVE_LIMITS = { students: 200, answers: 12_000 }

/**
 * Splits a results save into chunks, in order: a new chunk starts once it
 * would pass the student or answer limit (a 90-question paper is about 130
 * students a chunk; totals only, 200). A single student is never split.
 */
export function resultChunks<T extends { answers?: unknown[] }>(results: T[], limits = SAVE_LIMITS): T[][] {
  const chunks: T[][] = []
  let current: T[] = []
  let answers = 0
  for (const r of results) {
    const n = r.answers?.length ?? 0
    if (current.length && (current.length >= limits.students || answers + n > limits.answers)) {
      chunks.push(current)
      current = []
      answers = 0
    }
    current.push(r)
    answers += n
  }
  if (current.length) chunks.push(current)
  return chunks
}
