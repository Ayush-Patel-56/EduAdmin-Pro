import { useRef, useState } from 'react'
import { Check, Download, Folder, Info, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { MAX_IMPORT_ROWS, readSpreadsheet, rowsToRecords } from '@/lib/spreadsheet'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner } from '@/components/ui/form'
import { labelClass } from '@/components/ui/formStyles'
import { ImportPreviewTable } from '@/features/academic/ImportPreviewTable'
import { MARK_COLUMNS, MARK_HEADERS, fileSlug, useInvalidateReports, useRoster, type ImportPreview, type ReportOptions } from './api'
import { selectClass } from './styles'

const RULES: [string, boolean, string][] = [
  ['Roll No', true, 'As on the roster of the class picked above'],
  ['Name', true, "The student's full name as on the roster (letter case, accents, spacing and punctuation don't matter), checked against the roll number"],
  ['Marks', true, 'Marks obtained, up to two decimals, not more than Max Marks'],
  ['Max Marks', true, 'The paper’s total, more than 0'],
  ['Attendance', false, 'Attendance % for the term, 0 to 100 (92 or 92%)'],
  ['Remarks', false, 'Up to 1,000 characters'],
]

/**
 * Import student report (PRD 4.5): one class's marks in one subject for one
 * term. The sheet holds only marks, attendance % and remarks for the term;
 * grades, ranks and the rest of the report are worked out from them.
 */
