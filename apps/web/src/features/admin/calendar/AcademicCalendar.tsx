import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react'
import { todayIst } from '@/lib/dates'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner } from '@/components/ui/form'
import { ALL } from '@/features/academic/filters'
import {
  addDays,
  addMonths,
  firstOfMonth,
  lastOfMonth,
  longDate,
  monthTitle,
  scopeLabel,
  span,
  toDate,
  TYPE_CHIP,
  TYPE_DOT,
  TYPE_LABELS,
  useInvalidateCalendar,
  useOccurrences,
  useUpcoming,
  weekdayShort,
  weekStart,
  type EventType,
  type Occurrence,
} from '@/features/calendar/api'
import { useAdminContext } from '../adminContext'
import { EventDialog } from './EventDialog'

type View = 'month' | 'week' | 'list'
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MAX_CHIPS = 3

/** Occurrences covering a day (a multi-day event covers every day it spans). */
const on = (list: Occurrence[], day: string) => list.filter((o) => o.date <= day && o.endsOn >= day)

/** Academic Calendar (PRD 4.15): month, week and list views of the school's events. */
export function AcademicCalendar() {
  const { schoolId, structure, filters } = useAdminContext()
  const filter = { programId: filters.programId === ALL ? '' : filters.programId, batchId: filters.batchId === ALL ? '' : filters.batchId }
  const today = todayIst()
  const [view, setView] = useState<View>('month')
  const [anchor, setAnchor] = useState(today)
  const [dialog, setDialog] = useState<{ kind: 'event'; event?: Occurrence; date?: string } | { kind: 'day'; day: string } | { kind: 'all' } | null>(null)
  const invalidate = useInvalidateCalendar(schoolId)

  // What each view shows: a 6-week month grid, one week, or one month as a list.
  const range = useMemo(() => {
    if (view === 'week') {
      const from = weekStart(anchor)
      return { from, to: addDays(from, 6) }
    }
    if (view === 'list') return { from: firstOfMonth(anchor), to: lastOfMonth(anchor) }
    const from = weekStart(firstOfMonth(anchor))
    return { from, to: addDays(from, 41) }
  }, [view, anchor])
  const events = useOccurrences(schoolId, range.from, range.to, filter)
  const upcoming = useUpcoming(schoolId, 5, filter)
  const list = events.data ?? []

  const step = (n: number) => setAnchor((a) => (view === 'week' ? addDays(a, 7 * n) : addMonths(a, n)))
  const title =
    view === 'week'
      ? (() => {
          const a = monthTitle(range.from)
          const b = monthTitle(range.to)
          return a === b ? a : `${a.split(' ')[0]} – ${b}`
        })()
      : monthTitle(anchor)

  return (
    <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px] 2xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-900 sm:text-[26px]">Academic Calendar</h1>
            <p className="mt-1 text-sm text-slate-500">Manage holidays, exam dates, and institutional events.</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <div role="tablist" aria-label="Calendar view" className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
              {(['month', 'week', 'list'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={`rounded-lg px-4 py-1.5 text-sm font-semibold capitalize transition ${view === v ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  {v}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setDialog({ kind: 'event' })} className="inline-flex h-10 items-center gap-2 rounded-xl bg-ink px-4 text-sm font-semibold whitespace-nowrap text-white shadow-sm hover:bg-ink-hover">
              <Plus className="size-4" /> Add Event
            </button>
          </div>
        </div>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="flex min-w-0 items-center gap-3">
              <button type="button" onClick={() => step(-1)} aria-label={view === 'week' ? 'Previous week' : 'Previous month'} className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"><ChevronLeft className="size-4" /></button>
              <h2 className="min-w-0 truncate text-lg font-bold text-slate-900 tabular-nums sm:min-w-44 sm:text-xl">{title}</h2>
              <button type="button" onClick={() => step(1)} aria-label={view === 'week' ? 'Next week' : 'Next month'} className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"><ChevronRight className="size-4" /></button>
              {events.isFetching && <Loader2 className="size-4 shrink-0 animate-spin text-slate-300" aria-label="Loading" />}
            </div>
            <button type="button" onClick={() => setAnchor(today)} className="h-9 shrink-0 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">Today</button>
          </div>
          {events.error && <div className="mt-4"><ErrorBanner message={events.error.message} /></div>}

          {view === 'month' && (
            <MonthGrid from={range.from} month={anchor.slice(0, 7)} today={today} list={list} onDay={(day) => setDialog({ kind: 'event', date: day })} onEvent={(event) => setDialog({ kind: 'event', event })} onMore={(day) => setDialog({ kind: 'day', day })} />
          )}
          {view === 'week' && <WeekRows from={range.from} today={today} list={list} onEvent={(event) => setDialog({ kind: 'event', event })} />}
          {view === 'list' && <MonthList list={list} onEvent={(event) => setDialog({ kind: 'event', event })} />}

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 pt-4 text-xs text-slate-600">
            <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">Legend:</span>
            {(Object.keys(TYPE_LABELS) as EventType[]).map((t) => (
              <span key={t} className="flex items-center gap-1.5"><span className={`size-2.5 rounded-full ${TYPE_DOT[t]}`} /> {TYPE_LABELS[t]}</span>
            ))}
          </div>
        </section>
      </div>

      <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <h2 className="text-lg font-bold text-slate-900">Upcoming Events</h2>
          <button type="button" onClick={() => setDialog({ kind: 'all' })} className="text-xs font-semibold text-blue-600 hover:underline">View All</button>
        </div>
        {upcoming.error ? (
          <div className="mt-4"><ErrorBanner message={upcoming.error.message} /></div>
        ) : upcoming.isPending ? (
          <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-slate-300" aria-label="Loading" /></div>
        ) : upcoming.data!.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-400 italic">No upcoming events.</p>
        ) : (
          <EventList list={upcoming.data!} onEvent={(event) => setDialog({ kind: 'event', event })} compact />
        )}
      </aside>

      {dialog?.kind === 'event' && <EventDialog schoolId={schoolId} structure={structure} event={dialog.event} date={dialog.date} onSaved={invalidate} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'day' && (
        <Dialog title={longDate(dialog.day)} onClose={() => setDialog(null)} widthClass="max-w-md">
          <div className="px-6 py-5">
            <EventList list={on(list, dialog.day)} onEvent={(event) => setDialog({ kind: 'event', event })} />
          </div>
        </Dialog>
      )}
      {dialog?.kind === 'all' && <AllUpcoming schoolId={schoolId} filter={filter} onEvent={(event) => setDialog({ kind: 'event', event })} onClose={() => setDialog(null)} />}
    </div>
  )
}

function Chip({ o, onClick }: { o: Occurrence; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={`${o.title} · ${TYPE_LABELS[o.type]} · ${span(o)}`} className={`block w-full truncate rounded-md border px-1.5 py-0.5 text-left text-[11px] leading-4 font-semibold ${TYPE_CHIP[o.type]}`}>
      {o.title}
    </button>
  )
}

function MonthGrid({ from, month, today, list, onDay, onEvent, onMore }: { from: string; month: string; today: string; list: Occurrence[]; onDay: (day: string) => void; onEvent: (o: Occurrence) => void; onMore: (day: string) => void }) {
  const days = Array.from({ length: 42 }, (_, i) => addDays(from, i))
  return (
    // Scrolls sideways on a narrow window instead of squeezing the columns.
    <div className="mt-4 overflow-x-auto">
      <div className="min-w-[560px]">
        <div className="grid grid-cols-7 border-b border-slate-100">
          {WEEKDAYS.map((d) => <div key={d} className="py-3 text-center text-xs font-bold tracking-wider text-slate-500 uppercase">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 border-l border-slate-100">
          {days.map((day) => {
            const inMonth = day.startsWith(month)
            const items = on(list, day)
            const shown = items.slice(0, items.length > MAX_CHIPS ? MAX_CHIPS - 1 : MAX_CHIPS)
            return (
              <div key={day} className={`group relative min-h-[104px] min-w-0 border-r border-b border-slate-100 p-1.5 sm:p-2 ${inMonth ? 'bg-white' : 'bg-slate-50/60'}`}>
                <div className="flex items-center justify-between">
                  <span className={`flex size-7 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${day === today ? 'bg-blue-600 text-white' : inMonth ? 'text-slate-800' : 'text-slate-300'}`}>
                    {toDate(day).getUTCDate()}
                  </span>
                  <button type="button" onClick={() => onDay(day)} aria-label={`Add an event on ${longDate(day)}`} className="flex size-6 items-center justify-center rounded text-slate-300 opacity-0 transition group-hover:opacity-100 hover:bg-slate-100 hover:text-slate-600 focus:opacity-100">
                    <Plus className="size-3.5" />
                  </button>
                </div>
                <div className="mt-1 space-y-1">
                  {shown.map((o) => <Chip key={o.key} o={o} onClick={() => onEvent(o)} />)}
                  {items.length > shown.length && (
                    <button type="button" onClick={() => onMore(day)} className="w-full text-left text-[11px] font-semibold text-slate-500 hover:text-slate-800">
                      +{items.length - shown.length} more
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function WeekRows({ from, today, list, onEvent }: { from: string; today: string; list: Occurrence[]; onEvent: (o: Occurrence) => void }) {
  return (
    <ul className="mt-2 divide-y divide-slate-100">
      {Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((day) => {
        const items = on(list, day)
        return (
          <li key={day} className="flex gap-6 py-4">
            <div className="w-16 shrink-0">
              <p className="text-xs font-bold tracking-wider text-slate-500">{weekdayShort(day)}</p>
              <p className={`text-xl font-bold tabular-nums ${day === today ? 'text-blue-600' : 'text-slate-900'}`}>{toDate(day).getUTCDate()}</p>
            </div>
            <div className="min-w-0 flex-1 space-y-2 pt-1">
              {items.length === 0 ? (
                <p className="text-xs text-slate-400 italic">No events scheduled.</p>
              ) : (
                items.map((o) => (
                  <button key={o.key} type="button" onClick={() => onEvent(o)} className={`flex w-full min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ${TYPE_CHIP[o.type]}`}>
                    <span className="truncate font-semibold">{o.title}</span>
                    <span className="ml-auto shrink-0 text-[11px] font-medium opacity-80">{TYPE_LABELS[o.type]}{o.date !== o.endsOn ? ` · ${span(o)}` : ''}</span>
                  </button>
                ))
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function MonthList({ list, onEvent }: { list: Occurrence[]; onEvent: (o: Occurrence) => void }) {
  if (list.length === 0) return <p className="py-24 text-center text-sm text-slate-400 italic">No events scheduled for this month.</p>
  return <div className="mt-4"><EventList list={list} onEvent={onEvent} /></div>
}

/** Occurrences as a list: date, title, type and who it's for. */
function EventList({ list, onEvent, compact }: { list: Occurrence[]; onEvent: (o: Occurrence) => void; compact?: boolean }) {
  if (list.length === 0) return <p className="py-6 text-center text-sm text-slate-400 italic">No events.</p>
  return (
    <ul className={compact ? 'mt-4 space-y-3' : 'divide-y divide-slate-100'}>
      {list.map((o) => (
        <li key={o.key}>
          <button type="button" onClick={() => onEvent(o)} className={`flex w-full min-w-0 items-start gap-3 text-left ${compact ? 'rounded-xl border border-slate-100 p-3 hover:bg-slate-50' : 'py-3 hover:bg-slate-50'}`}>
            <span className="w-14 shrink-0 text-center">
              <span className="block text-[10px] font-bold tracking-wider text-slate-500 uppercase">{weekdayShort(o.date)}</span>
              <span className="block text-lg leading-6 font-bold text-slate-900 tabular-nums">{toDate(o.date).getUTCDate()}</span>
              <span className="block text-[10px] text-slate-500">{monthTitle(o.date).split(' ')[0].slice(0, 3)}</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-2">
                <span className={`size-2 shrink-0 rounded-full ${TYPE_DOT[o.type]}`} />
                <span className="truncate text-sm font-semibold text-slate-900">{o.title}</span>
              </span>
              <span className="mt-0.5 block truncate text-xs text-slate-500">{[TYPE_LABELS[o.type], span(o), scopeLabel(o)].join(' · ')}</span>
              {!compact && o.description && <span className="mt-1 line-clamp-2 block text-xs text-slate-500">{o.description}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function AllUpcoming({ schoolId, filter, onEvent, onClose }: { schoolId: string; filter: { programId: string; batchId: string }; onEvent: (o: Occurrence) => void; onClose: () => void }) {
  const all = useUpcoming(schoolId, 200, filter)
  return (
    <Dialog title="Upcoming Events" description="The next 12 months" onClose={onClose} widthClass="max-w-lg">
      <div className="min-h-0 overflow-y-auto px-6 py-4">
        {all.error ? <ErrorBanner message={all.error.message} /> : all.isPending ? (
          <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-slate-300" aria-label="Loading" /></div>
        ) : (
          <EventList list={all.data!} onEvent={onEvent} />
        )}
      </div>
    </Dialog>
  )
}
