import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type Term = 'UNIT_TEST_1' | 'TERM_1' | 'MID_TERM' | 'TERM_2' | 'ANNUAL'
export type Grade = 'A+' | 'A' | 'B+' | 'B' | 'C' | 'F'
export type Band = 'STRONG' | 'AVERAGE' | 'WEAK'

export type ReportOptions = {
  currentYear: number
  years: { year: number; label: string }[]
  terms: { key: Term; label: string }[]
  subjects: string[]
  gradeScale: { grade: Grade; min: number }[]
  needsAttentionPercent: number
  /** False for a teacher whose profile is inactive: they read nothing and change nothing. */
  canWrite: boolean
  /** Only admins delete a report sheet; a teacher uploads the corrected sheet instead. */
  canDeleteSheets: boolean
  batches: { id: string; name: string; program: string }[]
}

export type StudentHit = { id: string; fullName: string; rollNumber: string | null; status: string; batch: { id: string; name: string } | null }

export type TopicStrength = {
  subject: string
  chapter: string | null
  topic: string
  percent: number
  band: Band
  test: { questions: number; percent: number } | null
  assignments: { count: number; percent: number } | null
}

type Breakdown = { questions: number; correct: number; partial: number; incorrect: number; unattempted: number; accuracy: number | null; attemptRate: number | null }

/** The 5-in-1 report (PRD 4.5): every figure is null when there is nothing to work it out from. */
export type StudentReport = {
  generatedAt: string
  year: { year: number; label: string; from: string; to: string; current: number }
  years: { year: number; label: string }[]
  student: { id: string; fullName: string; rollNumber: string | null; admissionNumber: string | null; classLevel: string | null; status: string; batch: { id: string; name: string } | null; program: string | null }
  summary: {
    overallPercent: number | null
    grade: Grade | null
    marks: number | null
    totalMarks: number | null
    testsTaken: number
    testsAbsent: number
    batchRank: { rank: number; of: number; percentile: number; topPercent: number } | null
    accuracy: number | null
    attemptRate: number | null
    behaviourScore: number | null
    attendanceRate: number | null
    ptmMeetings: number
  }
  performance: {
    subjects: { subject: string; marks: number; totalMarks: number; percent: number | null; grade: Grade | null; tests: number }[]
    tests: { id: string; title: string; type: string; subject: string; date: string; present: boolean; marks: number | null; totalMarks: number; percent: number | null; grade: Grade | null; rank: number | null; of: number | null; percentile: number | null }[]
  }
  analysis: {
    questions: number
    attempted: number
    correct: number
    incorrect: number
    unattempted: number
    accuracy: number | null
    attemptRate: number | null
    testsCounted: number
    answered: number
    byType: (Breakdown & { type: string })[]
    byDifficulty: (Breakdown & { difficulty: string })[]
  }
  /** Each band lists at most 25 (strongest, middle and weakest first); `counts` has how many each band holds. Older APIs send no counts. */
  topics: { strong: TopicStrength[]; average: TopicStrength[]; weak: TopicStrength[]; counts?: { strong: number; average: number; weak: number } }
  mistakes: {
    incorrect: number
    partial: number
    unattempted: number
    bySubject: { subject: string; incorrect: number; partial: number; unattempted: number }[]
    recent: {
      test: { id: string; title: string; date: string }
      question: number
      subject: string
      chapter: string | null
      topic: string
      difficulty: string
      type: string
      text: string
      response: string | null
      correctAnswer: string | null
      marksAwarded: number
      marks: number
      outcome: 'INCORRECT' | 'PARTIAL'
    }[]
  }
  feedback: {
    /** A teacher's view: the ratings and PTM notes listed are their own; the totals and averages are everyone's. */
    ownOnly: boolean
    ratings: { count: number; days: number; attitude: number | null; behaviour: number | null; focus: number | null; interaction: number | null; score: number | null } | null
    recentRatings: { date: string; raterName: string; attitude: number; behaviour: number; focus: number; interaction: number; notes: string | null }[]
    attendance: { present: number; late: number; absent: number; excused: number; classes: number; rate: number | null }
    ptm: {
      meetings: number
      parentAttended: number
      parentAttendanceRate: number | null
      /** `teacherLeft`: the teacher who logged it has since left (absent from older APIs). */
      notes: { date: string; teacherName: string; teacherLeft?: boolean; parentName: string | null; parentAttended: boolean; discussion: string; actionItems: string | null; followUpDate: string | null }[]
    }
  }
  coverage: { tests: number; answers: number; gradedAssignments: number; ratings: number; classes: number; ptmNotes: number }
}

