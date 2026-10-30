import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { todayIst } from '@/lib/dates'
import type { ImportPreview } from '@/features/academic/api'

export type FeedbackDirection = 'TEACHER_TO_MANAGEMENT' | 'MANAGEMENT_TO_TEACHER' | 'STUDENT_TO_TEACHER'
export type FeedbackCategory = 'ACADEMICS' | 'DISCIPLINE' | 'PUNCTUALITY' | 'TEACHING_QUALITY' | 'ADMINISTRATION' | 'GENERAL'
export type FeedbackStatus = 'SUBMITTED' | 'REVIEWED' | 'ACTIONED' | 'DISMISSED'

export type Feedback = {
  id: string
  direction: FeedbackDirection
  sender: { name: string; facultyId: string | null }
  /** Management -> Teacher: every teacher, or one. Student -> Teacher: the teacher it's about. */
  target: { all: boolean; name: string } | null
  /** Student -> Teacher only (admins): who sent it, and through which batch's link. */
  student: { name: string; batchName: string } | null
  rating: number
  content: string
  subject: string | null
  category: FeedbackCategory
  /** The day it was given, YYYY-MM-DD. */
  date: string
  status: FeedbackStatus
  statusChangedAt: string | null
  statusChangedBy: string | null
  source: 'APP' | 'IMPORT'
  createdAt: string
}

export type Keyword = { phrase: string; mentions: number; averageRating: number }

export type AdminFeedback = {
  kpis: { thisMonth: number; averageRating: number | null; pending: number; actioned: number }
  counts: { pending: number; closed: number }
  ratingDistribution: { stars: number; count: number }[]
  keywords: Keyword[]
  total: number
  items: Feedback[]
}

export type AdminFilters = { view: 'pending' | 'closed'; status: '' | 'ACTIONED'; direction: '' | FeedbackDirection; q: string }

export const CATEGORIES: FeedbackCategory[] = ['ACADEMICS', 'DISCIPLINE', 'PUNCTUALITY', 'TEACHING_QUALITY', 'ADMINISTRATION', 'GENERAL']
export const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  ACADEMICS: 'Academics',
  DISCIPLINE: 'Discipline',
  PUNCTUALITY: 'Punctuality',
  TEACHING_QUALITY: 'Teaching Quality',
  ADMINISTRATION: 'Administration',
  GENERAL: 'General',
}
export const DIRECTION_LABELS: Record<FeedbackDirection, string> = {
  TEACHER_TO_MANAGEMENT: 'Teacher -> Management',
  MANAGEMENT_TO_TEACHER: 'Management -> Teacher',
  STUDENT_TO_TEACHER: 'Student -> Teacher',
}
export const STATUS_LABELS: Record<FeedbackStatus, string> = { SUBMITTED: 'Submitted', REVIEWED: 'Reviewed', ACTIONED: 'Actioned', DISMISSED: 'Dismissed' }
export const STATUS_HINTS: Record<FeedbackStatus, string> = {
  SUBMITTED: 'Newly received, awaiting initial review',
  REVIEWED: 'Investigated by school administration',
  ACTIONED: 'Resolution completed and updated',
  DISMISSED: 'Archived or marked inactive',
}

export const feedbackPath = (schoolId: string) => `/schools/${schoolId}/feedback`
export const TEACHER_FEEDBACK_PATH = '/teacher/feedback'

export function useAdminFeedback(schoolId: string, f: AdminFilters) {
  const params = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][])
  return useQuery({
    queryKey: [schoolId, 'feedback', f],
    queryFn: () => api<AdminFeedback>(`${feedbackPath(schoolId)}?${params}`),
    placeholderData: keepPreviousData,
  })
}

export function useRecipients(schoolId: string, enabled: boolean) {
  return useQuery({
    queryKey: [schoolId, 'feedback', 'recipients'],
    queryFn: () => api<{ id: string; name: string; subject: string }[]>(`${feedbackPath(schoolId)}/recipients`),
    enabled,
  })
}

export function useInvalidateFeedback(schoolId: string) {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: [schoolId, 'feedback'] })
}

/** Student feedback as a teacher sees it: never who sent it. */
export type StudentFeedbackForTeacher = { id: string; rating: number; content: string; batchName: string | null; date: string; createdAt: string; status: FeedbackStatus }

export function useTeacherFeedback() {
  return useQuery({
    queryKey: ['teacher-feedback'],
    queryFn: () => api<{ received: Feedback[]; sent: Feedback[]; fromStudents: StudentFeedbackForTeacher[] }>(TEACHER_FEEDBACK_PATH),
  })
}

export function useInvalidateTeacherFeedback() {
  const client = useQueryClient()
  // The dashboard's "Feedback from Admin" reads the same entries.
  return () => Promise.all([client.invalidateQueries({ queryKey: ['teacher-feedback'] }), client.invalidateQueries({ queryKey: ['teacher-dashboard'] })])
}

