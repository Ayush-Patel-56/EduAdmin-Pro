import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, Award, BarChart3, ClipboardCheck, Download, FileSpreadsheet, FileText, Info, LayoutGrid, Loader2, MessageSquareText, Search, Star, Target, TrendingUp, Upload, UserRound, X } from 'lucide-react'
import { ErrorBanner } from '@/components/ui/form'
import { Dialog } from '@/components/ui/Dialog'
import { useDismiss } from '@/components/ui/useDismiss'
import { assessmentsBase } from '@/features/assessments/api'
import { pct, reportsBase, useReportOptions, useStudentReport, useStudentSearch, type StudentReport } from './api'
import { ClassOverview } from './ClassOverview'
import { exportReportCsv, exportReportPdf, exportReportXlsx } from './exportReport'
import { ImportResultsDialog } from './ImportResultsDialog'
import { AnalysisSection, FeedbackSection, MistakesSection, PerformanceSection, TopicsSection } from './ReportSections'
import { Empty, GradePill, Spinner } from './ui'
import { selectClass, toolButton } from './styles'

type View = 'hub' | 'overview'
type Section = 'performance' | 'analysis' | 'topics' | 'mistakes' | 'feedback'

const SECTIONS: { key: Section; label: string; icon: typeof Award }[] = [
  { key: 'performance', label: 'Performance Report', icon: TrendingUp },
  { key: 'analysis', label: 'Test Analysis', icon: Target },
  { key: 'topics', label: 'Strength vs Weakness', icon: BarChart3 },
  { key: 'mistakes', label: 'Error Logs', icon: AlertTriangle },
  { key: 'feedback', label: 'Teacher Feedback', icon: MessageSquareText },
]

/**
 * Student Reports & Analytics (PRD 4.5 admin, 5.4 faculty): the 5-in-1 hub
 * for one student, and the overview of uploaded report sheets. Both portals
 * use this page; the API decides which students each one reaches.
 */