export type MarkSet = {
  batch: { id: string; name: string }
  term: Term
  termLabel: string
  subject: string
  students: number
  average: number
  grade: Grade | null
  highest: number
  lowest: number
  enteredBy: string
  source: 'IMPORT' | 'MANUAL'
  updatedAt: string
}

export type Page<T> = { year: { year: number; label: string }; total: number; page: number; pageSize: number; items: T[] }

export type SetRow = { student: { id: string; fullName: string; rollNumber: string | null }; marks: number; maxMarks: number; percent: number | null; grade: Grade | null; attendance: number | null; remarks: string | null; source: string; enteredBy: string; updatedAt: string }

export type ClassOverview = {
  year: { year: number; label: string }
  kpis: { students: number; sets: number; average: number | null; grade: Grade | null }
  trend: { term: Term; label: string; subjects: Record<string, number> }[]
  subjects: string[]
  topPerformers: { student: { id: string; fullName: string; rollNumber: string | null; batch: string | null }; percent: number; grade: Grade | null; subjects: number }[]
  subjectAverages: { subject: string; average: number; students: number; grade: Grade | null; needsAttention: boolean }[]
  needsAttention: { subject: string; average: number; students: number; grade: Grade | null }[]
  mistakes: { subject: string; topic: string; wrong: number; skipped: number; answers: number; missRate: number | null }[]
}

export type ProgressCard = {
  student: { id: string; fullName: string; rollNumber: string | null }
  batch: { id: string; name: string }
  year: number
  term: Term
  termLabel: string
  marks: number
  maxMarks: number
  percent: number
  grade: Grade | null
  rank: number
  of: number
  percentile: number
  subjects?: { subject: string; marks: number; maxMarks: number; percent: number | null; grade: Grade | null; attendance: number | null; remarks: string | null }[]
  teacherRemarks?: string | null
  principalRemarks?: string | null
  reportedBy?: string | null
  updatedAt?: string
}

export type ProgressList = Page<ProgressCard> & { kpis: { total: number; average: number | null; toppers: ProgressCard[] } }

export type ProgressOne = {
  student: { id: string; fullName: string; rollNumber: string | null }
  batchId: string
  exists: boolean
  subjects: { subject: string; marks: number; maxMarks: number }[]
  teacherRemarks: string | null
  principalRemarks: string | null
}

export type ImportPreview = {
  applied: boolean
  created: number
  updated: number
  skipped: number
  rows: { row: number; label: string; action: 'create' | 'update' | 'error'; errors: string[] }[]
}

/** Where a portal's report routes live: an admin's school, or the signed-in teacher's. */
export const reportsBase = (schoolId?: string) => (schoolId ? `/schools/${schoolId}/student-reports` : '/teacher/student-reports')

export const query = (params: Record<string, string | number | null | undefined>) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v]) => [k, String(v)])).toString()

export function useReportOptions(base: string) {
  return useQuery({ queryKey: [base, 'options'], queryFn: () => api<ReportOptions>(`${base}/options`), staleTime: 60_000 })
}

