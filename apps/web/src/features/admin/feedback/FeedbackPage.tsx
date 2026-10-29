import { useEffect, useState, type ReactNode } from 'react'
import { CalendarDays, Folder, FolderOpen, GraduationCap, Info, Link2, Loader2, RefreshCw, RotateCcw, Search, Star, TrendingDown, TrendingUp, UserRound } from 'lucide-react'
import { api } from '@/lib/api'
import { ErrorBanner } from '@/components/ui/form'
import { formatDay } from '@/features/portal/format'
import {
  CATEGORY_LABELS,
  DIRECTION_LABELS,
  feedbackPath,
  keywordTone,
  percent,
  STATUS_HINTS,
  useAdminFeedback,
  useInvalidateFeedback,
  type AdminFeedback,
  type AdminFilters,
  type Feedback,
  type FeedbackStatus,
} from '@/features/feedback/api'
import { Stars, StatusBadge } from '@/features/feedback/ui'
import { useAdminContext } from '../adminContext'
import { FeedbackImportDialog } from './FeedbackImportDialog'
import { FeedbackLinksDialog } from './FeedbackLinksDialog'
import { SendFeedbackDialog } from './SendFeedbackDialog'

const DIRECTIONS: { key: AdminFilters['direction']; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'TEACHER_TO_MANAGEMENT', label: 'Teacher → Management' },
  { key: 'MANAGEMENT_TO_TEACHER', label: 'Management → Teacher' },
  { key: 'STUDENT_TO_TEACHER', label: 'Student → Teacher' },
]

/** Feedback Management (PRD 4.12): feedback both ways between management and faculty, students' feedback on their teachers, and its review workflow. */
export function FeedbackPage() {
  const { schoolId } = useAdminContext()
  const [filters, setFilters] = useState<AdminFilters>({ view: 'pending', status: '', direction: '', q: '' })
  const [search, setSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === search.trim() ? f : { ...f, q: search.trim() })), 250)
    return () => clearTimeout(t)
  }, [search])
  const feedback = useAdminFeedback(schoolId, filters)
  const invalidate = useInvalidateFeedback(schoolId)
  const [dialog, setDialog] = useState<'send' | 'import' | 'links' | null>(null)
  const data = feedback.data
  const setView = (view: AdminFilters['view'], status: AdminFilters['status'] = '') => setFilters((f) => ({ ...f, view, status }))

  return (
    <>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 sm:text-[26px]">Feedback Management</h1>
          <p className="mt-1 text-sm text-slate-500">Review feedback exchanged between management and faculty, and from students</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setDialog('links')} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
            <Link2 className="size-4" /> Student feedback links
          </button>
          <button type="button" onClick={() => setDialog('import')} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700">
            <Folder className="size-4" /> Upload Excel Sheet
          </button>
          <button type="button" onClick={() => setDialog('send')} className="inline-flex h-10 shrink-0 items-center rounded-lg bg-ink px-4 text-sm font-semibold text-white shadow-sm hover:bg-ink-hover">
            Send Feedback to Teachers
          </button>
          <button type="button" onClick={() => void feedback.refetch()} disabled={feedback.isFetching} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60">
            <RefreshCw className={`size-4 ${feedback.isFetching ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {feedback.error && <div className="mt-4"><ErrorBanner message={feedback.error.message} /></div>}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Total Feedback This Month">
          <span className="text-slate-900">{data?.kpis.thisMonth ?? '–'}</span>
        </Kpi>
        <Kpi label="Average Rating">
          <span className="inline-flex items-center gap-2 text-slate-900">
            {data?.kpis.averageRating ?? '—'} <Star className="size-5 fill-amber-400 text-amber-400" aria-hidden />
          </span>
        </Kpi>
        <Kpi label="Pending Review" active={filters.view === 'pending'} tone="amber" onClick={() => setView('pending')}>
          <span className="text-amber-500">{data?.kpis.pending ?? '–'}</span>
        </Kpi>
        <Kpi label="Actioned" active={filters.view === 'closed' && filters.status === 'ACTIONED'} tone="emerald" onClick={() => setView('closed', 'ACTIONED')}>
          <span className="text-emerald-600">{data?.kpis.actioned ?? '–'}</span>
        </Kpi>
      </div>

      <div className="mt-8 flex flex-col gap-3 border-b border-slate-200 md:flex-row md:items-end md:gap-6">
        <div role="tablist" aria-label="Review state" className="mb-3 inline-flex self-start rounded-xl border border-slate-200 bg-slate-100 p-1">
          <SegButton active={filters.view === 'pending'} onClick={() => setView('pending')}>Pending</SegButton>
          <SegButton active={filters.view === 'closed'} onClick={() => setView('closed')}>Actioned ({data?.counts.closed ?? 0})</SegButton>
        </div>
        <div role="tablist" aria-label="Direction" className="-mb-px flex gap-6 overflow-x-auto">
          {DIRECTIONS.map((d) => (
            <button
              key={d.key}
              type="button"
              role="tab"
              aria-selected={filters.direction === d.key}
              onClick={() => setFilters((f) => ({ ...f, direction: d.key }))}
              className={`shrink-0 border-b-2 px-1 pb-3 text-sm font-semibold whitespace-nowrap transition ${filters.direction === d.key ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative mt-5">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search feedback content, sender, subject, batch, category..."
          aria-label="Search feedback"
          className="h-11 w-full rounded-xl border border-slate-200 bg-white pr-4 pl-11 text-sm shadow-sm focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
        />
      </div>

      <FeedbackList data={data} loading={!data && !feedback.error} filters={filters} schoolId={schoolId} onChanged={invalidate} />

      <hr className="my-8 border-slate-200" />
      <div className="grid gap-6 lg:grid-cols-3">
        <RatingDistribution data={data} />
        <SentimentKeywords data={data} />
        <StatusLegend />
      </div>

      {dialog === 'send' && <SendFeedbackDialog schoolId={schoolId} onSent={invalidate} onClose={() => setDialog(null)} />}
      {dialog === 'links' && <FeedbackLinksDialog schoolId={schoolId} onClose={() => setDialog(null)} />}
      {dialog === 'import' && <FeedbackImportDialog schoolId={schoolId} onImported={invalidate} onClose={() => setDialog(null)} />}
    </>
  )
}

