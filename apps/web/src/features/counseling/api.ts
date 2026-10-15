import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type CounselingType = 'ACADEMIC' | 'CAREER' | 'PERSONAL' | 'DISCIPLINARY' | 'PARENT_MEETING'
export type CounselingStatus = 'SCHEDULED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED'

export const COUNSELING_TYPE_LABELS: Record<CounselingType, string> = {
  ACADEMIC: 'Academic',
  CAREER: 'Career',
  PERSONAL: 'Personal',
  DISCIPLINARY: 'Disciplinary',
  PARENT_MEETING: 'Parent Meeting',
}
export const COUNSELING_STATUS_LABELS: Record<CounselingStatus, string> = {
  SCHEDULED: 'Scheduled',
  COMPLETED: 'Completed',
  NO_SHOW: 'No-Show',
  CANCELLED: 'Cancelled',
}
export const STATUS_STYLE: Record<CounselingStatus, string> = {
  SCHEDULED: 'bg-blue-50 text-blue-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700',
  NO_SHOW: 'bg-red-50 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
}

export type Session = {
  id: string
  student: { id: string; fullName: string; rollNumber: string | null; classLevel: string | null; batch: string | null }
  counselor: { key: string | null; name: string }
  type: CounselingType
  status: CounselingStatus
  scheduledAt: string
  date: string
  time: string
  durationMinutes: number
  nextSessionDate: string | null
  notes: string | null
  actionItems: string | null
  flagged: boolean
}

export type Registry = {
  kpis: { sessionsThisWeek: number; sessionsLastWeek: number; upcoming: number; noShowsThisMonth: number; studentsFlagged: number }
  total: number
  page: number
  pageSize: number
  items: Session[]
}

export type Counselor = { id: string; name: string; kind: 'ADMIN' | 'FACULTY' }

export type RegistryFilters = { q: string; status: string; type: string; counselor: string; flagged: boolean; page: number }

const query = (f: Record<string, string | number | boolean | undefined>) => {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) if (v !== '' && v !== false && v !== undefined) params.set(k, String(v))
  const text = params.toString()
  return text ? `?${text}` : ''
}

export function useRegistry(schoolId: string, filters: RegistryFilters) {
  return useQuery({
    queryKey: [schoolId, 'counseling', filters],
    queryFn: () => api<Registry>(`/schools/${schoolId}/counseling${query(filters)}`),
    placeholderData: keepPreviousData,
  })
}

export function useCounselors(schoolId: string) {
  return useQuery({ queryKey: [schoolId, 'counseling', 'counselors'], queryFn: () => api<Counselor[]>(`/schools/${schoolId}/counseling/counselors`) })
}

export function useTeacherSessions(filters: { q?: string; type?: string; studentId?: string }, enabled = true) {
  return useQuery({
    queryKey: ['teacher-counseling', filters],
    queryFn: () => api<Session[]>(`/teacher/counseling${query(filters)}`),
    enabled,
  })
}

export function useInvalidateCounseling(schoolId?: string) {
  const client = useQueryClient()
  return () =>
    Promise.all([
      schoolId ? client.invalidateQueries({ queryKey: [schoolId, 'counseling'] }) : null,
      schoolId ? client.invalidateQueries({ queryKey: [schoolId, 'teacher-portal'] }) : null,
      client.invalidateQueries({ queryKey: ['teacher-counseling'] }),
    ])
}

/** "+12% vs last week" (or "New this week" when last week had none). */
export function weekChange(thisWeek: number, lastWeek: number) {
  if (lastWeek === 0) return thisWeek > 0 ? 'New this week' : 'None last week'
  const pct = Math.round(((thisWeek - lastWeek) / lastWeek) * 100)
  return `${pct >= 0 ? '+' : ''}${pct}% vs last week`
}

/** "10:30" -> "10:30 AM" */
export function formatTime(time: string) {
  const [h, m] = time.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}
