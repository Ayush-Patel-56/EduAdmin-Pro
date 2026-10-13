import { useEffect, useState, type ReactNode } from 'react'
import { CalendarDays, CalendarX2, ChevronDown, ChevronLeft, ChevronRight, Filter, Flag, HeartHandshake, Loader2, Pencil, Plus, RefreshCw, Search, Trash2, TriangleAlert } from 'lucide-react'
import { api } from '@/lib/api'
import { ConfirmDialog, ErrorBanner } from '@/components/ui/form'
import {
  COUNSELING_STATUS_LABELS,
  COUNSELING_TYPE_LABELS,
  formatTime,
  STATUS_STYLE,
  useCounselors,
  useInvalidateCounseling,
  useRegistry,
  weekChange,
  type CounselingStatus,
  type CounselingType,
  type RegistryFilters,
  type Session,
} from '@/features/counseling/api'
import { SessionDialog } from '@/features/counseling/SessionDialog'
import { formatDay } from '@/features/portal/format'
import { useAdminContext } from '../adminContext'

function Kpi({ label, value, note, noteClass, icon: Icon, iconClass }: { label: string; value: number | undefined; note: string; noteClass: string; icon: typeof Flag; iconClass: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <p className="text-[10px] font-bold tracking-[0.12em] text-slate-500 uppercase">{label}</p>
        <span className={`flex size-9 items-center justify-center rounded-xl ${iconClass}`}><Icon className="size-5" /></span>
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value ?? '—'}</p>
      <p className={`mt-1 text-xs ${noteClass}`}>{note}</p>
    </div>
  )
}

function Pill({ icon: Icon = Filter, children }: { icon?: typeof Filter; children: ReactNode }) {
  return (
    <label className="relative flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white pr-2 pl-2.5 text-xs font-medium text-slate-700">
      <Icon className="size-3.5 text-slate-400" />
      {children}
      <ChevronDown className="pointer-events-none size-3.5 text-slate-500" />
    </label>
  )
}
const pillSelect = 'appearance-none bg-transparent pr-1 focus:outline-none'