function Kpi({ label, children, active, tone, onClick }: { label: string; children: ReactNode; active?: boolean; tone?: 'amber' | 'emerald'; onClick?: () => void }) {
  const ring = active ? (tone === 'amber' ? 'border-amber-400 ring-1 ring-amber-300' : 'border-emerald-400 ring-1 ring-emerald-300') : 'border-slate-200'
  const body = (
    <>
      <p className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">{label}</p>
      <p className="mt-3 text-3xl font-black tabular-nums">{children}</p>
      {onClick && <p className="mt-2 text-[11px] text-slate-400">Click to view</p>}
    </>
  )
  return onClick ? (
    <button type="button" onClick={onClick} aria-pressed={active} className={`rounded-2xl border-2 bg-white p-5 text-left shadow-sm transition hover:shadow-md ${ring}`}>{body}</button>
  ) : (
    <div className="rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm">{body}</div>
  )
}

function SegButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
      {children}
    </button>
  )
}

function FeedbackList({ data, loading, filters, schoolId, onChanged }: { data: AdminFeedback | undefined; loading: boolean; filters: AdminFilters; schoolId: string; onChanged: () => Promise<unknown> }) {
  if (loading) return <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-slate-300" aria-label="Loading" /></div>
  if (!data) return null
  if (data.items.length === 0) {
    const message = filters.q
      ? `No feedback matches “${filters.q}”.`
      : filters.view === 'pending'
        ? 'No pending feedback — all caught up!'
        : filters.status === 'ACTIONED'
          ? 'No actioned feedback yet.'
          : 'Nothing actioned or dismissed yet.'
    return <div className="mt-6 flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center text-sm font-semibold text-slate-400 shadow-sm">{message}</div>
  }
  return (
    <div className="mt-6 space-y-5">
      {data.items.map((f) => <FeedbackCard key={f.id} feedback={f} schoolId={schoolId} onChanged={onChanged} />)}
      {data.total > data.items.length && <p className="text-center text-xs text-slate-400">Showing the latest {data.items.length} of {data.total}. Search to find older feedback.</p>}
    </div>
  )
}