/** A batch and its student feedback link (`token: null` until one is created). */
export type FeedbackLinkRow = { batchId: string; batchName: string; programName: string; token: string | null; active: boolean }

const linksPath = (schoolId: string) => `${feedbackPath(schoolId)}/links`

export function useFeedbackLinks(schoolId: string) {
  return useQuery({ queryKey: [schoolId, 'feedback', 'links'], queryFn: () => api<FeedbackLinkRow[]>(linksPath(schoolId)) })
}

export const createLink = (schoolId: string, batchId: string) =>
  api<FeedbackLinkRow>(linksPath(schoolId), { method: 'POST', body: JSON.stringify({ batchId }) })
export const setLinkActive = (schoolId: string, batchId: string, active: boolean) =>
  api<FeedbackLinkRow>(`${linksPath(schoolId)}/${batchId}`, { method: 'PATCH', body: JSON.stringify({ active }) })
export const regenerateLink = (schoolId: string, batchId: string) =>
  api<FeedbackLinkRow>(`${linksPath(schoolId)}/${batchId}/regenerate`, { method: 'POST' })

/** The page students open. Built here from the site's own address; the API only knows the token. */
export const feedbackLinkUrl = (token: string, origin = window.location.origin) => `${origin}/feedback/${token}`

/** The student form behind a link: the batch's students (names only) and its teachers. */
export type PublicFeedbackForm = {
  schoolName: string
  batchName: string
  cooldownMinutes: number
  students: { id: string; name: string }[]
  teachers: { id: string; name: string; subjects: string[] }[]
}
export type StudentFeedbackBody = { studentId: string; facultyId: string; rating: number; comment: string }

const publicPath = (token: string) => `/public/feedback/${encodeURIComponent(token)}`

/** No login; a switched-off or replaced link is a 404, which isn't worth retrying. */
export function usePublicFeedbackForm(token: string) {
  return useQuery({ queryKey: ['public-feedback', token], queryFn: () => api<PublicFeedbackForm>(publicPath(token)), retry: false, refetchOnWindowFocus: false })
}

export const submitStudentFeedback = (token: string, body: StudentFeedbackBody) =>
  api<{ ok: true; nextAllowedAt: string }>(publicPath(token), { method: 'POST', body: JSON.stringify(body) })

/** A share of the total, rounded, for the rating chart (0 when there is nothing yet). */
export const percent = (count: number, total: number) => (total ? Math.round((count / total) * 100) : 0)

/** Green for topics people rate well, red for ones they rate poorly. */
export function keywordTone(k: Keyword): 'positive' | 'negative' | 'neutral' {
  if (k.averageRating >= 4) return 'positive'
  if (k.averageRating <= 2.5) return 'negative'
  return 'neutral'
}

/** "Today", "Yesterday" or "18 Oct 2026" for a YYYY-MM-DD day (India). */
export function dayLabel(isoDate: string, today = todayIst()): string {
  if (isoDate === today) return 'Today'
  const yesterday = new Date(`${today}T00:00:00Z`)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  if (isoDate === yesterday.toISOString().slice(0, 10)) return 'Yesterday'
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${isoDate}T00:00:00Z`))
}

/** Rows per request when importing a sheet: well under the API's body limit even with 2000-character comments. */
export const IMPORT_CHUNK = 200

type ImportChunk = { rows: Record<string, string>[]; dryRun: boolean; firstRow: number; priorKeys: { key: string; row: number }[] }

/**
 * Sends a sheet in chunks, one after another, and joins the answers into one
 * preview. Each chunk says which sheet row it starts at and carries the keys
 * of the rows before it, so row numbers and "appears twice in this file" are
 * exactly as for one request. If a chunk fails while applying, the error says
 * how many rows were already imported (uploading the sheet again skips them).
 */
export async function importInChunks(send: (chunk: ImportChunk) => Promise<ImportPreview>, records: Record<string, string>[], dryRun: boolean, size = IMPORT_CHUNK): Promise<ImportPreview> {
  const out: ImportPreview = { applied: !dryRun, created: 0, updated: 0, skipped: 0, rows: [] }
  const priorKeys: { key: string; row: number }[] = []
  for (let start = 0; start < records.length; start += size) {
    let part: ImportPreview
    try {
      part = await send({ rows: records.slice(start, start + size), dryRun, firstRow: start + 2, priorKeys })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed'
      throw new Error(!dryRun && out.created ? `${message} (${out.created} row${out.created === 1 ? ' was' : 's were'} imported before this; uploading the sheet again skips them.)` : message)
    }
    out.created += part.created
    out.updated += part.updated
    out.skipped += part.skipped
    out.rows.push(...part.rows)
    for (const r of part.rows) if (r.key) priorKeys.push({ key: r.key, row: r.row })
  }
  return out
}
