import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Award, BookOpen, CalendarDays, ChevronDown, ClipboardList, Download, Loader2, RefreshCw, UsersRound, type LucideIcon } from 'lucide-react'
import { ExportDialog } from '@/components/ui/ExportDialog'
import { ErrorBanner } from '@/components/ui/form'
import { ALL } from '@/features/academic/filters'
import { todayIst } from '@/lib/dates'
import { classLine, dateTimeIst, longDay, STATUS_TABS, timeIst, useAdminReports, type DailyReport, type ReportStatus } from '@/features/daily-reports/api'
import { ProgressReportsLater, ReportTab, ReportTabBar, StatusPill } from '@/features/daily-reports/ui'
import { useAdminContext } from '../adminContext'
import { exportReportsCsv, exportReportsPdf } from './exportDailyReports'

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
        <Kpi icon={BookOpen} iconClass="bg-amber-50 text-amber-600" value={day?.kpis.classes} label="Classes Logged" sub="total batches" />
      </div>

      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">{longDay(date)}</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {day ? `${day.items.length} report${day.items.length === 1 ? '' : 's'}${status ? ` ${status === 'LATE' ? 'late' : 'submitted on time'}` : ''} for this date` : 'Loading…'}
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
              </button>
            ))}
          </div>
        </div>
        {!day ? (
          !reports.error && <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-slate-300" aria-label="Loading" /></div>
        ) : day.items.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <ClipboardList className="size-10 text-slate-300" strokeWidth={1.5} />
            <p className="mt-3 text-sm font-semibold text-slate-600">{status ? `No ${status === 'LATE' ? 'late' : 'on-time'} reports for this date` : 'No reports for this date'}</p>
            <p className="mt-1 text-xs text-slate-400">
              {status ? 'Try another tab or date.' : "Teachers haven't submitted their daily reports for this date yet."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {day.items.map((r) => (
              <ReportRow key={r.id} report={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
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

function ReportRow({ report: r, open, onToggle }: { report: DailyReport; open: boolean; onToggle: () => void }) {
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
          <p className="text-[11px] text-slate-400">{r.program.name} · submitted {dateTimeIst(r.submittedAt)}</p>
        </div>
      )}
    </li>
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