/** Counseling Sessions (PRD 4.13): the school's whole session registry. */
export function CounselingPage() {
  const { schoolId } = useAdminContext()
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<RegistryFilters>({ q: '', status: '', type: '', counselor: '', flagged: false, page: 1 })
  useEffect(() => {
    const timer = setTimeout(() => setFilters((f) => (f.q === search.trim() ? f : { ...f, q: search.trim(), page: 1 })), 250)
    return () => clearTimeout(timer)
  }, [search])
  const registry = useRegistry(schoolId, filters)
  const counselors = useCounselors(schoolId)
  const invalidate = useInvalidateCounseling(schoolId)
  const [dialog, setDialog] = useState<Session | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Session | null>(null)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<RegistryFilters>) => setFilters((f) => ({ ...f, ...patch, page: 1 }))
  const data = registry.data
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  async function quick(session: Session, body: { status?: CounselingStatus; flagged?: boolean }) {
    setError(null)
    try {
      await api(`/schools/${schoolId}/counseling/${session.id}/status`, { method: 'PATCH', body: JSON.stringify(body) })
      await invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the session')
    }
  }

  const k = data?.kpis
  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-[26px]">Counseling Sessions</h1>
          <p className="mt-1 text-sm text-slate-500">Track academic, career, and personal counseling activity across students</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void registry.refetch()} disabled={registry.isFetching} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60">
            <RefreshCw className={`size-4 ${registry.isFetching ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button type="button" onClick={() => setDialog('new')} className="inline-flex h-10 items-center gap-2 rounded-lg bg-ink px-4 text-sm font-semibold text-white shadow-sm hover:bg-ink-hover">
            <Plus className="size-4" /> Schedule Session
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Sessions This Week" value={k?.sessionsThisWeek} note={k ? weekChange(k.sessionsThisWeek, k.sessionsLastWeek) : ''} noteClass="text-emerald-600" icon={HeartHandshake} iconClass="bg-emerald-50 text-emerald-600" />
        <Kpi label="Upcoming Sessions" value={k?.upcoming} note="Scheduled ahead" noteClass="text-slate-500" icon={CalendarDays} iconClass="bg-blue-50 text-blue-600" />
        <Kpi label="No-Shows This Month" value={k?.noShowsThisMonth} note="Requires follow-up" noteClass="text-red-600" icon={CalendarX2} iconClass="bg-red-50 text-red-600" />
        <Kpi label="Students Flagged" value={k?.studentsFlagged} note="Need attention" noteClass="text-amber-600" icon={TriangleAlert} iconClass="bg-amber-50 text-amber-600" />
      </div>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-4 xl:flex-row xl:items-center xl:justify-between">
          <h2 className="text-base font-bold text-slate-900">Session Registry</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-slate-400" />
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search student or counselor..." aria-label="Search sessions" className="h-9 w-56 rounded-lg border border-slate-200 pr-2 pl-8 text-xs focus:outline-none" />
            </div>
            <Pill>
              <select aria-label="Status" value={filters.status} onChange={(e) => set({ status: e.target.value })} className={pillSelect}>
                <option value="">All Status</option>
                {(Object.keys(COUNSELING_STATUS_LABELS) as CounselingStatus[]).map((s) => <option key={s} value={s}>{COUNSELING_STATUS_LABELS[s]}</option>)}
              </select>
            </Pill>
            <Pill>
              <select aria-label="Type" value={filters.type} onChange={(e) => set({ type: e.target.value })} className={pillSelect}>
                <option value="">All Types</option>
                {(Object.keys(COUNSELING_TYPE_LABELS) as CounselingType[]).map((t) => <option key={t} value={t}>{COUNSELING_TYPE_LABELS[t]}</option>)}
              </select>
            </Pill>
            <Pill>
              <select aria-label="Counselor" value={filters.counselor} onChange={(e) => set({ counselor: e.target.value })} className={pillSelect}>
                <option value="">All Counselors</option>
                {counselors.data?.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.kind === 'ADMIN' ? 'Admin' : 'Faculty'})</option>)}
              </select>
            </Pill>
            <button type="button" aria-pressed={filters.flagged} onClick={() => set({ flagged: !filters.flagged })} className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold ${filters.flagged ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-700'}`}>
              <Flag className="size-3.5" /> Flagged
            </button>
          </div>
        </div>
        <ErrorBanner message={registry.error?.message ?? error} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
              <tr className="border-b border-slate-100">
                <th className="px-6 py-3.5">Student</th><th className="px-3 py-3.5">Counselor</th><th className="px-3 py-3.5">Type</th><th className="px-3 py-3.5">Date / Time</th><th className="px-3 py-3.5">Status</th><th className="px-6 py-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {registry.isPending ? (
                <tr><td colSpan={6}><Loader2 className="mx-auto my-16 size-6 animate-spin text-slate-300" aria-label="Loading" /></td></tr>
              ) : !data || data.items.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-20 text-center text-sm text-slate-400">No sessions found. Adjust filters or schedule a new session.</td></tr>
              ) : (
                data.items.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/60">
                    <td className="px-6 py-3.5">
                      <p className="flex items-center gap-1.5 font-semibold text-slate-900">{s.student.fullName}{s.flagged && <Flag className="size-3.5 fill-amber-400 text-amber-500" aria-label="Flagged" />}</p>
                      <p className="text-[11px] text-slate-500">{[s.student.classLevel && `Class ${s.student.classLevel}`, s.student.batch].filter(Boolean).join(' · ') || '—'}</p>
                    </td>
                    <td className="px-3 py-3.5 text-slate-700">{s.counselor.name}</td>
                    <td className="px-3 py-3.5 text-slate-700">{COUNSELING_TYPE_LABELS[s.type]}</td>
                    <td className="px-3 py-3.5 text-slate-700">{formatDay(s.date)}<span className="block text-[11px] text-slate-500">{formatTime(s.time)} · {s.durationMinutes} min</span></td>
                    <td className="px-3 py-3.5">
                      <select
                        aria-label={`Status of ${s.student.fullName}'s session`}
                        value={s.status}
                        onChange={(e) => void quick(s, { status: e.target.value as CounselingStatus })}
                        className={`rounded-full border-0 px-2.5 py-1 text-[11px] font-bold ${STATUS_STYLE[s.status]}`}
                      >
                        {(Object.keys(COUNSELING_STATUS_LABELS) as CounselingStatus[]).map((st) => <option key={st} value={st}>{COUNSELING_STATUS_LABELS[st]}</option>)}
                      </select>
                    </td>
                    <td className="px-6 py-3.5">
                      <div className="flex justify-end gap-1">
                        <button type="button" aria-label={s.flagged ? 'Remove flag' : 'Flag student'} onClick={() => void quick(s, { flagged: !s.flagged })} className={`rounded p-1.5 hover:bg-slate-100 ${s.flagged ? 'text-amber-500' : 'text-slate-400'}`}><Flag className="size-4" /></button>
                        <button type="button" aria-label="Edit session" onClick={() => setDialog(s)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600"><Pencil className="size-4" /></button>
                        <button type="button" aria-label="Delete session" onClick={() => setDeleting(s)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3 text-[11px] font-bold tracking-wider text-slate-500 uppercase">
          <span>{data && data.total > 0 ? `${data.total} session${data.total === 1 ? '' : 's'}` : 'No sessions'}</span>
          <div className="flex items-center gap-1 normal-case">
            <button type="button" disabled={filters.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))} className="inline-flex items-center rounded-md border border-slate-200 px-2 py-1 text-xs font-medium disabled:opacity-40"><ChevronLeft className="size-3.5" /> Prev</button>
            <span className="rounded-md bg-ink px-2.5 py-1 text-xs text-white">{filters.page}</span>
            <button type="button" disabled={filters.page >= pages} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))} className="inline-flex items-center rounded-md border border-slate-200 px-2 py-1 text-xs font-medium disabled:opacity-40">Next <ChevronRight className="size-3.5" /></button>
          </div>
        </div>
      </section>

      {dialog && (
        <SessionDialog mode="admin" schoolId={schoolId} counselors={counselors.data ?? []} session={dialog === 'new' ? undefined : dialog} onSaved={invalidate} onClose={() => setDialog(null)} />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this session?"
          message={<p>The {COUNSELING_TYPE_LABELS[deleting.type].toLowerCase()} session with {deleting.student.fullName} on {formatDay(deleting.date)} and its notes are deleted.</p>}
          confirmLabel="Delete"
          onConfirm={async () => {
            await api(`/schools/${schoolId}/counseling/${deleting.id}`, { method: 'DELETE' })
            await invalidate()
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  )
}
