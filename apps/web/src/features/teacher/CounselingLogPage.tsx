import { useEffect, useState } from 'react'
import { Filter, HeartHandshake, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { ConfirmDialog, ErrorBanner } from '@/components/ui/form'
import {
  COUNSELING_STATUS_LABELS,
  COUNSELING_TYPE_LABELS,
  formatTime,
  STATUS_STYLE,
  useInvalidateCounseling,
  useTeacherSessions,
  type CounselingType,
  type Session,
} from '@/features/counseling/api'
import { SessionDialog } from '@/features/counseling/SessionDialog'
import { formatDay } from '@/features/portal/format'
import { useTeacherContext } from './useTeacherDashboard'

/** The faculty Counseling Log (PRD 5.14): the sessions this teacher held or scheduled. */
export function CounselingLogPage() {
  const { dashboard } = useTeacherContext()
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])
  const sessions = useTeacherSessions({ q, type }, !!dashboard?.school)
  const invalidate = useInvalidateCounseling()
  const [dialog, setDialog] = useState<Session | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Session | null>(null)

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-[26px]">Counseling Log</h1>
          <p className="mt-1 text-sm text-slate-500">Log and track counseling sessions with your students</p>
        </div>
        <button type="button" disabled={!dashboard?.school} onClick={() => setDialog('new')} className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink px-5 text-sm font-semibold text-white shadow-sm hover:bg-ink-hover disabled:opacity-60">
          <Plus className="size-4" /> Log Session
        </button>
      </div>

      <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by student name..." aria-label="Filter by student name" className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pr-3 pl-10 text-sm focus:bg-white focus:outline-none" />
        </div>
        <Filter className="hidden size-4 text-slate-400 sm:block" />
        <select aria-label="Session type" value={type} onChange={(e) => setType(e.target.value)} className="h-11 rounded-xl border border-slate-200 px-3 text-sm">
          <option value="">All Session Types</option>
          {(Object.keys(COUNSELING_TYPE_LABELS) as CounselingType[]).map((t) => <option key={t} value={t}>{COUNSELING_TYPE_LABELS[t]}</option>)}
        </select>
      </div>

      <div className="mt-6 min-h-[420px] rounded-2xl border border-slate-200 bg-white shadow-sm">
        <ErrorBanner message={sessions.error?.message} />
        {sessions.isPending && dashboard?.school ? (
          <Loader2 className="mx-auto my-24 size-6 animate-spin text-slate-300" aria-label="Loading" />
        ) : !sessions.data || sessions.data.length === 0 ? (
          <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
            <HeartHandshake className="size-10 text-slate-300" strokeWidth={1.5} />
            <p className="mt-3 text-sm text-slate-500">No counseling sessions found.</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {sessions.data.map((s) => (
              <li key={s.id} className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                    {s.student.fullName}
                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">{COUNSELING_TYPE_LABELS[s.type]}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[s.status]}`}>{COUNSELING_STATUS_LABELS[s.status]}</span>
                  </p>
                  <p className="text-xs text-slate-500">{formatDay(s.date)} · {formatTime(s.time)} · {s.durationMinutes} min{s.nextSessionDate && ` · next on ${formatDay(s.nextSessionDate)}`}</p>
                  {s.notes && <p className="mt-2 text-sm whitespace-pre-line text-slate-700">{s.notes}</p>}
                  {s.actionItems && <p className="mt-1 text-xs whitespace-pre-line text-slate-500"><span className="font-semibold">Action items:</span> {s.actionItems}</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" aria-label="Edit session" onClick={() => setDialog(s)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600"><Pencil className="size-4" /></button>
                  <button type="button" aria-label="Delete session" onClick={() => setDeleting(s)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {dialog && <SessionDialog mode="teacher" session={dialog === 'new' ? undefined : dialog} onSaved={invalidate} onClose={() => setDialog(null)} />}
      {deleting && (
        <ConfirmDialog
          title="Delete this session?"
          message={<p>Your session with {deleting.student.fullName} on {formatDay(deleting.date)} and its notes are deleted.</p>}
          confirmLabel="Delete"
          onConfirm={async () => {
            await api(`/teacher/counseling/${deleting.id}`, { method: 'DELETE' })
            await invalidate()
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  )
}
