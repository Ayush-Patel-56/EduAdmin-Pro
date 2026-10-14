import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { SpecialClassType } from '@/features/schedule/api'

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED'
export const STATUSES: AttendanceStatus[] = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']
export const STATUS_LABELS: Record<AttendanceStatus, string> = { PRESENT: 'Present', ABSENT: 'Absent', LATE: 'Late', EXCUSED: 'Excused' }

export type Counts = Record<AttendanceStatus, number>

/** One class on the picker (a weekly slot or a special class on that date). */
export type DayClass = {
  key: string
  kind: 'SLOT' | 'SPECIAL'
  id: string
  title: string
  subject: string | null
  type: SpecialClassType | null
  batch: { id: string; name: string; program: string }
  teacher: { id: string; name: string } | null
  startMinute: number
  endMinute: number
  time: string
  room: string | null
  attendance: { submittedAt: string; counts: Counts } | null
}

export type Sheet = {
  date: string
  class: Omit<DayClass, 'attendance'>
  canSubmit: boolean
  submittedAt: string | null
  students: { id: string; fullName: string; rollNumber: string | null; photoUrl: string | null; status: AttendanceStatus | null; note: string | null }[]
}

export function useTeacherClasses(date: string) {
  return useQuery({
    queryKey: ['teacher-attendance', 'classes', date],
    queryFn: () => api<DayClass[]>(`/teacher/attendance/classes?date=${date}`),
    enabled: !!date,
  })
}

export function useSheet(date: string, classKey: string) {
  return useQuery({
    queryKey: ['teacher-attendance', 'sheet', date, classKey],
    queryFn: () => api<Sheet>(`/teacher/attendance/sheet?date=${date}&class=${encodeURIComponent(classKey)}`),
    enabled: !!date && !!classKey,
  })
}

export type Overview = {
  range: { from: string; to: string; days: number }
  kpis: { rate: number | null; change: number | null; batchesBelow75: number; perfectAttendance: number }
  heatmap: {
    dates: string[]
    batches: {
      id: string
      name: string
      program: string
      rate: number | null
      declining: boolean
      cells: { date: string; present: number; absent: number; rate: number | null }[]
    }[]
  }
  attention: { id: string; name: string; program: string; rate: number | null; declining: boolean }[]
  students: {
    id: string
    fullName: string
    rollNumber: string | null
    batch: string | null
    presentDays: number
    absentDays: number
    rate: number | null
    lastAbsent: string | null
  }[]
}

export function useOverview(schoolId: string, filters: { days: number; programId: string; batchId: string }) {
  const params = new URLSearchParams({ days: String(filters.days) })
  if (filters.programId) params.set('programId', filters.programId)
  if (filters.batchId) params.set('batchId', filters.batchId)
  return useQuery({
    queryKey: [schoolId, 'attendance', 'overview', filters],
    queryFn: () => api<Overview>(`/schools/${schoolId}/attendance/overview?${params.toString()}`),
    placeholderData: keepPreviousData,
  })
}

/** The heatmap legend: <70, 70–80, 80–90, 90–95, ≥95. */
export function rateColor(rate: number | null) {
  if (rate === null) return 'bg-slate-100'
  if (rate < 70) return 'bg-rose-500'
  if (rate < 80) return 'bg-orange-400'
  if (rate < 90) return 'bg-amber-300'
  if (rate < 95) return 'bg-emerald-400'
  return 'bg-emerald-600'
}
