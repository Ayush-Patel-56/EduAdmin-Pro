import { useEffect, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Award, BarChart3, FileText, Loader2, Pencil, Plus, RefreshCw, Search, Trash2, Trophy, X } from 'lucide-react'
import { api } from '@/lib/api'
import { Dialog } from '@/components/ui/Dialog'
import { ConfirmDialog, ErrorBanner } from '@/components/ui/form'
import { labelClass, textareaClass } from '@/components/ui/formStyles'
import { fileSlug, pct, query, reportsBase, useInvalidateReports, useProgressList, useReportOptions, useRoster, type Grade, type ProgressCard, type ProgressOne, type ReportOptions, type Term } from './api'
import { Empty, GradePill, Kpi, Pager, Spinner } from './ui'
import { selectClass, toolButton } from './styles'

const gradeFor = (scale: ReportOptions['gradeScale'], percent: number | null): Grade | null => (percent === null ? null : (scale.find((g) => percent >= g.min)?.grade ?? 'F'))

/**
 * Student Progress Reports (PRD 4.8 admin, 5.6 faculty): one card per student
 * and term, built from term marks (uploaded sheets or Generate Report), with
 * rank and percentile within the batch worked out on every read.
 */
export function ProgressReports({ schoolId, school }: { schoolId?: string; school: string }) {
  const base = reportsBase(schoolId)
  const options = useReportOptions(base)
  const o = options.data
  const [year, setYear] = useState<number | null>(null)
  const [batchId, setBatchId] = useState('')
  const [term, setTerm] = useState('')
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<ProgressCard | 'new' | null>(null)
  const [deleting, setDeleting] = useState<ProgressCard | null>(null)
  const [ranked, setRanked] = useState<string | null>(null)
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q.trim())
      setPage(1)
    }, 250)
    return () => clearTimeout(t)
  }, [q])
  const list = useProgressList(base, { year, term, batchId, q: debounced, page })
  const invalidate = useInvalidateReports(base)
  const d = list.data

  async function recalculate() {
    await list.refetch()
    setRanked(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()))
  }

  return (
    <>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 sm:text-[26px]">Student Progress Reports</h1>
          <p className="mt-1 text-sm text-slate-500">Term reports with subject marks, grades, rank and percentile within each batch.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void list.refetch()} disabled={list.isFetching} className={toolButton}><RefreshCw className={`size-4 ${list.isFetching ? 'animate-spin' : ''}`} /> Refresh</button>
          <button type="button" onClick={() => void recalculate()} disabled={list.isFetching} className={toolButton}><BarChart3 className="size-4" /> Recalculate Ranks</button>
          {o?.canWrite && <button type="button" onClick={() => setEditing('new')} className="inline-flex h-10 items-center gap-2 rounded-lg bg-ink px-4 text-sm font-semibold text-white shadow-sm hover:bg-ink-hover"><Plus className="size-4" /> Generate Report</button>}
        </div>
      </div>
      {ranked && <p className="mt-3 text-xs text-emerald-700">Ranks and percentiles recalculated from the current marks at {ranked} IST.</p>}
      <ErrorBanner message={list.error?.message ?? options.error?.message} />

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Kpi icon={FileText} iconClass="bg-sky-50 text-sky-600" value={d?.kpis.total} label="Total Reports" sub={d ? d.year.label : ' '} />
        <Kpi icon={Award} iconClass="bg-emerald-50 text-emerald-600" value={d ? pct(d.kpis.average) : undefined} label="Average %" sub="across the reports in view" />
        <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <span className="flex size-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600"><Trophy className="size-[18px]" /></span>
          <p className="mt-3 text-sm font-semibold text-slate-700">Top Rankers</p>
          {!d ? <p className="mt-1 text-2xl font-bold text-slate-900">—</p> : d.kpis.toppers.length === 0 ? <p className="mt-1 text-xs text-slate-400">No reports yet</p> : (
            <ol className="mt-1.5 space-y-1">
              {d.kpis.toppers.map((t, i) => (
                <li key={`${t.student.id}|${t.term}`} className="flex items-center gap-2 text-xs"><span className="w-7 font-bold text-amber-700">{['1st', '2nd', '3rd'][i]}</span><span className="min-w-0 flex-1 truncate font-semibold text-slate-800">{t.student.fullName}</span><span className="text-slate-500 tabular-nums">{pct(t.percent)}</span></li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-2 lg:flex-row">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search students</span>
          <Search className="pointer-events-none absolute top-3 left-3 size-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search student name or roll number" className="h-10 w-full rounded-lg border border-slate-200 bg-white pr-3 pl-9 text-sm shadow-sm focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 focus:outline-none" />
        </label>
        <div className="flex flex-wrap gap-2">
          <select aria-label="Batch" value={batchId} onChange={(e) => { setBatchId(e.target.value); setPage(1) }} className={selectClass}><option value="">All batches</option>{o?.batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <select aria-label="Term" value={term} onChange={(e) => { setTerm(e.target.value); setPage(1) }} className={selectClass}><option value="">All terms</option>{o?.terms.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
          <select aria-label="Academic year" value={year ?? o?.currentYear ?? ''} onChange={(e) => { setYear(Number(e.target.value)); setPage(1) }} className={selectClass}>{o?.years.map((y) => <option key={y.year} value={y.year}>{y.label}</option>)}</select>
        </div>
      </div>

      <div className="mt-4">
        {!d ? (
          !list.error && <Spinner />
        ) : d.items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white">
            <Empty icon={Award} title={debounced || batchId || term ? 'No reports match these filters' : 'No progress reports yet'} sub={o?.canWrite ? 'Generate a report, or upload a sheet of term marks from Student Reports.' : undefined} />
          </div>
        ) : (
          <div className="space-y-4">
            {d.items.map((c) => <ReportCard key={`${c.student.id}|${c.term}`} c={c} school={school} canWrite={!!o?.canWrite} onEdit={() => setEditing(c)} onDelete={() => setDeleting(c)} />)}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><Pager page={page} pageSize={d.pageSize} total={d.total} onPage={setPage} /></div>
          </div>
        )}
      </div>

      {editing && o && <ReportDialog base={base} options={o} card={editing === 'new' ? null : editing} year={year ?? o.currentYear} onSaved={invalidate} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDialog
          title="Delete this progress report?"
          message={<p>{deleting.student.fullName}’s {deleting.termLabel} report is deleted: its {deleting.subjects?.length ?? 0} subject mark{deleting.subjects?.length === 1 ? '' : 's'} (including any from an uploaded sheet) and the remarks. Other students’ ranks are recalculated. This can’t be undone.</p>}
          confirmLabel="Delete report"
          onConfirm={async () => {
            await api(`${base}/progress-reports?${query({ studentId: deleting.student.id, year: deleting.year, term: deleting.term })}`, { method: 'DELETE' })
            await invalidate()
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  )
}

function ReportCard({ c, school, canWrite, onEdit, onDelete }: { c: ProgressCard; school: string; canWrite: boolean; onEdit: () => void; onDelete: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-base font-bold text-slate-900">{c.student.fullName}</p>
          <p className="mt-0.5 text-xs text-slate-500">Roll {c.student.rollNumber ?? '—'} · {c.batch.name} · {c.termLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-slate-50 px-3 py-1.5 text-sm font-bold text-slate-900 tabular-nums">{pct(c.percent, 2)}</span>
          <GradePill grade={c.grade} />
          <span className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-bold text-amber-800">Rank {c.rank} / {c.of}</span>
          <span className="rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs font-bold text-indigo-700">{c.percentile} percentile</span>
        </div>
      </div>
      <div className="grid gap-5 px-5 py-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[360px] text-left text-sm">
            <thead className="text-[10px] tracking-wider text-slate-500 uppercase"><tr><th className="py-1.5 pr-3">Subject</th><th className="py-1.5 pr-3">Obtained</th><th className="py-1.5 pr-3">Total</th><th className="py-1.5 pr-3">%</th><th className="py-1.5">Grade</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {c.subjects?.map((s) => (
                <tr key={s.subject}><td className="py-2 pr-3 font-medium text-slate-800">{s.subject}</td><td className="py-2 pr-3 tabular-nums">{s.marks}</td><td className="py-2 pr-3 tabular-nums">{s.maxMarks}</td><td className="py-2 pr-3 tabular-nums">{pct(s.percent)}</td><td className="py-2"><GradePill grade={s.grade} /></td></tr>
              ))}
              <tr className="font-bold"><td className="py-2 pr-3 text-slate-900">Total</td><td className="py-2 pr-3 tabular-nums">{c.marks}</td><td className="py-2 pr-3 tabular-nums">{c.maxMarks}</td><td className="py-2 pr-3 tabular-nums">{pct(c.percent, 2)}</td><td className="py-2"><GradePill grade={c.grade} /></td></tr>
            </tbody>
          </table>
        </div>
        <div className="space-y-3 text-sm">
          <Remark label="Teacher remarks" text={c.teacherRemarks} />
          <Remark label="Principal remarks" text={c.principalRemarks} />
          <p className="text-[11px] text-slate-400">Reported by {c.reportedBy ?? '—'}</p>
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">
        {canWrite && <button type="button" onClick={onEdit} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Pencil className="size-3.5" /> Edit</button>}
        {canWrite && <button type="button" onClick={onDelete} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-200 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50"><Trash2 className="size-3.5" /> Delete</button>}
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await progressPdf(c, school) } finally { setBusy(false) } }} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />} Export PDF
        </button>
      </div>
    </article>
  )
}

const Remark = ({ label, text }: { label: string; text: string | null | undefined }) => (
  <div>
    <p className={labelClass}>{label}</p>
    <p className={`whitespace-pre-line ${text ? 'text-slate-800' : 'text-slate-400'}`}>{text || '—'}</p>
  </div>
)

/** One progress report as an A4 page. */
async function progressPdf(c: ProgressCard, school: string) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  doc.setFontSize(15)
  doc.text(school, 40, 44)
  doc.setFontSize(11)
  doc.setTextColor(90)
  doc.text(`Progress Report · ${c.termLabel} · ${c.year}-${String((c.year + 1) % 100).padStart(2, '0')}`, 40, 62)
  doc.setTextColor(20)
  doc.setFontSize(12.5)
  doc.text(`${c.student.fullName}${c.student.rollNumber ? ` (Roll ${c.student.rollNumber})` : ''} · ${c.batch.name}`, 40, 88)
  autoTable(doc, {
    startY: 104,
    head: [['Subject', 'Obtained', 'Total', '%', 'Grade']],
    body: [...(c.subjects ?? []).map((s) => [s.subject, String(s.marks), String(s.maxMarks), pct(s.percent), s.grade ?? '—']), ['Total', String(c.marks), String(c.maxMarks), pct(c.percent, 2), c.grade ?? '—']],
    styles: { fontSize: 9.5, cellPadding: 5 },
    headStyles: { fillColor: [15, 23, 42] },
    didParseCell: (data) => { if (data.row.index === (c.subjects?.length ?? 0)) data.cell.styles.fontStyle = 'bold' },
    margin: { left: 40, right: 40 },
  })
  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 22
  doc.setFontSize(10.5)
  doc.text(`Rank ${c.rank} of ${c.of} in ${c.batch.name} · ${c.percentile} percentile`, 40, y)
  y += 24
  const width = doc.internal.pageSize.getWidth() - 80
  for (const [label, text] of [['Teacher remarks', c.teacherRemarks], ['Principal remarks', c.principalRemarks]] as const) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text(label, 40, y)
    doc.setFont('helvetica', 'normal')
    y += 15
    for (const line of doc.splitTextToSize(text || '—', width) as string[]) {
      doc.text(line, 40, y)
      y += 13
    }
    y += 10
  }
  doc.setFontSize(8)
  doc.setTextColor(130)
  doc.text(`Reported by ${c.reportedBy ?? '—'}`, 40, doc.internal.pageSize.getHeight() - 28)
  doc.save(`progress-report-${fileSlug(c.student.fullName)}-${fileSlug(c.termLabel)}-${c.year}.pdf`)
}

type Row = { subject: string; marks: string; maxMarks: string }

/**
 * Generate / Edit Progress Report: batch, student and term first; then the
 * subject marks rows (auto grade) and both remarks, filled in from the report
 * already there (editing, or generating one that exists).
 */
function ReportDialog({ base, options, card, year: initialYear, onSaved, onClose }: { base: string; options: ReportOptions; card: ProgressCard | null; year: number; onSaved: () => Promise<unknown>; onClose: () => void }) {
  const [batchId, setBatchId] = useState(card?.batch.id ?? '')
  const [studentId, setStudentId] = useState(card?.student.id ?? '')
  const [term, setTerm] = useState<Term | ''>(card?.term ?? '')
  const [year, setYear] = useState(card?.year ?? initialYear)
  const roster = useRoster(base, card ? '' : batchId)
  const key = studentId && term ? { studentId, year, term } : null
  const existing = useQuery({ queryKey: [base, 'progress-one', key], queryFn: () => api<ProgressOne>(`${base}/progress-reports/one?${query(key!)}`), enabled: !!key, staleTime: 0, gcTime: 0 })
  const loaded = key && existing.data && existing.data.student.id === key.studentId && !existing.isFetching ? existing.data : null
  return (
    <Dialog title={card ? 'Edit Progress Report' : 'Generate Progress Report'} description={card ? `${card.student.fullName} · ${card.termLabel}` : 'Subject marks for a term, with remarks'} onClose={onClose} widthClass="max-w-2xl">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
        {!card && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label htmlFor="pr-batch" className={labelClass}>Batch / Class *</label><select id="pr-batch" value={batchId} onChange={(e) => { setBatchId(e.target.value); setStudentId('') }} className={`${selectClass} w-full`}><option value="">Select batch</option>{options.batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
            <div><label htmlFor="pr-student" className={labelClass}>Student *</label><select id="pr-student" value={studentId} onChange={(e) => setStudentId(e.target.value)} disabled={!batchId} className={`${selectClass} w-full`}><option value="">{batchId ? (roster.isLoading ? 'Loading…' : 'Select student') : 'Select a batch first'}</option>{roster.data?.map((s) => <option key={s.id} value={s.id}>{s.fullName}{s.rollNumber ? ` (${s.rollNumber})` : ''}</option>)}</select></div>
            <div><label htmlFor="pr-term" className={labelClass}>Term Type *</label><select id="pr-term" value={term} onChange={(e) => setTerm(e.target.value as Term)} className={`${selectClass} w-full`}><option value="">Select term</option>{options.terms.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></div>
            <div><label htmlFor="pr-year" className={labelClass}>Academic year</label><select id="pr-year" value={year} onChange={(e) => setYear(Number(e.target.value))} className={`${selectClass} w-full`}>{options.years.map((y) => <option key={y.year} value={y.year}>{y.label}</option>)}</select></div>
          </div>
        )}
        <ErrorBanner message={existing.error?.message} />
        {!key ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500">Pick the student and term to enter their subject marks.</p>
        ) : !loaded ? (
          !existing.error && <p className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="size-3.5 animate-spin" /> Loading the report…</p>
        ) : (
          <MarksForm key={`${key.studentId}|${key.term}|${key.year}`} base={base} options={options} report={loaded} keyOf={key} isNew={!card} onSaved={onSaved} onClose={onClose} />
        )}
      </div>
    </Dialog>
  )
}

const numberOk = (s: string) => /^\d+(\.\d{1,2})?$/.test(s.trim())

function MarksForm({ base, options, report, keyOf, isNew, onSaved, onClose }: { base: string; options: ReportOptions; report: ProgressOne; keyOf: { studentId: string; year: number; term: Term }; isNew: boolean; onSaved: () => Promise<unknown>; onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>(() => (report.exists ? report.subjects.map((s) => ({ subject: s.subject, marks: String(s.marks), maxMarks: String(s.maxMarks) })) : [{ subject: '', marks: '', maxMarks: '100' }]))
  const [teacherRemarks, setTeacherRemarks] = useState(report.teacherRemarks ?? '')
  const [principalRemarks, setPrincipalRemarks] = useState(report.principalRemarks ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (i: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
    setError(null)
  }
  const used = new Set(rows.map((r) => r.subject))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!rows.length) return setError('Add at least one subject')
    for (const r of rows) {
      if (!r.subject) return setError('Select each subject')
      if (!numberOk(r.marks) || !numberOk(r.maxMarks)) return setError(`${r.subject}: enter marks as numbers with up to two decimals`)
      if (Number(r.maxMarks) <= 0) return setError(`${r.subject}: total marks must be more than 0`)
      if (Number(r.marks) > Number(r.maxMarks)) return setError(`${r.subject}: marks obtained can’t be more than the total`)
    }
    if (new Set(rows.map((r) => r.subject)).size !== rows.length) return setError('Each subject can be on the report once')
    setBusy(true)
    try {
      await api(`${base}/progress-reports`, {
        method: 'PUT',
        body: JSON.stringify({ ...keyOf, subjects: rows.map((r) => ({ subject: r.subject, marks: Number(r.marks), maxMarks: Number(r.maxMarks) })), teacherRemarks, principalRemarks }),
      })
      await onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
      setBusy(false)
    }
  }

  const total = rows.reduce((a, r) => a + (numberOk(r.marks) ? Number(r.marks) : 0), 0)
  const max = rows.reduce((a, r) => a + (numberOk(r.maxMarks) ? Number(r.maxMarks) : 0), 0)
  const overall = max > 0 ? Math.round((total / max) * 10000) / 100 : null
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {isNew && report.exists && <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">{report.student.fullName} already has a report for this term; it’s filled in below and saving updates it.</p>}
      <div>
        <p className={labelClass}>Subject marks *</p>
        <div className="space-y-2">
          {rows.map((r, i) => {
            const p = numberOk(r.marks) && numberOk(r.maxMarks) && Number(r.maxMarks) > 0 ? Math.round((Number(r.marks) / Number(r.maxMarks)) * 10000) / 100 : null
            return (
              <div key={i} className="grid grid-cols-[1fr_72px_72px_44px_32px] items-center gap-2">
                <select aria-label="Subject" value={r.subject} onChange={(e) => set(i, { subject: e.target.value })} className={`${selectClass} min-w-0`}><option value="">Subject</option>{options.subjects.filter((s) => s === r.subject || !used.has(s)).map((s) => <option key={s} value={s}>{s}</option>)}</select>
                <input aria-label="Obtained" inputMode="decimal" value={r.marks} onChange={(e) => set(i, { marks: e.target.value })} placeholder="Obtained" className={`${selectClass} min-w-0 px-2`} />
                <input aria-label="Total" inputMode="decimal" value={r.maxMarks} onChange={(e) => set(i, { maxMarks: e.target.value })} placeholder="Total" className={`${selectClass} min-w-0 px-2`} />
                <GradePill grade={gradeFor(options.gradeScale, p)} />
                <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} disabled={rows.length === 1} aria-label="Remove subject" className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"><X className="size-4" /></button>
              </div>
            )
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={() => setRows((rs) => [...rs, { subject: '', marks: '', maxMarks: '100' }])} disabled={rows.length >= options.subjects.length} className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline disabled:opacity-40"><Plus className="size-3.5" /> Add Subject</button>
          <span className="text-xs text-slate-500">Total {Math.round(total * 100) / 100} / {max} · {pct(overall, 2)} <GradePill grade={gradeFor(options.gradeScale, overall)} className="ml-1" /></span>
        </div>
      </div>
      <div><label htmlFor="pr-teacher" className={labelClass}>Teacher Remarks</label><textarea id="pr-teacher" rows={2} maxLength={1000} value={teacherRemarks} onChange={(e) => setTeacherRemarks(e.target.value)} className={textareaClass()} placeholder="Progress, strengths, what to work on" /></div>
      <div><label htmlFor="pr-principal" className={labelClass}>Principal Remarks</label><textarea id="pr-principal" rows={2} maxLength={1000} value={principalRemarks} onChange={(e) => setPrincipalRemarks(e.target.value)} className={textareaClass()} /></div>
      <p className="text-[11px] text-slate-400">Subjects removed here are deleted from the term’s marks; attendance and remarks from an uploaded sheet stay with the subjects kept.</p>
      <ErrorBanner message={error} />
      <div className="grid grid-cols-2 gap-3 pt-1">
        <button type="button" onClick={onClose} className="h-11 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
        <button type="submit" disabled={busy} className="h-11 rounded-xl bg-ink text-sm font-semibold text-white hover:bg-ink-hover disabled:opacity-60">{busy ? 'Saving…' : isNew ? 'Generate Report' : 'Save Changes'}</button>
      </div>
    </form>
  )
}
