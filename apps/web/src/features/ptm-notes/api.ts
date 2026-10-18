import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type PtmNote = {
  id: string
  /** The meeting day, YYYY-MM-DD. */
  date: string
  student: { id: string; fullName: string; rollNumber: string | null }
  /** The batch as it was at the meeting (id null once that batch is deleted). */
  batch: { id: string | null; name: string }
  teacherName: string
  parentName: string | null
  parentAttended: boolean
  discussion: string
  actionItems: string | null
  followUpDate: string | null
  createdAt: string
}

export type PtmOptions = {
  /** Today in India: the form's default meeting date. */
  today: string
  /** false once the teacher's profile is inactive: they can still read their notes. */
  active: boolean
  batches: { id: string; name: string; program: string; students: { id: string; fullName: string; rollNumber: string | null }[] }[]
}

export type PtmForm = {
  batchId: string
  date: string
  studentId: string
  parentName: string
  parentAttended: boolean
  discussion: string
  actionItems: string
  followUpDate: string
}

export const PTM_PATH = '/teacher/ptm-notes'

export function usePtmOptions() {
  return useQuery({ queryKey: ['teacher-ptm', 'options'], queryFn: () => api<PtmOptions>(`${PTM_PATH}/options`) })
}

export function usePtmNotes(q: string) {
  return useQuery({
    queryKey: ['teacher-ptm', 'notes', q],
    queryFn: () => api<{ total: number; items: PtmNote[] }>(`${PTM_PATH}${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    placeholderData: keepPreviousData,
  })
}

export function useInvalidatePtm() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: ['teacher-ptm', 'notes'] })
}

export const emptyPtmForm = (today: string, batchId = ''): PtmForm => ({
  batchId,
  date: today,
  studentId: '',
  parentName: '',
  parentAttended: true,
  discussion: '',
  actionItems: '',
  followUpDate: '',
})

export const ptmFormOf = (n: PtmNote): PtmForm => ({
  batchId: n.batch.id ?? '',
  date: n.date,
  studentId: n.student.id,
  parentName: n.parentName ?? '',
  parentAttended: n.parentAttended,
  discussion: n.discussion,
  actionItems: n.actionItems ?? '',
  followUpDate: n.followUpDate ?? '',
})

/**
 * The form as the API takes it: blank optional fields are left out. A note
 * being corrected whose batch was deleted sends no batch, so it keeps the
 * batch it was logged under.
 */
export const toPtmPayload = (f: PtmForm) => ({
  batchId: f.batchId || null,
  date: f.date,
  studentId: f.studentId,
  parentName: f.parentName.trim() || null,
  parentAttended: f.parentAttended,
  discussion: f.discussion,
  actionItems: f.actionItems.trim() || null,
  followUpDate: f.followUpDate || null,
})

/**
 * What the form can say before sending: the server decides, this only warns
 * early. `kept` is the note being corrected: with its own student, the batch
 * can stay as recorded (it may have been deleted since).
 */
export function ptmProblem(f: PtmForm, today: string, kept?: { studentId: string }): string | null {
  if (!f.batchId && !(kept && f.studentId === kept.studentId)) return 'Select a batch'
  if (!f.date) return 'Pick the meeting date'
  if (f.date > today) return "You can't log a meeting that hasn't happened yet"
  if (!f.studentId) return 'Select a student'
  if (!f.discussion.trim()) return 'Write the discussion notes'
  if (f.followUpDate && f.followUpDate < f.date) return "The follow-up can't be before the meeting"
  return null
}

/** "18 Oct 2026" for a YYYY-MM-DD day. */
export const shortDay = (isoDate: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${isoDate}T00:00:00Z`))

/** "Ayush Patel (RN-12)" or "Ayush Patel (N/A)", as the student picker shows them. */
export const studentLabel = (s: { fullName: string; rollNumber: string | null }) => `${s.fullName} (${s.rollNumber || 'N/A'})`