export function ImportMarksDialog({ base, options, onClose }: { base: string; options: ReportOptions; onClose: () => void }) {
  const [batchId, setBatchId] = useState('')
  const [subject, setSubject] = useState('')
  const [term, setTerm] = useState('')
  const [year, setYear] = useState(options.currentYear)
  const [file, setFile] = useState<File | null>(null)
  const [records, setRecords] = useState<Record<string, string>[] | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const roster = useRoster(base, batchId)
  const invalidate = useInvalidateReports(base)
  const picked = !!batchId && !!subject && !!term
  const batch = options.batches.find((b) => b.id === batchId)

  const send = (rows: Record<string, string>[], dryRun: boolean) =>
    api<ImportPreview>(`${base}/marks/import`, { method: 'POST', body: JSON.stringify({ batchId, subject, term, year, rows, dryRun }) })

  // A changed class, subject, term or year makes the preview stale: check the file again.
  const reset = () => {
    setPreview(null)
    setRecords(null)
    setFile(null)
    setError(null)
  }

  async function choose(next: File | undefined) {
    if (!next) return
    if (!picked) return setError('Select the class, subject and term first')
    setFile(next)
    setError(null)
    setPreview(null)
    setBusy(true)
    try {
      const { records: parsed, missing } = rowsToRecords(await readSpreadsheet(next), MARK_COLUMNS)
      const needed = (['rollNo', 'name', 'marks', 'maxMarks'] as const).filter((k) => missing.includes(k))
      if (needed.length) throw new Error(`The file needs ${needed.map((k) => `"${MARK_HEADERS[Object.keys(MARK_COLUMNS).indexOf(k)]}"`).join(', ')} column${needed.length === 1 ? '' : 's'}. Download the sample to see the format.`)
      if (parsed.length === 0) throw new Error('The file has no rows under the header')
      if (parsed.length > MAX_IMPORT_ROWS) throw new Error(`Import at most ${MAX_IMPORT_ROWS} students at a time`)
      const clean = parsed as Record<string, string>[]
      setRecords(clean)
      setPreview(await send(clean, true))
    } catch (err) {
      setRecords(null)
      setError(err instanceof Error ? err.message : 'Could not read the file')
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!records) return
    setBusy(true)
    setError(null)
    try {
      setPreview(await send(records, false))
      await invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  /** The class's roster with Roll No and Name filled in, or two sample rows before a class is picked. */
  async function sample() {
    const { default: writeXlsxFile } = await import('write-excel-file/browser')
    const body = batchId && roster.data?.length
      ? roster.data.map((s) => [s.rollNumber ?? '', s.fullName, '', '', '', ''])
      : [['01', 'Aarav Mehta', '72', '100', '92', 'Consistent'], ['02', 'Diya Shah', '45.5', '100', '', '']]
    await writeXlsxFile([MARK_HEADERS.map((value) => ({ value, fontWeight: 'bold' as const })), ...body.map((r) => r.map((value) => ({ value })))], {
      sheet: 'Report',
      stickyRowsCount: 1,
      columns: [10, 28, 10, 12, 12, 36].map((width) => ({ width })),
    }).toFile(batch ? `report-${fileSlug(batch.name)}${subject ? `-${fileSlug(subject)}` : ''}.xlsx` : 'student-report-sample.xlsx')
  }

  const count = preview && !preview.applied ? preview.created + preview.updated : 0
  return (
    <Dialog title="Import student report" description="One class’s marks in one subject for a term, from Excel or CSV" onClose={onClose} widthClass="max-w-4xl">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <div className="grid gap-3 sm:grid-cols-4">
          <Pick id="im-batch" label="Class *" value={batchId} onChange={(v) => { setBatchId(v); reset() }} placeholder={options.batches.length ? 'Select class' : 'No classes'} options={options.batches.map((b) => [b.id, b.name])} />
          <Pick id="im-subject" label="Subject *" value={subject} onChange={(v) => { setSubject(v); reset() }} placeholder="Select subject" options={options.subjects.map((s) => [s, s])} />
          <Pick id="im-term" label="Term *" value={term} onChange={(v) => { setTerm(v); reset() }} placeholder="Select term" options={options.terms.map((t) => [t.key, t.label])} />
          <Pick id="im-year" label="Academic year" value={String(year)} onChange={(v) => { setYear(Number(v)); reset() }} options={options.years.map((y) => [String(y.year), y.label])} />
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="flex items-center gap-2 text-sm font-bold text-slate-900"><Info className="size-4 text-emerald-600" /> Sheet format</p>
              <p className="mt-1 text-xs text-slate-500">Up to {MAX_IMPORT_ROWS.toLocaleString()} students. Grades are worked out from the marks; uploading the sheet again updates them.</p>
            </div>
            <button type="button" onClick={() => void sample()} disabled={!!batchId && roster.isLoading} className="inline-flex shrink-0 items-center gap-2 self-start rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
              <Download className="size-3.5" /> {batchId ? 'Download class sheet (.xlsx)' : 'Download sample (.xlsx)'}
            </button>
          </div>
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="bg-slate-50"><tr>{RULES.map(([h, req]) => <th key={h} className={`px-3 py-2 font-bold ${req ? 'text-emerald-700' : 'text-slate-700'}`}>{h}{req && ' *'}</th>)}</tr></thead>
              <tbody><tr className="text-[11px] text-slate-500">{RULES.map(([h, , rule]) => <td key={h} className="px-3 py-2 align-top">{rule}</td>)}</tr></tbody>
            </table>
          </div>
        </section>

        <div
          role="button"
          tabIndex={0}
          aria-disabled={!picked}
          onClick={() => (picked ? inputRef.current?.click() : setError('Select the class, subject and term first'))}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && picked && inputRef.current?.click()}
          className={`flex flex-col items-center rounded-xl border-2 border-dashed px-4 py-7 text-center transition ${picked ? 'cursor-pointer border-slate-300 bg-slate-50/50 hover:bg-slate-50' : 'cursor-not-allowed border-slate-200 bg-slate-50/30 opacity-70'}`}
        >
          <span className="flex size-11 items-center justify-center rounded-full bg-emerald-100">{busy ? <Loader2 className="size-5 animate-spin text-emerald-600" /> : <Folder className="size-5 text-emerald-600" />}</span>
          <p className="mt-2 text-sm font-bold text-slate-800">{file ? file.name : picked ? 'Select the Excel / CSV file' : 'Pick the class, subject and term, then select the file'}</p>
          <p className="mt-1 text-xs text-slate-500">.xlsx or .csv (save an old .xls as .xlsx first)</p>
          <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = '' }} />
        </div>

        <ErrorBanner message={error} />
        {preview && <ImportPreviewTable preview={preview} />}
        {preview?.applied && <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs font-medium text-emerald-800"><Check className="size-4" /> Saved marks for {preview.created + preview.updated} student{preview.created + preview.updated === 1 ? '' : 's'} ({preview.created} new, {preview.updated} updated).</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
        <p className="flex items-center gap-1.5 text-[11px] text-slate-500"><Info className="size-3.5" /> Rows with problems are skipped and listed.</p>
        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">{preview?.applied ? 'Done' : 'Cancel'}</button>
          {!preview?.applied && (
            <button type="button" onClick={() => void apply()} disabled={!count || busy} className="h-10 rounded-lg bg-emerald-600 px-5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
              Confirm &amp; Upload{count ? ` (${count})` : ''}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  )
}

function Pick({ id, label, value, onChange, options, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; options: [string, string][]; placeholder?: string }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={labelClass}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={`${selectClass} w-full`}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  )
}
