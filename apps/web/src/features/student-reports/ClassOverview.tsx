import { useEffect, useState } from 'react'
import { Award, Download, FileSpreadsheet, Search, Trash2, TrendingUp, Upload, UsersRound } from 'lucide-react'
import { api } from '@/lib/api'
import { downloadFile, toCsv } from '@/lib/spreadsheet'
import { Dialog } from '@/components/ui/Dialog'
import { ExportDialog } from '@/components/ui/ExportDialog'
import { ConfirmDialog, ErrorBanner } from '@/components/ui/form'
import { dayLabel, fileSlug, pct, query, useClassOverview, useInvalidateReports, useMarkSet, useMarkSets, useReportOptions, type ClassOverview as Overview, type MarkSet, type Term } from './api'
import { ImportMarksDialog } from './ImportMarksDialog'
import { Card, Empty, GradePill, Kpi, Meter, Pager, Spinner } from './ui'
import { selectClass, toneOf, toolButton } from './styles'

const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#a855f7', '#14b8a6', '#64748b']

/** Uploaded Reports Overview (PRD 4.5 / 5.4): the report sheets and class analytics over them. */
export function ClassOverview({ base, school }: { base: string; school: string }) {
  const options = useReportOptions(base)
  const o = options.data
  const [year, setYear] = useState<number | null>(null)
  const [batchId, setBatchId] = useState('')
  const [term, setTerm] = useState('')
  const [subject, setSubject] = useState('')
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [uploading, setUploading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [open, setOpen] = useState<MarkSet | null>(null)
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q.trim())
      setPage(1)
    }, 250)
    return () => clearTimeout(t)
  }, [q])
  const filters = { year, batchId, term, subject }
  const overview = useClassOverview(base, filters)
  const sets = useMarkSets(base, { ...filters, q: debounced, page })
  const v = overview.data
  const teacher = base.startsWith('/teacher')

  async function exportOverview(format: 'pdf' | 'csv') {
    if (!v) return
    // Every sheet in the filters, a page at a time (the list is paged by the API).
    const all: MarkSet[] = []
    for (let p = 1; p <= 50; p++) {
      const part = await api<{ items: MarkSet[]; total: number; pageSize: number }>(`${base}/marks/sets?${query({ ...filters, q: debounced, page: p })}`)
      all.push(...part.items)
      if (p * part.pageSize >= part.total) break
    }
    const label = [o?.years.find((y) => y.year === (year ?? o?.currentYear))?.label, o?.batches.find((b) => b.id === batchId)?.name ?? 'All classes', o?.terms.find((t) => t.key === term)?.label ?? 'All terms', subject || 'All subjects'].filter(Boolean).join(' · ')
    const rows = all.map((s) => [s.batch.name, s.termLabel, s.subject, s.students, s.average, s.grade, s.highest, s.lowest, s.enteredBy, dayLabel(s.updatedAt.slice(0, 10))])
    const header = ['Class', 'Term', 'Subject', 'Students', 'Average %', 'Grade', 'Highest %', 'Lowest %', 'Entered by', 'Updated']
    if (format === 'csv') {
      downloadFile(`uploaded-reports-${fileSlug(school)}-${v.year.label}.csv`, toCsv([[label], header, ...rows, [], ['Subject', 'Average %', 'Students', 'Needs attention'], ...v.subjectAverages.map((s) => [s.subject, s.average, s.students, s.needsAttention ? 'Yes' : 'No'])]))
      return
    }
    const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
    doc.setFontSize(15)
    doc.text(`${school}: Uploaded Reports Overview`, 40, 40)
    doc.setFontSize(9)
    doc.setTextColor(100)
    doc.text(`${label} · ${v.kpis.students} student(s), ${v.kpis.sets} sheet(s), class average ${pct(v.kpis.average)}`, 40, 56)
    autoTable(doc, { startY: 70, head: [header], body: rows.map((r) => r.map((c) => (c === null ? '—' : String(c)))), styles: { fontSize: 8 }, headStyles: { fillColor: [15, 23, 42] }, margin: { left: 40, right: 40 } })
    const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18
    autoTable(doc, { startY: y, head: [['Subject', 'Average %', 'Grade', 'Students', 'Needs attention (<65%)']], body: v.subjectAverages.map((s) => [s.subject, String(s.average), s.grade ?? '—', String(s.students), s.needsAttention ? 'Yes' : 'No']), styles: { fontSize: 8 }, headStyles: { fillColor: [15, 23, 42] }, margin: { left: 40, right: 40 } })
    doc.save(`uploaded-reports-${fileSlug(school)}-${v.year.label}.pdf`)
  }

  return (
    <>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap gap-2">
          <select aria-label="Academic year" value={year ?? o?.currentYear ?? ''} onChange={(e) => { setYear(Number(e.target.value)); setPage(1) }} className={selectClass}>{o?.years.map((y) => <option key={y.year} value={y.year}>{y.label}</option>)}</select>
          <select aria-label="Class" value={batchId} onChange={(e) => { setBatchId(e.target.value); setPage(1) }} className={selectClass}><option value="">All classes</option>{o?.batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <select aria-label="Term" value={term} onChange={(e) => { setTerm(e.target.value); setPage(1) }} className={selectClass}><option value="">All terms</option>{o?.terms.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
          <select aria-label="Subject" value={subject} onChange={(e) => { setSubject(e.target.value); setPage(1) }} className={selectClass}><option value="">All subjects</option>{o?.subjects.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setExporting(true)} disabled={!v || !sets.data?.total} className={toolButton}><Download className="size-4" /> Export</button>
          {o?.canWrite && <button type="button" onClick={() => setUploading(true)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-ink px-4 text-sm font-semibold text-white shadow-sm hover:bg-ink-hover"><Upload className="size-4" /> {teacher ? 'Upload Report' : 'Import Student Report'}</button>}
        </div>
      </div>
      <ErrorBanner message={overview.error?.message ?? sets.error?.message ?? options.error?.message} />

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <Kpi icon={UsersRound} iconClass="bg-sky-50 text-sky-600" value={v?.kpis.students} label="Students reported" sub={v ? v.year.label : ' '} />
        <Kpi icon={FileSpreadsheet} iconClass="bg-emerald-50 text-emerald-600" value={v?.kpis.sets} label="Report sheets" sub="one per class, term and subject" />
        <Kpi icon={Award} iconClass="bg-amber-50 text-amber-600" value={v ? <span className="inline-flex items-center gap-2">{pct(v.kpis.average)} <GradePill grade={v.kpis.grade} /></span> : undefined} label="Class average" sub="of every student's percentage" />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <div className="min-w-0 space-y-5 xl:col-span-2">
          <Card title="Class Performance Trend" sub="Average % by subject across the year's terms">
            {!v ? <Spinner /> : v.trend.length === 0 ? <Empty icon={TrendingUp} title="No report sheets yet" sub="Upload a sheet of term marks to see the trend." /> : <TrendChart overview={v} />}
          </Card>
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">{teacher ? 'Recent Reports' : 'Uploaded Reports'}</h3>
                <p className="mt-0.5 text-xs text-slate-500">{sets.data ? `${sets.data.total} sheet${sets.data.total === 1 ? '' : 's'}` : 'Loading…'}</p>
              </div>
              <label className="relative">
                <span className="sr-only">Search reports</span>
                <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search class or subject" className="h-9 w-full rounded-lg border border-slate-200 pr-3 pl-9 text-sm focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 focus:outline-none sm:w-56" />
              </label>
            </div>
            {!sets.data ? (
              <Spinner />
            ) : sets.data.items.length === 0 ? (
              <Empty icon={FileSpreadsheet} title="No report sheets match" sub={o?.canWrite ? 'Upload a sheet of term marks (Name, Roll No, Marks, Max Marks).' : undefined} />
            ) : (
              <>
                <ul className="divide-y divide-slate-100">
                  {sets.data.items.map((s) => (
                    <li key={`${s.batch.id}|${s.term}|${s.subject}`}>
                      <button type="button" onClick={() => setOpen(s)} className="flex w-full flex-col gap-2 px-5 py-3.5 text-left hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">{s.subject} · {s.termLabel}</p>
                          <p className="mt-0.5 truncate text-xs text-slate-500">{s.batch.name} · {s.students} student{s.students === 1 ? '' : 's'} · {s.source === 'MANUAL' ? 'from progress reports' : 'uploaded'} by {s.enteredBy} · {dayLabel(s.updatedAt.slice(0, 10))}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <div className="w-28"><Meter value={s.average} tone={toneOf(s.average)} /></div>
                          <span className="w-14 text-right text-sm font-bold text-slate-900 tabular-nums">{pct(s.average)}</span>
                          <GradePill grade={s.grade} />
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
                <Pager page={page} pageSize={sets.data.pageSize} total={sets.data.total} onPage={setPage} />
              </>
            )}
          </section>
        </div>
        <div className="min-w-0 space-y-5">
          <Card title="Top Performers" sub="By overall percentage in these filters">
            {!v ? <Spinner /> : v.topPerformers.length === 0 ? <p className="text-xs text-slate-400">No marks yet.</p> : (
              <ol className="space-y-3">
                {v.topPerformers.map((t, i) => (
                  <li key={t.student.id} className="flex items-center gap-3">
                    <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i === 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{i + 1}</span>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-800">{t.student.fullName}</p><p className="truncate text-[11px] text-slate-500">{t.student.rollNumber ? `Roll ${t.student.rollNumber} · ` : ''}{t.student.batch ?? 'No batch'}</p></div>
                    <span className="text-sm font-bold text-slate-900 tabular-nums">{pct(t.percent)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <Card title="Needs Attention" sub={`Subjects averaging below ${o?.needsAttentionPercent ?? 65}%`}>
            {!v ? <Spinner /> : v.needsAttention.length === 0 ? <p className="text-xs text-slate-400">{v.subjectAverages.length ? `Every subject averages ${o?.needsAttentionPercent ?? 65}% or more.` : 'No marks yet.'}</p> : (
              <ul className="space-y-3">
                {v.needsAttention.map((s) => (
                  <li key={s.subject}>
                    <div className="mb-1 flex justify-between text-sm"><span className="font-semibold text-slate-800">{s.subject}</span><span className="text-xs font-bold text-rose-700 tabular-nums">{pct(s.average)}</span></div>
                    <Meter value={s.average} tone={toneOf(s.average)} />
                    <p className="mt-0.5 text-[11px] text-slate-500">{s.students} student{s.students === 1 ? '' : 's'}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Mistake Analysis" sub="Test topics most often wrong or skipped this year">
            {!v ? <Spinner /> : v.mistakes.length === 0 ? <p className="text-xs text-slate-400">Shown once tests are graded question by question.</p> : (
              <ul className="space-y-3">
                {v.mistakes.map((m) => (
                  <li key={`${m.subject}|${m.topic}`} className="text-sm">
                    <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-semibold text-slate-800">{m.topic}</p><p className="text-[11px] text-slate-500">{m.subject} · {m.wrong} wrong · {m.skipped} skipped of {m.answers}</p></div><span className="shrink-0 text-xs font-bold text-rose-700 tabular-nums">{pct(m.missRate)}</span></div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {uploading && o && <ImportMarksDialog base={base} options={o} onClose={() => setUploading(false)} />}
      {exporting && <ExportDialog title="Export uploaded reports" onClose={() => setExporting(false)} onExport={exportOverview} />}
      {open && <SetDialog base={base} set={open} year={v?.year.year ?? o?.currentYear ?? 0} canDelete={!!o?.canDeleteSheets} onClose={() => setOpen(null)} />}
    </>
  )
}

function TrendChart({ overview }: { overview: Overview }) {
  const W = 640
  const H = 220
  const pad = { l: 36, r: 12, t: 12, b: 28 }
  const xs = overview.trend.map((_, i) => (overview.trend.length === 1 ? (W + pad.l - pad.r) / 2 : pad.l + (i * (W - pad.l - pad.r)) / (overview.trend.length - 1)))
  const y = (p: number) => pad.t + ((100 - Math.max(0, Math.min(100, p))) * (H - pad.t - pad.b)) / 100
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Average percentage by subject and term">
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} stroke="#e2e8f0" strokeDasharray={g === 0 ? undefined : '3 3'} />
            <text x={pad.l - 6} y={y(g) + 3} textAnchor="end" fontSize="10" fill="#94a3b8">{g}</text>
          </g>
        ))}
        {overview.trend.map((t, i) => <text key={t.term} x={xs[i]} y={H - 8} textAnchor="middle" fontSize="11" fill="#64748b">{t.label}</text>)}
        {overview.subjects.map((s, si) => {
          const points = overview.trend.flatMap((t, i) => (t.subjects[s] === undefined ? [] : [[xs[i], y(t.subjects[s]), t.subjects[s], t.label] as const]))
          const color = PALETTE[si % PALETTE.length]
          return (
            <g key={s}>
              {points.length > 1 && <polyline fill="none" stroke={color} strokeWidth="2.5" points={points.map(([x, py]) => `${x},${py}`).join(' ')} />}
              {points.map(([x, py, p, label]) => <circle key={label} cx={x} cy={py} r="4" fill="white" stroke={color} strokeWidth="2.5"><title>{`${s} · ${label}: ${p}%`}</title></circle>)}
            </g>
          )
        })}
      </svg>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        {overview.subjects.map((s, i) => <span key={s} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />{s}</span>)}
      </p>
    </div>
  )
}

/** One sheet's rows, with Delete for a sheet uploaded to the wrong class, term or subject. */
function SetDialog({ base, set, year, canDelete, onClose }: { base: string; set: MarkSet; year: number; canDelete: boolean; onClose: () => void }) {
  const key = { batchId: set.batch.id, year, term: set.term as Term, subject: set.subject }
  const rows = useMarkSet(base, key)
  const invalidate = useInvalidateReports(base)
  const [deleting, setDeleting] = useState(false)
  return (
    <Dialog title={`${set.subject} · ${set.termLabel}`} description={`${set.batch.name} · ${set.students} students · average ${pct(set.average)}`} onClose={onClose} widthClass="max-w-3xl">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {rows.error ? <ErrorBanner message={rows.error.message} /> : !rows.data ? <Spinner /> : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-slate-50 text-[10px] tracking-wider text-slate-500 uppercase"><tr><th className="px-3 py-2">Roll</th><th className="px-3 py-2">Student</th><th className="px-3 py-2">Marks</th><th className="px-3 py-2">%</th><th className="px-3 py-2">Grade</th><th className="px-3 py-2">Attendance</th><th className="px-3 py-2">Remarks</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.data.map((r) => (
                  <tr key={r.student.id}>
                    <td className="px-3 py-2 text-xs text-slate-500">{r.student.rollNumber ?? '—'}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">{r.student.fullName}</td>
                    <td className="px-3 py-2 tabular-nums">{r.marks} / {r.maxMarks}</td>
                    <td className="px-3 py-2 tabular-nums">{pct(r.percent)}</td>
                    <td className="px-3 py-2"><GradePill grade={r.grade} /></td>
                    <td className="px-3 py-2 tabular-nums">{pct(r.attendance, 0)}</td>
                    <td className="max-w-[220px] truncate px-3 py-2 text-xs text-slate-600" title={r.remarks ?? undefined}>{r.remarks ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="flex justify-between gap-3 border-t border-slate-100 px-6 py-4">
        {canDelete ? <button type="button" onClick={() => setDeleting(true)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-rose-200 px-3.5 text-sm font-semibold text-rose-700 hover:bg-rose-50"><Trash2 className="size-4" /> Delete sheet</button> : <span />}
        <button type="button" onClick={onClose} className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">Close</button>
      </div>
      {deleting && (
        <ConfirmDialog
          title="Delete this report sheet?"
          message={<p>The {set.subject} marks of {set.batch.name} for {set.termLabel} ({set.students} student{set.students === 1 ? '' : 's'}) are deleted, along with those students’ progress-report remarks for the term if no other subject is left. This can’t be undone.</p>}
          confirmLabel="Delete sheet"
          onConfirm={async () => {
            await api(`${base}/marks/set?${query(key)}`, { method: 'DELETE' })
            await invalidate()
            onClose()
          }}
          onClose={() => setDeleting(false)}
        />
      )}
    </Dialog>
  )
}

