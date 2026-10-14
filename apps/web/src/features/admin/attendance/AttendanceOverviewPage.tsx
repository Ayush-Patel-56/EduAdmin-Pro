import { useMemo, useState, type ReactNode } from 'react'
import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, Download, FileSpreadsheet, FileText, Filter, Loader2, RefreshCw, Search, Star, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner } from '@/components/ui/form'
import { ALL } from '@/features/academic/filters'
import { formatDay } from '@/features/portal/format'
import { rateColor, useOverview, type Overview } from '@/features/attendance/api'
import { useAdminContext } from '../adminContext'
import { exportAttendanceCsv, exportAttendancePdf } from './exportAttendance'

const PAGE = 10
const RANGES = [7, 30, 90] as const
const LEGEND: [string, string][] = [
  ['bg-rose-500', '<70%'],
  ['bg-orange-400', '70-80%'],
  ['bg-amber-300', '80-90%'],
  ['bg-emerald-400', '90-95%'],
  ['bg-emerald-600', '>=95%'],
]

/** Attendance Overview (PRD 4.11). */
export function AttendanceOverviewPage() {
  const { schoolId, structure, filters, dashboard } = useAdminContext()
  const [days, setDays] = useState<(typeof RANGES)[number]>(30)
  const overview = useOverview(schoolId, {
    days,
    programId: filters.programId === ALL ? '' : filters.programId,
    batchId: filters.batchId === ALL ? '' : filters.batchId,
  })
  const [exporting, setExporting] = useState(false)
  const o = overview.data
  const programName = structure?.programs.find((p) => p.id === filters.programId)?.name
  const batchName = structure?.batches.find((b) => b.id === filters.batchId)?.name
  const filterLabel = [programName ?? 'All programs', batchName ?? 'all batches'].join(', ')

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-[26px]">Attendance Overview</h1>
          <p className="mt-1 text-sm text-slate-500">Track daily attendance trends across batches and subjects</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setExporting(true)} disabled={!o || o.students.length === 0} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50">
            <Download className="size-4" /> Export
          </button>
          <button type="button" onClick={() => void overview.refetch()} disabled={overview.isFetching} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60">
            <RefreshCw className={`size-4 ${overview.isFetching ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      <section className="mt-6 grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-3">
        <FilterSelect id="at-range" label="Date Range" icon={CalendarDays} value={String(days)} onChange={(v) => setDays(Number(v) as (typeof RANGES)[number])}>
          {RANGES.map((d) => <option key={d} value={d}>Last {d} Days</option>)}
        </FilterSelect>
        <FilterSelect id="at-program" label="Program" icon={Filter} value={filters.programId} onChange={filters.setProgramId}>
          <option value={ALL}>All Programs</option>
          {(structure?.programs ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </FilterSelect>
        <FilterSelect id="at-batch" label="Batch" icon={Filter} value={filters.batchId} onChange={filters.setBatchId}>
          <option value={ALL}>All Batches</option>
          {filters.batchOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </FilterSelect>
      </section>

      {overview.error && <div className="mt-4"><ErrorBanner message={overview.error.message} /></div>}
      {!o ? (
        !overview.error && <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-slate-300" aria-label="Loading" /></div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <Kpi label="Overall Attendance Rate" icon={BarChart3} iconClass="bg-emerald-50 text-emerald-600">
              <span className="text-3xl font-bold text-slate-900">{o.kpis.rate === null ? '—' : `${o.kpis.rate}%`}</span>
              {o.kpis.change !== null && (
                <span className={`ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${o.kpis.change >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`} title={`Change against the ${days} days before`}>
                  {o.kpis.change >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                  {o.kpis.change >= 0 ? '+' : ''}{o.kpis.change}%
                </span>
              )}
              {o.kpis.rate === null && <span className="block text-xs text-slate-500">No attendance marked in this period</span>}
            </Kpi>
            <Kpi label="Batches Below 75%" icon={TriangleAlert} iconClass="bg-red-50 text-red-500">
              <span className={`text-3xl font-bold ${o.kpis.batchesBelow75 ? 'text-red-600' : 'text-slate-900'}`}>{o.kpis.batchesBelow75}</span>
              <span className="ml-2 text-sm font-semibold text-slate-700">Needs attention</span>
            </Kpi>
            <Kpi label="Perfect Attendance" icon={Star} iconClass="bg-emerald-50 text-emerald-600">
              <span className="text-3xl font-bold text-emerald-600">{o.kpis.perfectAttendance}</span>
              <span className="ml-2 text-sm font-semibold text-slate-700">Student{o.kpis.perfectAttendance === 1 ? '' : 's'}</span>
            </Kpi>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-3">
            <Heatmap overview={o} />
            <Attention overview={o} />
          </div>

          <StudentDetail overview={o} />
        </>
      )}

      {exporting && o && (
        <ExportDialog
          onClose={() => setExporting(false)}
          onExport={async (format) => {
            const school = dashboard?.school.name ?? 'school'
            if (format === 'csv') exportAttendanceCsv(school, o)
            else await exportAttendancePdf(school, o, filterLabel)
          }}
        />
      )}
    </>
  )
}

function FilterSelect({ id, label, icon: Icon, value, onChange, children }: { id: string; label: string; icon: typeof Filter; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[11px] font-bold tracking-wider text-slate-500 uppercase">{label}</label>
      <div className="relative">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="h-10 w-full appearance-none rounded-lg border border-slate-200 bg-white pr-9 pl-3 text-sm font-semibold text-slate-900 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 focus:outline-none">
          {children}
        </select>
        <Icon className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-slate-400" />
      </div>
    </div>
  )
}

function Kpi({ label, icon: Icon, iconClass, children }: { label: string; icon: typeof Filter; iconClass: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <p className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">{label}</p>
        <div className="mt-2">{children}</div>
      </div>
      <span className={`flex size-12 items-center justify-center rounded-xl ${iconClass}`}><Icon className="size-5" /></span>
    </div>
  )
}

function Heatmap({ overview: o }: { overview: Overview }) {
  const dense = o.heatmap.dates.length > 31
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm xl:col-span-2">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <h2 className="text-base font-bold text-slate-900">Daily Attendance Heatmap</h2>
        <ul className="flex flex-wrap gap-3">
          {LEGEND.map(([color, text]) => (
            <li key={text} className="flex items-center gap-1.5 text-[11px] text-slate-500"><span className={`size-2.5 rounded-full ${color}`} /> {text}</li>
          ))}
        </ul>
      </div>
      <p className="mt-2 text-xs text-slate-500">Hover over blocks to see exact attendance rate. Grey blocks indicate Sundays or days with no records marked.</p>
      {o.heatmap.batches.length === 0 ? (
        <p className="mt-8 text-sm text-slate-400 italic">No attendance marked in this period.</p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="border-separate border-spacing-1">
            <thead>
              <tr>
                <th className="min-w-36 pr-3 text-left text-[11px] font-bold tracking-wider text-slate-500 uppercase">Class</th>
                {o.heatmap.dates.map((d) => (
                  <th key={d} className={`text-center text-[10px] font-semibold text-slate-400 ${dense ? 'w-3' : 'w-6'}`}>{dense ? '' : d.slice(8)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {o.heatmap.batches.map((b) => (
                <tr key={b.id}>
                  <td className="pr-3">
                    <p className="text-xs font-bold text-slate-900">{b.program} • {b.name}</p>
                    <p className="text-[10px] text-slate-500">{b.rate === null ? '—' : `${b.rate}% this period`}</p>
                  </td>
                  {b.cells.map((c) => {
                    const sunday = new Date(`${c.date}T00:00:00Z`).getUTCDay() === 0
                    const text = c.rate === null ? `${formatDay(c.date)}: ${sunday ? 'Sunday' : 'no records'}` : `${formatDay(c.date)}: ${c.rate}% (${c.present} of ${c.present + c.absent} present)`
                    return (
                      <td key={c.date} title={text}>
                        <span aria-label={text} className={`block rounded ${dense ? 'size-3' : 'size-6'} ${rateColor(c.rate)}`} />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Attention({ overview: o }: { overview: Overview }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-bold text-slate-900">Batches Needing Attention</h2>
      <p className="mt-1 text-xs text-slate-500">Batches with low or declining attendance</p>
      {o.attention.length === 0 ? (
        <p className="mt-8 text-sm text-slate-400 italic">{o.heatmap.batches.length ? 'Every batch is at 75% or above and holding steady.' : 'No attendance marked in this period.'}</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {o.attention.map((b) => (
            <li key={b.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
              <div>
                <p className="text-sm font-bold text-slate-900">{b.name}</p>
                <p className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">{b.program}{b.declining ? ' • declining' : ''}</p>
              </div>
              <span className={`text-sm font-bold ${b.rate !== null && b.rate < 75 ? 'text-red-600' : 'text-slate-900'}`}>{b.rate === null ? '—' : `${b.rate}%`}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function StudentDetail({ overview: o }: { overview: Overview }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? o.students.filter((s) => s.fullName.toLowerCase().includes(q) || (s.batch ?? '').toLowerCase().includes(q)) : o.students
  }, [o.students, search])
  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const current = Math.min(page, pages)
  const shown = rows.slice((current - 1) * PAGE, current * PAGE)
  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-bold text-slate-900">Student Attendance Detail</h2>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="Search student or batch..." aria-label="Search student or batch" className="h-10 w-full rounded-lg border border-slate-200 pr-3 pl-9 text-sm focus:outline-none sm:w-80" />
        </div>
      </div>
      <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[760px] text-left">
          <thead>
            <tr className="border-b border-slate-200">
              {['Student', 'Batch', 'Present Days', 'Absent Days', 'Attendance %', 'Last Absent Date'].map((h, i) => (
                <th key={h} className={`px-6 py-3.5 text-[11px] font-bold tracking-wider text-slate-500 uppercase ${i >= 2 && i <= 4 ? 'text-center' : ''} ${i === 5 ? 'text-right' : ''}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr><td colSpan={6} className="px-6 py-10 text-center text-sm text-slate-400 italic">{o.students.length ? `No student matches “${search}”.` : 'No attendance marked in this period.'}</td></tr>
            ) : (
              shown.map((s) => (
                <tr key={s.id} className="border-b border-slate-100 text-sm last:border-0">
                  <td className="px-6 py-4 font-semibold text-slate-900">{s.fullName}</td>
                  <td className="px-6 py-4 text-slate-700">{s.batch ?? 'Unassigned'}</td>
                  <td className="px-6 py-4 text-center text-slate-700">{s.presentDays}</td>
                  <td className="px-6 py-4 text-center text-slate-700">{s.absentDays}</td>
                  <td className="px-6 py-4 text-center">
                    {s.rate === null ? <span className="text-slate-400">—</span> : (
                      <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${s.rate >= 90 ? 'bg-emerald-50 text-emerald-700' : s.rate >= 75 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>{s.rate}%</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right text-slate-700">{s.lastAbsent ? formatDay(s.lastAbsent) : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 px-5 py-3">
        <p className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">
          Showing {rows.length ? (current - 1) * PAGE + 1 : 0}-{Math.min(current * PAGE, rows.length)} of {rows.length} entries
        </p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPage(current - 1)} disabled={current <= 1} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 disabled:opacity-50"><ChevronLeft className="size-3.5" /> Previous</button>
          <span className="flex size-8 items-center justify-center rounded-lg bg-ink text-xs font-bold text-white">{current}</span>
          <button type="button" onClick={() => setPage(current + 1)} disabled={current >= pages} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 disabled:opacity-50">Next <ChevronRight className="size-3.5" /></button>
        </div>
      </div>
    </section>
  )
}

function ExportDialog({ onClose, onExport }: { onClose: () => void; onExport: (format: 'pdf' | 'csv') => Promise<void> }) {
  const [format, setFormat] = useState<'pdf' | 'csv'>('pdf')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run() {
    setBusy(true)
    setError(null)
    try {
      await onExport(format)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export')
      setBusy(false)
    }
  }
  return (
    <Dialog title="Export Attendance Detail" onClose={onClose} widthClass="max-w-md">
      <div className="px-6 py-5">
        <p className="mb-3 text-xs font-bold tracking-wider text-slate-700 uppercase">Export Format</p>
        <div role="radiogroup" aria-label="Export format" className="grid grid-cols-2 gap-3">
          {(
            [
              ['pdf', 'PDF', FileText],
              ['csv', 'CSV', FileSpreadsheet],
            ] as const
          ).map(([key, text, Icon]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={format === key}
              onClick={() => setFormat(key)}
              className={`flex flex-col items-center gap-2 rounded-xl border-2 py-5 text-sm font-semibold transition ${format === key ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
            >
              <Icon className="size-5" /> {text}
            </button>
          ))}
        </div>
        {error && <div className="mt-4"><ErrorBanner message={error} /></div>}
      </div>
      <div className="flex justify-end gap-3 px-6 pb-6">
        <button type="button" onClick={onClose} className="h-10 rounded-lg px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100">Cancel</button>
        <button type="button" onClick={() => void run()} disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
          <Download className="size-4" /> {busy ? 'Generating…' : `Generate & Export ${format.toUpperCase()}`}
        </button>
      </div>
    </Dialog>
  )
}
