import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type MeetingType = 'GENERAL' | 'MANAGEMENT' | 'PARENT_TEACHER' | 'STAFF' | 'DISCIPLINARY'
export type AgendaPriority = 'LOW' | 'MEDIUM' | 'HIGH'
export type AgendaStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED'

export const TYPE_LABELS: Record<MeetingType, string> = {
  GENERAL: 'General',
  MANAGEMENT: 'Management',
  PARENT_TEACHER: 'Parent-Teacher',
  STAFF: 'Staff',
  DISCIPLINARY: 'Disciplinary',
}
export const PRIORITY_LABELS: Record<AgendaPriority, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' }
export const STATUS_LABELS: Record<AgendaStatus, string> = { NOT_STARTED: 'Not Started', IN_PROGRESS: 'In Progress', COMPLETED: 'Completed' }
export const PRIORITY_STYLE: Record<AgendaPriority, string> = {
  LOW: 'border-slate-200 bg-slate-50 text-slate-700',
  MEDIUM: 'border-amber-200 bg-amber-50 text-amber-700',
  HIGH: 'border-red-200 bg-red-50 text-red-700',
}
export const STATUS_STYLE: Record<AgendaStatus, string> = {
  NOT_STARTED: 'border-rose-200 bg-rose-50 text-rose-700',
  IN_PROGRESS: 'border-sky-200 bg-sky-50 text-sky-700',
  COMPLETED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
}

export type MeetingSummary = { id: string; title: string; type: MeetingType; date: string; time: string | null; agendaCount: number }
/** The newest meetings that match; `total` counts them all, so the log can say when it shows only some. */
export type MeetingList = { total: number; items: MeetingSummary[] }

export type AgendaItem = {
  id: string
  title: string
  discussion: string | null
  action: string | null
  responsible: string | null
  targetDate: string | null
  communicatedTo: string | null
  communicatedBy: string | null
  priority: AgendaPriority
  status: AgendaStatus
}

export type Meeting = {
  id: string
  title: string
  type: MeetingType
  date: string
  time: string | null
  venue: string | null
  attendees: string[]
  minutesPreparedBy: string | null
  nextMeetingDate: string | null
  agendaItems: AgendaItem[]
}

export const meetingsPath = (schoolId: string) => `/schools/${schoolId}/meetings`

export function useMeetings(schoolId: string, q: string) {
  return useQuery({
    queryKey: [schoolId, 'meetings', 'list', q],
    queryFn: () => api<MeetingList>(`${meetingsPath(schoolId)}${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    placeholderData: keepPreviousData,
  })
}

export function useMeeting(schoolId: string, id: string | null) {
  return useQuery({
    queryKey: [schoolId, 'meetings', 'detail', id],
    queryFn: () => api<Meeting>(`${meetingsPath(schoolId)}/${id}`),
    enabled: !!id,
  })
}

export function useInvalidateMeetings(schoolId: string) {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: [schoolId, 'meetings'] })
}

/** "2026-10-17" -> "17/10/2026", as meeting papers are written. */
export const dmy = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : null)