function FeedbackCard({ feedback: f, schoolId, onChanged }: { feedback: Feedback; schoolId: string; onChanged: () => Promise<unknown> }) {
  const [busy, setBusy] = useState<FeedbackStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const closed = f.status === 'ACTIONED' || f.status === 'DISMISSED'
  async function move(status: FeedbackStatus) {
    setBusy(status)
    setError(null)
    try {
      await api(`${feedbackPath(schoolId)}/${f.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the feedback')
    } finally {
      setBusy(null)
    }
  }
  const toTeacher = f.direction === 'MANAGEMENT_TO_TEACHER'
  const badge = f.student
    ? 'border-amber-200 bg-amber-50 text-amber-700'
    : toTeacher
      ? 'border-purple-200 bg-purple-50 text-purple-700'
      : 'border-indigo-200 bg-indigo-50 text-indigo-700'
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-sm font-bold text-emerald-700" aria-hidden>
          {f.sender.name.trim().charAt(0).toUpperCase() || '?'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-slate-900">{f.sender.name}</span>
            {f.student && <span className="text-xs font-semibold text-slate-500">({f.student.batchName})</span>}
            {f.student && f.target && <span className="text-sm text-slate-500">→ <span className="font-bold text-slate-900">{f.target.name}</span></span>}
            <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${badge}`}>{DIRECTION_LABELS[f.direction]}</span>
            {f.source === 'IMPORT' && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Imported</span>}
          </div>
          <div className="mt-1"><Stars rating={f.rating} /></div>
        </div>
        <StatusBadge status={f.status} />
      </div>
      <p className="mt-4 text-sm whitespace-pre-line text-slate-800 italic [overflow-wrap:anywhere]">“{f.content}”</p>
      <div className="mt-5 flex flex-col gap-4 border-t border-slate-100 pt-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {f.student ? <Chip icon={GraduationCap}>Batch: {f.student.batchName}</Chip> : <Chip icon={FolderOpen}>Category: {CATEGORY_LABELS[f.category]}</Chip>}
          {f.target && <Chip icon={UserRound} tone="blue">Target: {f.target.name}</Chip>}
          {f.subject && <Chip>Subject: {f.subject}</Chip>}
          <Chip icon={CalendarDays}>Date: {formatDay(f.date)}</Chip>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {closed ? (
            <>
              {f.statusChangedBy && <span className="text-[11px] text-slate-400">{f.status === 'ACTIONED' ? 'Actioned' : 'Dismissed'} by {f.statusChangedBy}</span>}
              <button type="button" onClick={() => void move('REVIEWED')} disabled={!!busy} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Reopen
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => void move('DISMISSED')} disabled={!!busy} className="h-9 rounded-lg px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-60">
                {busy === 'DISMISSED' ? 'Dismissing…' : 'Dismiss'}
              </button>
              {f.status === 'SUBMITTED' && (
                <button type="button" onClick={() => void move('REVIEWED')} disabled={!!busy} className="h-9 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60">
                  {busy === 'REVIEWED' ? 'Saving…' : 'Mark Reviewed'}
                </button>
              )}
              <button type="button" onClick={() => void move('ACTIONED')} disabled={!!busy} className="h-9 rounded-lg bg-ink px-3.5 text-sm font-semibold text-white hover:bg-ink-hover disabled:opacity-60">
                {busy === 'ACTIONED' ? 'Saving…' : 'Mark Actioned'}
              </button>
            </>
          )}
        </div>
      </div>
      {error && <div className="mt-3"><ErrorBanner message={error} /></div>}
    </article>
  )
}

function Chip({ icon: Icon, tone, children }: { icon?: typeof Folder; tone?: 'blue'; children: ReactNode }) {
  return (
    <span className={`inline-flex max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase ${tone === 'blue' ? 'border-blue-100 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
      {Icon && <Icon className="size-3 shrink-0" />}
      <span className="truncate">{children}</span>
    </span>
  )
}

function Panel({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
          {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function RatingDistribution({ data }: { data: AdminFeedback | undefined }) {
  const rows = data?.ratingDistribution ?? [5, 4, 3, 2, 1].map((stars) => ({ stars, count: 0 }))
  const total = rows.reduce((n, r) => n + r.count, 0)
  return (
    <Panel title="Rating Distribution" subtitle={total ? `${total} rated feedback in all` : 'No feedback yet'}>
      <ul className="space-y-4">
        {rows.map((r) => (
          <li key={r.stars} className="flex items-center gap-3 text-sm">
            <span className="flex w-8 shrink-0 items-center gap-1 font-semibold text-slate-600">{r.stars}<Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden /></span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
              <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${percent(r.count, total)}%` }} />
            </span>
            <span className="w-10 shrink-0 text-right text-xs text-slate-500 tabular-nums" title={`${r.count} feedback`}>{percent(r.count, total)}%</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function SentimentKeywords({ data }: { data: AdminFeedback | undefined }) {
  const keywords = data?.keywords ?? []
  return (
    <Panel
      title="Sentiment Keywords"
      subtitle="Common topics appearing in recent feedback (last 30 days)."
      action={<span title="Words and phrases that two or more feedback entries mention in the last 30 days. Green topics are rated 4+ on average, red ones 2.5 or below."><Info className="size-4 text-slate-400" aria-label="How keywords are found" /></span>}
    >
      {keywords.length === 0 ? (
        <p className="text-xs text-slate-400 italic">No recurring topics yet. A topic shows here once two or more feedback entries mention it.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {keywords.map((k) => {
            const tone = keywordTone(k)
            const style = tone === 'positive' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : tone === 'negative' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-slate-50 text-slate-700'
            const Icon = tone === 'positive' ? TrendingUp : tone === 'negative' ? TrendingDown : null
            return (
              <li key={k.phrase} title={`${k.mentions} entries · average ${k.averageRating}★`} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold ${style}`}>
                {Icon && <Icon className="size-3.5" />} {k.phrase} <span className="text-[11px] font-normal opacity-70">{k.mentions}</span>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function StatusLegend() {
  return (
    <Panel title="Status Legend" subtitle="Workflow states for processing feedback entries.">
      <ul className="space-y-3.5">
        {(['SUBMITTED', 'REVIEWED', 'ACTIONED', 'DISMISSED'] as const).map((s) => (
          <li key={s} className="flex items-center justify-between gap-3">
            <StatusBadge status={s} icon />
            <span className="text-right text-xs text-slate-500">{STATUS_HINTS[s]}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
