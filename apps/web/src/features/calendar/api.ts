import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type EventType = 'HOLIDAY' | 'EXAM' | 'EVENT' | 'PARENT_MEETING'
export type EventRepeat = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY'
export type EventScope = 'SCHOOL' | 'PROGRAM' | 'BATCH'

export const TYPE_LABELS: Record<EventType, string> = { HOLIDAY: 'Holiday', EXAM: 'Exam/Test', EVENT: 'Event', PARENT_MEETING: 'Parent Meeting' }
export const REPEAT_LABELS: Record<EventRepeat, string> = { NONE: 'None', DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly' }
/** Dot and chip colours, matching the legend. */
export const TYPE_DOT: Record<EventType, string> = { HOLIDAY: 'bg-rose-500', EXAM: 'bg-emerald-500', EVENT: 'bg-slate-400', PARENT_MEETING: 'bg-amber-500' }
export const TYPE_CHIP: Record<EventType, string> = {
  HOLIDAY: 'border-rose-200 bg-rose-50 text-rose-700',
  EXAM: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  EVENT: 'border-slate-200 bg-slate-100 text-slate-700',
  PARENT_MEETING: 'border-amber-200 bg-amber-50 text-amber-800',
}

/** One occurrence of an event (a repeating event has one per repeat). */
export type Occurrence = {
  key: string
  id: string
  title: string
  type: EventType
  description: string | null
  scope: EventScope
  program: { id: string; name: string } | null
  batch: { id: string; name: string } | null
  startDate: string
  endDate: string
  repeat: EventRepeat
  repeatUntil: string | null
  /** This occurrence's first and last day. */
  date: string
  endsOn: string
}

type ScopeFilter = { programId: string; batchId: string }
const scopeParams = (f: ScopeFilter) => `${f.programId ? `&programId=${f.programId}` : ''}${f.batchId ? `&batchId=${f.batchId}` : ''}`

export function useOccurrences(schoolId: string, from: string, to: string, filter: ScopeFilter) {
  return useQuery({
    queryKey: [schoolId, 'calendar', 'events', from, to, filter],
    queryFn: () => api<Occurrence[]>(`/schools/${schoolId}/calendar/events?from=${from}&to=${to}${scopeParams(filter)}`),
    placeholderData: keepPreviousData,
  })
}

export function useUpcoming(schoolId: string, limit: number, filter: ScopeFilter, enabled = true) {
  return useQuery({
    queryKey: [schoolId, 'calendar', 'upcoming', limit, filter],
    queryFn: () => api<Occurrence[]>(`/schools/${schoolId}/calendar/upcoming?limit=${limit}${scopeParams(filter)}`),
    enabled,
  })
}

export function useInvalidateCalendar(schoolId: string) {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: [schoolId, 'calendar'] })
}

// Calendar dates as "YYYY-MM-DD", worked out in UTC so the browser's time zone
// (and Mac vs Windows locale settings) can never move a day.

export const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`)
export const toIso = (d: Date) => d.toISOString().slice(0, 10)
export const addDays = (iso: string, n: number) => toIso(new Date(toDate(iso).getTime() + n * 86_400_000))
export const firstOfMonth = (iso: string) => `${iso.slice(0, 7)}-01`
export function addMonths(iso: string, n: number) {
  const d = toDate(firstOfMonth(iso))
  return toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)))
}
export const lastOfMonth = (iso: string) => addDays(addMonths(iso, 1), -1)
/** Monday of the week the date is in. */
export const weekStart = (iso: string) => addDays(iso, -((toDate(iso).getUTCDay() + 6) % 7))

const fmt = (iso: string, options: Intl.DateTimeFormatOptions) => toDate(iso).toLocaleDateString('en-IN', { ...options, timeZone: 'UTC' })
export const monthTitle = (iso: string) => fmt(iso, { month: 'long', year: 'numeric' })
export const weekdayShort = (iso: string) => fmt(iso, { weekday: 'short' }).toUpperCase()
export const dayMonth = (iso: string) => fmt(iso, { day: 'numeric', month: 'short' })
export const longDate = (iso: string) => fmt(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

/** "8 Nov" or "8 Nov – 10 Nov" for an occurrence. */
export const span = (o: Pick<Occurrence, 'date' | 'endsOn'>) => (o.date === o.endsOn ? dayMonth(o.date) : `${dayMonth(o.date)} – ${dayMonth(o.endsOn)}`)

export const scopeLabel = (o: Pick<Occurrence, 'scope' | 'program' | 'batch'>) =>
  o.scope === 'BATCH' ? `Batch: ${o.batch?.name}` : o.scope === 'PROGRAM' ? `Program: ${o.program?.name}` : 'School-wide'