export function StudentReportsPage({ schoolId, school }: { schoolId?: string; school: string }) {
  const base = reportsBase(schoolId)
  const [params, setParams] = useSearchParams()
  const view: View = params.get('view') === 'overview' ? 'overview' : 'hub'
  const setView = (next: View) => {
    const p = new URLSearchParams(params)
    if (next === 'overview') p.set('view', 'overview')
    else p.delete('view')
    setParams(p, { replace: true })
  }
  return (
    <>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 sm:text-[26px]">Student Reports &amp; Analytics</h1>
          <p className="mt-1 text-sm text-slate-500">Unified 5-in-1 student progress reports and class analytics.</p>
        </div>
        <div role="tablist" aria-label="Student reports view" className="inline-flex self-start rounded-lg bg-slate-100 p-1">
          {([['hub', 'Student Reports Hub (5-in-1)', LayoutGrid], ['overview', 'Uploaded Reports Overview', FileSpreadsheet]] as const).map(([key, label, Icon]) => (
            <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${view === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-6">{view === 'hub' ? <Hub base={base} assessments={assessmentsBase(schoolId)} school={school} /> : <ClassOverview base={base} school={school} />}</div>
    </>
  )
}

function Hub({ base, assessments, school }: { base: string; assessments: string; school: string }) {
  const [params, setParams] = useSearchParams()
  const studentId = params.get('student')
  const yearParam = Number(params.get('year')) || null
  const options = useReportOptions(base)
  const report = useStudentReport(base, studentId, yearParam)
  const [section, setSection] = useState<Section>('performance')
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const r = report.data?.student.id === studentId ? report.data : undefined

  const pick = (id: string | null) => {
    const p = new URLSearchParams(params)
    if (id) p.set('student', id)
    else p.delete('student')
    setParams(p, { replace: true })
  }
  const setYear = (year: number) => {
    const p = new URLSearchParams(params)
    if (year === options.data?.currentYear) p.delete('year')
    else p.set('year', String(year))
    setParams(p, { replace: true })
  }
  async function pdf() {
    if (!r) return
    setPdfBusy(true)
    setExportError(null)
    try {
      await exportReportPdf(r, school)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Could not export')
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <StudentPicker base={base} selected={r ?? null} onPick={pick} disabled={options.data?.canWrite === false && !options.data.batches.length} />
          <div className="flex flex-wrap gap-2">
            <label className="sr-only" htmlFor="sr-year">Academic year</label>
            <select id="sr-year" value={r?.year.year ?? yearParam ?? options.data?.currentYear ?? ''} onChange={(e) => setYear(Number(e.target.value))} className={selectClass} disabled={!options.data}>
              {options.data?.years.map((y) => <option key={y.year} value={y.year}>{y.label}</option>)}
            </select>
            {options.data?.canWrite && (
              <button type="button" onClick={() => setImporting(true)} className={toolButton}><Upload className="size-4" /> Import Test Results</button>
            )}
            <button type="button" onClick={() => setExporting(true)} disabled={!r} className={toolButton}><Download className="size-4" /> Export Excel/CSV</button>
            <button type="button" onClick={() => void pdf()} disabled={!r || pdfBusy} className={toolButton}>{pdfBusy ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />} Export 5-in-1 PDF</button>
          </div>
        </div>
        {exportError && <div className="mt-3"><ErrorBanner message={exportError} /></div>}
      </section>

      {options.data && !options.data.canWrite && !options.data.batches.length && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">Your faculty profile is inactive, so student reports aren’t available.</p>
      )}
      {report.error && <div className="mt-4"><ErrorBanner message={report.error.message} /></div>}

      {!studentId ? (
        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white">
          <Empty icon={UserRound} title="Search for a student to open their 5-in-1 report" sub="Performance, test analysis, topic strength, error logs and teacher feedback, worked out from the tests, assignments, ratings, attendance and PTM notes already recorded." />
        </div>
      ) : !r ? (
        !report.error && <Spinner />
      ) : (
        <>
          <ReportHeader r={r} />
          <div role="tablist" aria-label="Report sections" className="mt-6 flex gap-1 overflow-x-auto border-b border-slate-200">
            {SECTIONS.map(({ key, label, icon: Icon }) => (
              <button key={key} type="button" role="tab" aria-selected={section === key} onClick={() => setSection(key)} className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-semibold whitespace-nowrap transition ${section === key ? 'border-indigo-500 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>
          <div className="mt-5" role="tabpanel">
            {section === 'performance' && <PerformanceSection r={r} />}
            {section === 'analysis' && <AnalysisSection r={r} />}
            {section === 'topics' && <TopicsSection r={r} />}
            {section === 'mistakes' && <MistakesSection r={r} />}
            {section === 'feedback' && <FeedbackSection r={r} />}
          </div>
          <p className="mt-6 flex items-start gap-1.5 text-[11px] text-slate-400">
            <Info className="mt-px size-3.5 shrink-0" />
            {r.year.label} ({r.year.from} to {r.year.to}). Worked out from {r.coverage.tests} test result{r.coverage.tests === 1 ? '' : 's'}, {r.coverage.answers} graded answer{r.coverage.answers === 1 ? '' : 's'}, {r.coverage.gradedAssignments} graded assignment{r.coverage.gradedAssignments === 1 ? '' : 's'}, {r.coverage.ratings} rating{r.coverage.ratings === 1 ? '' : 's'}, {r.coverage.classes} class{r.coverage.classes === 1 ? '' : 'es'} of attendance and {r.coverage.ptmNotes} PTM note{r.coverage.ptmNotes === 1 ? '' : 's'}. “—” means there isn’t enough data yet.
          </p>
        </>
      )}

      {importing && <ImportResultsDialog assessmentsBase={assessments} reportsBase={base} onClose={() => setImporting(false)} />}
      {exporting && r && <SheetExportDialog r={r} onClose={() => setExporting(false)} />}
    </>
  )
}

/** Header: who, and the headline numbers (Overall Score / Grade, Batch Rank, Behaviour Score). */
function ReportHeader({ r }: { r: StudentReport }) {
  const s = r.summary
  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-lg font-bold text-indigo-700">{r.student.fullName.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold text-slate-900">{r.student.fullName}</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Roll No {r.student.rollNumber ?? '—'} · {r.student.batch?.name ?? 'No batch'}{r.student.program ? ` · ${r.student.program}` : ''}{r.student.classLevel ? ` · ${r.student.classLevel}` : ''}
            </p>
            {r.student.status !== 'ACTIVE' && <span className="mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-slate-600 uppercase">{r.student.status.toLowerCase()}</span>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:flex lg:gap-3">
          <HeadStat label="Overall Score" value={pct(s.overallPercent)} extra={<GradePill grade={s.grade} />} />
          <HeadStat label="Batch Rank" value={s.batchRank ? `#${s.batchRank.rank}` : '—'} extra={s.batchRank && <span className="text-[11px] font-semibold text-emerald-700">Top {s.batchRank.topPercent}%</span>} />
          <HeadStat label="Behavior Score" value={s.behaviourScore === null ? '—' : `${s.behaviourScore}`} extra={<span className="text-[11px] text-slate-500">/ 5</span>} icon={<Star className="size-3.5 text-amber-500" />} />
          <HeadStat label="Attendance" value={pct(s.attendanceRate)} extra={<span className="text-[11px] text-slate-500">{s.ptmMeetings} PTM</span>} icon={<ClipboardCheck className="size-3.5 text-sky-500" />} />
        </div>
      </div>
    </section>
  )
}

function HeadStat({ label, value, extra, icon }: { label: string; value: string; extra?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-50 px-4 py-3 lg:min-w-[128px]">
      <p className="flex items-center gap-1 text-[10px] font-bold tracking-wider text-slate-500 uppercase">{icon}{label}</p>
      <p className="mt-1 flex items-baseline gap-2 text-xl font-bold text-slate-900 tabular-nums">{value} {extra}</p>
    </div>
  )
}

/** Search by name, roll or admission number; the API returns only students this person may open. */
function StudentPicker({ base, selected, onPick, disabled }: { base: string; selected: StudentReport | null; onPick: (id: string | null) => void; disabled?: boolean }) {
  const [text, setText] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, open, () => setOpen(false))
  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 250)
    return () => clearTimeout(t)
  }, [text])
  const hits = useStudentSearch(base, debounced, open)
  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <label htmlFor="sr-student" className="sr-only">Search student</label>
      <div className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 shadow-sm focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100">
        <Search className="size-4 shrink-0 text-slate-400" />
        <input
          id="sr-student"
          value={open ? text : selected ? `${selected.student.fullName}${selected.student.rollNumber ? ` (${selected.student.rollNumber})` : ''}` : text}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setText(e.target.value); setOpen(true) }}
          placeholder="Search student by name, roll or admission number…"
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls="sr-student-list"
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
        />
        {selected && !open && (
          <button type="button" onClick={() => { onPick(null); setText('') }} aria-label="Clear student" className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-4" /></button>
        )}
      </div>
      {open && (
        <ul id="sr-student-list" role="listbox" className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-[0_10px_30px_-10px_rgba(15,23,42,0.25)]">
          {hits.isLoading ? (
            <li className="px-3 py-3 text-xs text-slate-400">Searching…</li>
          ) : hits.error ? (
            <li className="px-3 py-3 text-xs text-red-600">{hits.error.message}</li>
          ) : !hits.data?.length ? (
            <li className="px-3 py-3 text-xs text-slate-400">{debounced ? 'No students match' : 'No students yet'}</li>
          ) : (
            hits.data.map((s) => (
              <li key={s.id} role="option" aria-selected={selected?.student.id === s.id}>
                <button type="button" onClick={() => { onPick(s.id); setOpen(false); setText('') }} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50">
                  <span className="min-w-0"><span className="block truncate font-semibold text-slate-800">{s.fullName}</span><span className="block truncate text-[11px] text-slate-500">Roll {s.rollNumber ?? '—'} · {s.batch?.name ?? 'No batch'}</span></span>
                  {s.status !== 'ACTIVE' && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 uppercase">{s.status.toLowerCase()}</span>}
                </button>
              </li>
            ))
          )}
          {!!hits.data?.length && hits.data.length >= 20 && <li className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-400">Showing the first 20; type more to narrow it down.</li>}
        </ul>
      )}
    </div>
  )
}

function SheetExportDialog({ r, onClose }: { r: StudentReport; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run(format: 'xlsx' | 'csv') {
    setBusy(true)
    setError(null)
    try {
      if (format === 'xlsx') await exportReportXlsx(r)
      else exportReportCsv(r)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export')
      setBusy(false)
    }
  }
  return (
    <Dialog title="Export 5-in-1 report" description={`${r.student.fullName} · ${r.year.label}`} onClose={onClose} widthClass="max-w-md">
      <div className="space-y-3 px-6 py-5">
        <p className="text-xs text-slate-500">Every section of the report, without contact details. Excel has one sheet per section; CSV puts them one after another.</p>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" disabled={busy} onClick={() => void run('xlsx')} className="flex flex-col items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-4 text-sm font-semibold text-slate-800 hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-60"><FileSpreadsheet className="size-6 text-emerald-600" /> Excel (.xlsx)</button>
          <button type="button" disabled={busy} onClick={() => void run('csv')} className="flex flex-col items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-4 text-sm font-semibold text-slate-800 hover:border-sky-300 hover:bg-sky-50 disabled:opacity-60"><FileText className="size-6 text-sky-600" /> CSV</button>
        </div>
        <ErrorBanner message={error} />
      </div>
    </Dialog>
  )
}
