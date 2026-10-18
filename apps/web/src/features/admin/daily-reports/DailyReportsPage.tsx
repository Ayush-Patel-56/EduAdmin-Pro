import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Award, BookOpen, CalendarDays, ChevronDown, ClipboardList, Download, Flag, Loader2, Printer, RefreshCw, Trash2, UsersRound, type LucideIcon } from 'lucide-react'
import { api } from '@/lib/api'
import { Dialog } from '@/components/ui/Dialog'
import { textareaClass } from '@/components/ui/formStyles'
import { ExportDialog } from '@/components/ui/ExportDialog'
import { ConfirmDialog, ErrorBanner } from '@/components/ui/form'
import { ALL } from '@/features/academic/filters'
import { todayIst } from '@/lib/dates'
import { useQueryClient } from '@tanstack/react-query'
import { adminReportsPath, classLine, dateTimeIst, longDay, STATUS_TABS, timeIst, useAdminReports, type AdminDay, type ReportStatus } from '@/features/daily-reports/api'
import { ProgressReportsLater, ReportTab, ReportTabBar, StatusPill } from '@/features/daily-reports/ui'
import { useAdminContext } from '../adminContext'
import { exportReportsCsv, exportReportsPdf, printReport } from './exportDailyReports'

type Tab = 'daily' | 'progress'

/** Daily Reports (PRD 4.8): what each teacher reported for a day, and (later) student progress reports. */
export function DailyReportsPage() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'progress' ? 'progress' : 'daily'
  const select = (next: Tab) => {
    const p = new URLSearchParams(params)
    if (next === 'daily') p.delete('tab')
    else p.set('tab', next)
    setParams(p, { replace: true })
  }
  return (
    <>
      <ReportTabBar label="Daily Reports">
        <ReportTab active={tab === 'daily'} onClick={() => select('daily')} icon={ClipboardList} label="Daily Teacher Reports" />
        <ReportTab active={tab === 'progress'} onClick={() => select('progress')} icon={Award} label="Student Progress Reports" />
      </ReportTabBar>
      {tab === 'daily' ? <DailyTeacherReports /> : <ProgressReportsLater />}
    </>
  )
}

