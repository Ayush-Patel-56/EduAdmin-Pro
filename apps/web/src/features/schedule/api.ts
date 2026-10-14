import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { dashboardQueryKey } from '@/features/admin/useDashboard'
import { teacherDashboardQueryKey } from '@/features/teacher/useTeacherDashboard'

export type SpecialClassType = 'EXTRA' | 'DOUBT' | 'REVISION' | 'MAKEUP' | 'ORIENTATION'

export const SPECIAL_TYPE_LABELS: Record<SpecialClassType, string> = {
  EXTRA: 'Extra',
  DOUBT: 'Doubt',
  REVISION: 'Revision',
  MAKEUP: 'Makeup',
  ORIENTATION: 'Orientation',
}
export const SPECIAL_TYPE_STYLE: Record<SpecialClassType, string> = {
  EXTRA: 'bg-emerald-50 text-emerald-700',
  DOUBT: 'bg-amber-50 text-amber-700',
  REVISION: 'bg-blue-50 text-blue-700',
  MAKEUP: 'bg-purple-50 text-purple-700',
  ORIENTATION: 'bg-slate-100 text-slate-700',
}

/** Monday first, as a school week reads; values are 0 (Sunday) to 6. */
export const WEEK_DAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
]

type Person = { id: string; name: string; email: string | null }

export type Slot = {
  id: string
  subject: string
  dayOfWeek: number
  day: string
  startTime: string
  endTime: string
  time: string
  room: string | null
  effectiveFrom: string
  effectiveTo: string | null
  active: boolean
  faculty: Person
  batch: { id: string; name: string }
  program: { id: string; name: string }
  hasAttendance: boolean
}

export type SpecialClass = {
  id: string
  title: string
  type: SpecialClassType
  subject: string | null
  date: string
  startTime: string
  endTime: string
  time: string
  room: string | null
  notes: string | null
  faculty: Person | null
  batch: { id: string; name: string }
  program: { id: string; name: string }
  hasAttendance: boolean
  /** Teacher view: whether they take it (false: no teacher set yet). */
  mine?: boolean
}

export type FacultyOption = { id: string; name: string; email: string | null; subject: string | null; batchIds: string[] }

export type ScheduleFilters = { programId: string; batchId: string }

const query = (f: Record<string, string | boolean | undefined>) => {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) if (v !== '' && v !== false && v !== undefined) params.set(k, String(v))
  const text = params.toString()
  return text ? `?${text}` : ''
}

export function useAdminSlots(schoolId: string, filters: ScheduleFilters) {
  return useQuery({
    queryKey: [schoolId, 'schedule', 'slots', filters],
    queryFn: () => api<Slot[]>(`/schools/${schoolId}/schedule/slots${query(filters)}`),
  })
}

export function useAdminSpecialClasses(schoolId: string, filters: ScheduleFilters & { past: boolean }) {
  return useQuery({
    queryKey: [schoolId, 'schedule', 'special', filters],
    queryFn: () => api<SpecialClass[]>(`/schools/${schoolId}/schedule/special-classes${query(filters)}`),
  })
}

export function useScheduleFaculty(schoolId: string) {
  return useQuery({
    queryKey: [schoolId, 'schedule', 'faculty'],
    queryFn: () => api<FacultyOption[]>(`/schools/${schoolId}/schedule/faculty`),
  })
}

export function useTeacherSchedule() {
  return useQuery({
    queryKey: ['teacher-schedule'],
    queryFn: () => api<{ slots: Slot[]; specialClasses: SpecialClass[] }>('/teacher/schedule'),
  })
}

/** After any schedule change: both portals' schedules, today's classes on the dashboards, and the attendance class picker. */
export function useInvalidateSchedule(schoolId?: string) {
  const client = useQueryClient()
  return () =>
    Promise.all([
      schoolId ? client.invalidateQueries({ queryKey: [schoolId, 'schedule'] }) : null,
      schoolId ? client.invalidateQueries({ queryKey: dashboardQueryKey(schoolId) }) : null,
      client.invalidateQueries({ queryKey: ['teacher-schedule'] }),
      client.invalidateQueries({ queryKey: teacherDashboardQueryKey }),
      client.invalidateQueries({ queryKey: ['teacher-attendance'] }),
    ])
}

// The forms pick times as "09:00" + AM/PM; the API takes 24-hour "HH:MM".

export type Clock = { time: string; meridiem: 'AM' | 'PM' }

/** "13:30" -> { time: "01:30", meridiem: "PM" } */
export function toClock(hhmm: string): Clock {
  const [h, m] = hhmm.split(':').map(Number)
  return { time: `${String(h % 12 || 12).padStart(2, '0')}:${String(m).padStart(2, '0')}`, meridiem: h < 12 ? 'AM' : 'PM' }
}

/** { "01:30", "PM" } -> "13:30"; null when the time isn't like 9:30 or 09:30 (1 to 12). */
export function fromClock({ time, meridiem }: Clock): string | null {
  const match = /^(0?[1-9]|1[0-2]):([0-5]\d)$/.exec(time.trim())
  if (!match) return null
  const h = (Number(match[1]) % 12) + (meridiem === 'PM' ? 12 : 0)
  return `${String(h).padStart(2, '0')}:${match[2]}`
}
