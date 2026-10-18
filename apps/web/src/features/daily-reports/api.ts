import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type ReportStatus = 'ON_TIME' | 'LATE' | 'FLAGGED'

export type DailyReport = {
  id: string
  /** The day taught, YYYY-MM-DD. */
  date: string
  teacher: { id: string | null; name: string }
  batch: { id: string; name: string }
  program: { id: string; name: string }
  subject: string
  chapter: string | null
  topics: string
  homework: string | null
  observations: string | null
  /** Submitted after its day (in India): decided by the server. */
  late: boolean
  submittedAt: string
  edited: boolean
}

/** An admin's flag on a report, for follow-up. The teacher sees it on their own reports. */
export type ReportFlag = { at: string; by: string; reason: string | null }

/** One of the teacher's own reports (Your Recent Submissions), with any admin flag. */
export type MyReport = DailyReport & { flag: ReportFlag | null }

export type AdminDay = {
  date: string
  /** Classes: each batch's subjects reported for the day. */
  kpis: { submitted: number; late: number; teachers: number; classes: number; flagged: number }
  /** `changedAfter`: the teacher edited (or moved) the report after it was flagged. */
  items: (DailyReport & { flag: (ReportFlag & { changedAfter: boolean }) | null })[]
}

export type ReportOptions = {
  /** Today in India, YYYY-MM-DD: the form's default date. */
  today: string
  /** false once the teacher's profile is inactive: no access (no form, no list). */
  active: boolean
  batches: { id: string; name: string; program: string }[]
  subjects: string[]
}

export type ReportForm = {
  date: string
  batchId: string
  subject: string
  chapter: string
  topics: string
  homework: string
  observations: string
}

export const STATUS_TABS: { key: ReportStatus | ''; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'ON_TIME', label: 'Submitted' },
  { key: 'LATE', label: 'Late' },
  { key: 'FLAGGED', label: 'Flagged' },
]

export const adminReportsPath = (schoolId: string) => `/schools/${schoolId}/daily-reports`
export const TEACHER_PATH = '/teacher/daily-reports'

export function useAdminReports(schoolId: string, filters: { date: string; programId: string; batchId: string; status: ReportStatus | '' }) {
  const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][])
  return useQuery({
    queryKey: [schoolId, 'daily-reports', filters],
    queryFn: () => api<AdminDay>(`${adminReportsPath(schoolId)}?${params}`),
    placeholderData: keepPreviousData,
    enabled: !!filters.date,
  })
}

export function useReportOptions() {
  return useQuery({ queryKey: ['teacher-daily-reports', 'options'], queryFn: () => api<ReportOptions>(`${TEACHER_PATH}/options`) })
}

export function useMyReports() {
  return useQuery({ queryKey: ['teacher-daily-reports', 'mine'], queryFn: () => api<MyReport[]>(TEACHER_PATH) })
}

export function useInvalidateMyReports() {
  const client = useQueryClient()
  // The dashboard's "Pending Daily Reports" tile counts them too.
  return () => Promise.all([client.invalidateQueries({ queryKey: ['teacher-daily-reports'] }), client.invalidateQueries({ queryKey: ['teacher-dashboard'] })])
}

/** The form as the API takes it: blank optional fields are left out. */
export function toPayload(f: ReportForm) {
  return {
    date: f.date,
    batchId: f.batchId,
    subject: f.subject,
    chapter: f.chapter.trim() || null,
    topics: f.topics,
    homework: f.homework.trim() || null,
    observations: f.observations.trim() || null,
  }
}

export const emptyForm = (today: string): ReportForm => ({ date: today, batchId: '', subject: '', chapter: '', topics: '', homework: '', observations: '' })

export const formOf = (r: DailyReport): ReportForm => ({
  date: r.date,
  batchId: r.batch.id,
  subject: r.subject,
  chapter: r.chapter ?? '',
  topics: r.topics,
  homework: r.homework ?? '',
  observations: r.observations ?? '',
})

/** What the form can say before sending: the server decides, this only warns early. */
export function formProblem(f: ReportForm, today: string): string | null {
  if (!f.date) return 'Pick the date taught'
  if (f.date > today) return "You can't report a day that hasn't happened yet"
  if (!f.batchId) return 'Select a batch'
  if (!f.subject.trim()) return 'Select a subject'
  if (!f.topics.trim()) return 'Describe the topics covered'
  return null
}

/** "10:15 am" in India, whatever the browser's time zone. */
export const timeIst = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)).toLowerCase()

/** "18 Oct 2026, 10:15 am" in India. */
export const dateTimeIst = (iso: string) =>
  `${new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))}, ${timeIst(iso)}`

/** "Sunday, 18 Oct 2026" for a YYYY-MM-DD day. */
export const longDay = (isoDate: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${isoDate}T00:00:00Z`))

/** "18 Oct 2026" for a YYYY-MM-DD day. */
export const shortDay = (isoDate: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${isoDate}T00:00:00Z`))

/** "Batch 1A · General · Chapter 1" */
export const classLine = (r: Pick<DailyReport, 'batch' | 'subject' | 'chapter'>) => [r.batch.name, r.subject, r.chapter].filter(Boolean).join(' · ')