function DailyTeacherReports() {
  const { schoolId, structure, filters, dashboard } = useAdminContext()
  const [params, setParams] = useSearchParams()
  const date = params.get('date') || todayIst()
  const [status, setStatus] = useState<ReportStatus | ''>('')
  const [open, setOpen] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const reports = useAdminReports(schoolId, {
    date,
    programId: filters.programId === ALL ? '' : filters.programId,
    batchId: filters.batchId === ALL ? '' : filters.batchId,
    status,
  })
  const day = reports.data?.date === date ? reports.data : undefined
  const programName = structure?.programs.find((p) => p.id === filters.programId)?.name
  const batchName = structure?.batches.find((b) => b.id === filters.batchId)?.name
  const filterLabel = [programName ?? 'All programs', batchName ?? 'all batches', STATUS_TABS.find((t) => t.key === status)!.label.toLowerCase()].join(', ')

  const setDate = (value: string) => {
    const p = new URLSearchParams(params)
    if (value && value !== todayIst()) p.set('date', value)
    else p.delete('date')
    setParams(p, { replace: true })
    setOpen(null)
  }

  return (
    <>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 sm:text-[26px]">Daily Teacher Reports</h1>
          <p className="mt-1 text-sm text-slate-500">Monitor what teachers accomplished each day across the institution.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setExporting(true)} disabled={!day || day.items.length === 0} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
            <Download className="size-4" /> Export
          </button>
          <button type="button" onClick={() => void reports.refetch()} disabled={reports.isFetching} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60">
            <RefreshCw className={`size-4 ${reports.isFetching ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <label className="relative inline-flex h-10 shrink-0 items-center rounded-lg border border-slate-200 bg-white pr-2 pl-9 shadow-sm focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100">
            <CalendarDays className="pointer-events-none absolute left-3 size-4 text-slate-400" />
            <span className="sr-only">Report date</span>
            <input type="date" value={date} max={todayIst()} onChange={(e) => setDate(e.target.value)} className="h-full bg-transparent text-sm font-semibold text-slate-800 focus:outline-none" />
          </label>
        </div>
      </div>

      {reports.error && <div className="mt-4"><ErrorBanner message={reports.error.message} /></div>}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Kpi icon={ClipboardList} iconClass="bg-emerald-50 text-emerald-600" value={day?.kpis.submitted} label="Reports Submitted" sub={day ? `${day.kpis.late} late` : ' '} />
        <Kpi icon={UsersRound} iconClass="bg-sky-50 text-sky-600" value={day?.kpis.teachers} label="Teachers Reported" sub="for this date" />
        <Kpi icon={BookOpen} iconClass="bg-amber-50 text-amber-600" value={day?.kpis.classes} label="Classes Logged" sub="each batch's subjects reported" />
      </div>

      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">{longDay(date)}</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {day ? `${day.items.length} report${day.items.length === 1 ? '' : 's'}${status ? ` ${STATUS_WORDS[status]}` : ''} for this date` : 'Loading…'}
            </p>
          </div>
          <div role="tablist" aria-label="Report status" className="inline-flex self-start rounded-lg bg-slate-100 p-1 sm:self-auto">
            {STATUS_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={status === t.key}
                onClick={() => setStatus(t.key)}
                className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition ${status === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                {t.label}
                {t.key === 'FLAGGED' && day && day.kpis.flagged > 0 && <span className="ml-1.5 rounded-full bg-rose-100 px-1.5 text-[10px] font-bold text-rose-700">{day.kpis.flagged}</span>}
              </button>
            ))}
          </div>
        </div>
        {!day ? (
          !reports.error && <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-slate-300" aria-label="Loading" /></div>
        ) : day.items.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <ClipboardList className="size-10 text-slate-300" strokeWidth={1.5} />
            <p className="mt-3 text-sm font-semibold text-slate-600">{status ? `No reports ${STATUS_WORDS[status]} for this date` : 'No reports for this date'}</p>
            <p className="mt-1 text-xs text-slate-400">
              {status ? 'Try another tab or date.' : "Teachers haven't submitted their daily reports for this date yet."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {day.items.map((r) => (
              <ReportRow key={r.id} schoolId={schoolId} school={dashboard?.school.name ?? 'School'} report={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
            ))}
          </ul>
        )}
      </section>

      {exporting && day && (
        <ExportDialog
          title="Export Daily Teacher Reports"
          onClose={() => setExporting(false)}
          onExport={async (format) => {
            const school = dashboard?.school.name ?? 'school'
            if (format === 'csv') exportReportsCsv(school, day, day.items)
            else await exportReportsPdf(school, day, day.items, filterLabel)
          }}
        />
      )}
    </>
  )
}

function Kpi({ icon: Icon, iconClass, value, label, sub }: { icon: LucideIcon; iconClass: string; value: number | undefined; label: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <span className={`flex size-9 items-center justify-center rounded-lg ${iconClass}`}><Icon className="size-[18px]" /></span>
      <p className="mt-3 text-2xl font-bold text-slate-900 tabular-nums">{value ?? '–'}</p>
      <p className="mt-1 text-sm font-semibold text-slate-700">{label}</p>
      <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>
    </div>
  )
}

const STATUS_WORDS: Record<ReportStatus, string> = { ON_TIME: 'submitted on time', LATE: 'late', FLAGGED: 'flagged' }

type AdminReport = AdminDay['items'][number]

function ReportRow({ schoolId, school, report: r, open, onToggle }: { schoolId: string; school: string; report: AdminReport; open: boolean; onToggle: () => void }) {
  const client = useQueryClient()
  const [dialog, setDialog] = useState<'flag' | 'delete' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = () => client.invalidateQueries({ queryKey: [schoolId, 'daily-reports'] })
  async function unflag() {
    setBusy(true)
    setError(null)
    try {
      await api(`${adminReportsPath(schoolId)}/${r.id}/flag`, { method: 'PATCH', body: JSON.stringify({ flagged: false }) })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear the flag')
    } finally {
      setBusy(false)
    }
  }
  return (
    <li>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition hover:bg-slate-50/70">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white" aria-hidden>
          {r.teacher.name.trim().charAt(0).toUpperCase() || '?'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-bold text-slate-900">{r.teacher.name}</span>
            <StatusPill late={r.late} />
            {r.edited && <span className="text-[10px] font-semibold text-slate-400">Edited</span>}
            {r.flag && (
              <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700" title={r.flag.reason ?? undefined}>
                <Flag className="size-3" /> Flagged
              </span>
            )}
            {r.flag?.changedAfter && <span className="text-[10px] font-semibold text-rose-600">Changed after flagging</span>}
          </span>
          <span className="mt-0.5 block truncate text-xs text-slate-500">{classLine(r)}</span>
        </span>
        <span className="shrink-0 text-right text-[11px] text-slate-500" title={`Submitted ${dateTimeIst(r.submittedAt)}`}>
          {r.late ? dateTimeIst(r.submittedAt) : timeIst(r.submittedAt)}
        </span>
        <ChevronDown className={`size-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="space-y-4 border-t border-slate-100 bg-slate-50/50 px-5 py-4 sm:pl-[72px]">
          <Detail label="Topics Covered">{r.topics}</Detail>
          {r.homework && <Detail label="Homework Given">{r.homework}</Detail>}
          {r.observations && <Detail label="Observations">{r.observations}</Detail>}
          {r.flag && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              Flagged by {r.flag.by} on {dateTimeIst(r.flag.at)}
              {r.flag.reason && <span className="block whitespace-pre-line [overflow-wrap:anywhere]">{r.flag.reason}</span>}
            </p>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] text-slate-400">{r.program.name} · submitted {dateTimeIst(r.submittedAt)}</p>
            <div className="flex flex-wrap gap-2">
              {r.flag ? (
                <button type="button" onClick={() => void unflag()} disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                  <Flag className="size-3.5" /> {busy ? 'Clearing…' : 'Clear Flag'}
                </button>
              ) : (
                <button type="button" onClick={() => setDialog('flag')} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50">
                  <Flag className="size-3.5" /> Flag
                </button>
              )}
              <button type="button" onClick={() => void printReport(school, r)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                <Printer className="size-3.5" /> Print
              </button>
              <button type="button" onClick={() => setDialog('delete')} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-red-600 hover:bg-red-50">
                <Trash2 className="size-3.5" /> Delete
              </button>
            </div>
          </div>
          <ErrorBanner message={error} />
        </div>
      )}
      {dialog === 'flag' && <FlagDialog schoolId={schoolId} report={r} onDone={refresh} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && (
        <ConfirmDialog
          title="Delete this report?"
          message={
            <>
              <p className="font-semibold text-slate-800">{r.teacher.name} · {classLine(r)} · {longDay(r.date)}</p>
              <p className="mt-2">The report is removed for good, for the teacher too.</p>
            </>
          }
          confirmLabel="Delete Report"
          onConfirm={async () => {
            await api(`${adminReportsPath(schoolId)}/${r.id}`, { method: 'DELETE' })
            await refresh()
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </li>
  )
}

/** Flag a report for follow-up, with an optional reason (the teacher sees the flag and reason). */
function FlagDialog({ schoolId, report: r, onDone, onClose }: { schoolId: string; report: AdminReport; onDone: () => Promise<unknown>; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save() {
    setBusy(true)
    setError(null)
    try {
      await api(`${adminReportsPath(schoolId)}/${r.id}/flag`, { method: 'PATCH', body: JSON.stringify({ flagged: true, reason: reason.trim() || null }) })
      await onDone()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not flag the report')
      setBusy(false)
    }
  }
  return (
    <Dialog title="Flag report" description={`${r.teacher.name} · ${classLine(r)} · ${longDay(r.date)}`} onClose={onClose} widthClass="max-w-md">
      <div className="space-y-3 px-6 py-5">
        <label htmlFor="flag-reason" className="block text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Reason (optional)</label>
        <textarea id="flag-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Topics too brief; discuss with the teacher" className={textareaClass()} />
        <p className="text-[11px] text-slate-400">The teacher sees the flag and reason on their report. They can still correct it, but can't delete it until the flag is cleared.</p>
        <ErrorBanner message={error} />
      </div>
      <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
        <button type="button" onClick={onClose} className="h-10 rounded-lg px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100">Cancel</button>
        <button type="button" onClick={() => void save()} disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60">
          <Flag className="size-4" /> {busy ? 'Flagging…' : 'Flag Report'}
        </button>
      </div>
    </Dialog>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">{label}</p>
      <p className="mt-1 text-sm whitespace-pre-line text-slate-800 [overflow-wrap:anywhere]">{children}</p>
    </div>
  )
}