export function useStudentSearch(base: string, q: string, enabled: boolean) {
  return useQuery({
    queryKey: [base, 'search', q],
    queryFn: () => api<StudentHit[]>(`${base}/students?${query({ q })}`),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}

export function useStudentReport(base: string, studentId: string | null, year: number | null) {
  return useQuery({
    queryKey: [base, 'report', studentId, year],
    queryFn: () => api<StudentReport>(`${base}/students/${studentId}?${query({ year })}`),
    enabled: !!studentId,
    placeholderData: (prev) => (prev?.student.id === studentId ? prev : undefined),
  })
}

export type OverviewFilters = { year?: number | null; term?: string; batchId?: string; subject?: string }

export function useClassOverview(base: string, f: OverviewFilters) {
  return useQuery({ queryKey: [base, 'overview', f], queryFn: () => api<ClassOverview>(`${base}/overview?${query(f)}`), placeholderData: keepPreviousData })
}

export function useMarkSets(base: string, f: OverviewFilters & { q?: string; page?: number }) {
  return useQuery({ queryKey: [base, 'sets', f], queryFn: () => api<Page<MarkSet>>(`${base}/marks/sets?${query(f)}`), placeholderData: keepPreviousData })
}

export function useMarkSet(base: string, key: { batchId: string; year: number; term: Term; subject: string } | null) {
  return useQuery({ queryKey: [base, 'set', key], queryFn: () => api<SetRow[]>(`${base}/marks/set?${query(key!)}`), enabled: !!key })
}

export function useProgressList(base: string, f: { year?: number | null; term?: string; batchId?: string; q?: string; page?: number }) {
  return useQuery({ queryKey: [base, 'progress', f], queryFn: () => api<ProgressList>(`${base}/progress-reports?${query(f)}`), placeholderData: keepPreviousData })
}

export function useRoster(base: string, batchId: string) {
  return useQuery({
    queryKey: [base, 'roster', batchId],
    queryFn: () => api<{ id: string; fullName: string; rollNumber: string | null; status: string }[]>(`${base}/roster/${batchId}`),
    enabled: !!batchId,
  })
}

/** After a change to marks, reports or results: every report view of this portal. */
export function useInvalidateReports(base: string) {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: [base] })
}

// Display

export const GRADE_STYLE: Record<Grade, string> = {
  'A+': 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  A: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  'B+': 'bg-sky-50 text-sky-700 ring-sky-200',
  B: 'bg-sky-50 text-sky-700 ring-sky-200',
  C: 'bg-amber-50 text-amber-700 ring-amber-200',
  F: 'bg-rose-50 text-rose-700 ring-rose-200',
}

export const BAND_LABELS: Record<Band, string> = { STRONG: 'Strong (75%+)', AVERAGE: 'Average (50–74%)', WEAK: 'Weak (below 50%)' }
export const RATING_LABELS = ['Unsatisfactory', 'Satisfactory', 'Good', 'Very Good', 'Excellent'] as const
export const TYPE_LABELS: Record<string, string> = { MCQ: 'MCQ', NUMERICAL: 'Numerical', INTEGER: 'Integer', SUBJECTIVE: 'Subjective' }
export const DIFFICULTY_LABELS: Record<string, string> = { EASY: 'Easy', MEDIUM: 'Medium', HARD: 'Hard' }

/** "72.5%" or "—" (no data, never 0%). */
export const pct = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? '—' : `${Number(v.toFixed(digits))}%`)
export const num = (v: number | null | undefined) => (v === null || v === undefined ? '—' : String(Number(v.toFixed(2))))

/** "17 Oct 2026" for a YYYY-MM-DD day. */
export const dayLabel = (d: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${d}T00:00:00Z`))

export const fileSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report'

// Import student report: the sheet asks only for what no other module records.

export const MARK_COLUMNS = {
  rollNo: ['Roll No', 'RollNo', 'Roll Number', 'Roll'],
  name: ['Name', 'Student Name', 'Student'],
  marks: ['Marks', 'Marks Obtained', 'Obtained'],
  maxMarks: ['Max Marks', 'MaxMarks', 'Total Marks', 'Out Of'],
  attendance: ['Attendance', 'Attendance %', 'Attendance Percent'],
  remarks: ['Remarks', 'Remark', 'Comments'],
}
export const MARK_HEADERS = ['Roll No', 'Name', 'Marks', 'Max Marks', 'Attendance', 'Remarks']
