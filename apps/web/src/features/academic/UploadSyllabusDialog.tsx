import { useRef, useState, type DragEvent } from 'react'
import { Building2, Check, Download, FileSpreadsheet, FileText, Image, Layers, Loader2, Upload, BookOpen, Library } from 'lucide-react'
import { api } from '@/lib/api'
import { downloadFile, MAX_IMPORT_ROWS, readSpreadsheet, rowsToRecords, toCsv } from '@/lib/spreadsheet'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner } from '@/components/ui/form'
import { btnSecondary, inputClass } from '@/components/ui/formStyles'
import { basePath, useAcademicOptions, type AcademicSource, type ImportPreview, type Structure } from './api'
import { ImportPreviewTable } from './ImportPreviewTable'

const SYLLABUS_COLUMNS = {
  school: ['School'],
  program: ['Program'],
  batch: ['Batch'],
  subject: ['Subject'],
  title: ['Chapter Title', 'Chapter', 'Title'],
  estimatedHours: ['Estimated Hours', 'Est. Hours', 'Hours'],
  targetDates: ['Target Dates', 'Target Date'],
  status: ['Status'],
  remarks: ['Teacher Remarks & Notes', 'Teacher Remarks', 'Remarks', 'Notes'],
}

const TEMPLATE_HEADER = [
  'School',
  'Program',
  'Batch',
  'Subject',
  'Chapter Title',
  'Estimated Hours',
  'Target Dates',
  'Status',
  'Teacher Remarks & Notes',
]

type UploadSyllabusDialogProps = {
  source: AcademicSource
  structure: Structure | undefined
  schoolName: string
  defaults: { programId: string | null; batchId: string | null; subject: string }
  onImported: () => void
  onClose: () => void
}

const AUTO = ''
const contextLabel = 'mb-1 flex items-center gap-1 text-[10px] font-bold tracking-wider text-slate-500 uppercase'

export function UploadSyllabusDialog({ source, structure, schoolName, defaults, onImported, onClose }: UploadSyllabusDialogProps) {
  const { data: options } = useAcademicOptions()
  const programs = structure?.programs ?? []
  const batches = structure?.batches ?? []
  const [programId, setProgramId] = useState(defaults.programId ?? AUTO)
  const [batchId, setBatchId] = useState(defaults.batchId ?? AUTO)
  const [subject, setSubject] = useState(AUTO)
  const [file, setFile] = useState<File | null>(null)
  const [records, setRecords] = useState<Record<string, string>[] | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showSample, setShowSample] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const batchOptions = programId ? batches.filter((b) => b.programId === programId) : batches
  const sampleBatch = batches.find((b) => b.id === batchId) ?? batches[0]
  const sampleProgram = programs.find((p) => p.id === sampleBatch?.programId)

  const sampleRows = [
    [schoolName, sampleProgram?.name ?? 'JEE', sampleBatch?.name ?? 'Batch 1', 'Physics', 'Chapter 01: Physical World', '10 hrs est.', 'Oct 01 - Oct 15', 'NOT STARTED', 'Introductory concepts clear. Ready for test.'],
    [schoolName, sampleProgram?.name ?? 'JEE', sampleBatch?.name ?? 'Batch 1', 'Physics', 'Chapter 02: Units and Measurements', '12 hrs est.', 'Oct 16 - Oct 30', 'IN PROGRESS', 'Focus on dimensional analysis.'],
    [schoolName, sampleProgram?.name ?? 'JEE', sampleBatch?.name ?? 'Batch 1', 'Physics', 'Chapter 03: Motion in a Straight Line', '14 hrs est.', 'Nov 01 - Nov 15', 'COMPLETED', 'Problem solving and numericals completed.'],
  ]

  async function send(rows: Record<string, string>[], dryRun: boolean) {
    return api<ImportPreview>(`${basePath(source)}/syllabus/import`, {
      method: 'POST',
      body: JSON.stringify({
        rows,
        dryRun,
        defaults: { programId: programId || null, batchId: batchId || null, subject: subject || null },
      }),
    })
  }

  async function choose(next: File | undefined) {
    if (!next) return
    if (next.size > 10 * 1024 * 1024) return setError('Files must be 10 MB or smaller')
    const lower = next.name.toLowerCase()
    if (lower.endsWith('.pdf') || /\.(png|jpe?g)$/.test(lower)) {
      return setError('Reading chapters from PDFs and images isn’t available yet. Use the CSV template or an Excel (.xlsx) sheet.')
    }
    setFile(next)
    setError(null)
    setPreview(null)
    setBusy(true)
    try {
      const rows = await readSpreadsheet(next)
      const { records: parsed, missing } = rowsToRecords(rows, SYLLABUS_COLUMNS)
      if (missing.includes('title')) throw new Error('The file needs a "Chapter Title" column. Download the template to see the format.')
      if (parsed.length === 0) throw new Error('The file has no rows under the header')
      if (parsed.length > MAX_IMPORT_ROWS) throw new Error(`Import at most ${MAX_IMPORT_ROWS} rows at a time`)
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

  // Changing the target context re-checks the already-loaded rows.
  async function recheck(update: () => void) {
    update()
    setPreview(null)
  }

  async function runPreview() {
    if (!records) return
    setBusy(true)
    setError(null)
    try {
      setPreview(await send(records, true))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check the file')
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
      onImported()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    void choose(e.dataTransfer.files[0])
  }

  const importable = preview && !preview.applied && preview.created + preview.updated > 0

  return (
    <Dialog
      title="Upload Syllabus Document"
      description="Import course chapters automatically using CSV or Excel files."
      onClose={onClose}
      widthClass="max-w-3xl"
    >
      <div className="space-y-4 px-6 py-5">
        <div className="flex flex-col gap-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-800">
              Supported formats:
              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-white px-2 py-0.5 text-[10px] text-emerald-700">
                <FileSpreadsheet className="size-3" /> Excel / CSV
              </span>
              <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-400" title="Coming soon">
                <FileText className="size-3" /> PDF (soon)
              </span>
              <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-400" title="Coming soon">
                <Image className="size-3" /> Image (soon)
              </span>
            </p>
            <p className="mt-1.5 text-[11px] text-slate-500">
              Expected 9 columns: <span className="font-medium text-slate-700">{TEMPLATE_HEADER.join(', ')}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowSample((s) => !s)} className={`${btnSecondary} h-9 text-xs`}>
              {showSample ? 'Hide Sample' : 'View Sample Format'}
            </button>
            <button
              type="button"
              onClick={() => downloadFile('syllabus-template.csv', toCsv([TEMPLATE_HEADER, ...sampleRows]))}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-xs font-semibold text-white hover:opacity-90"
            >
              <Download className="size-3.5" /> Download Template (.CSV)
            </button>
          </div>
        </div>

        {showSample && (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[720px] text-left text-[11px]">
              <thead className="bg-slate-50 text-slate-500">
                <tr>{TEMPLATE_HEADER.map((h) => <th key={h} className="px-2 py-1.5 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {sampleRows.map((r) => (
                  <tr key={r[4]}>{r.map((c, i) => <td key={i} className="px-2 py-1.5">{c}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="mb-3 text-[11px] font-bold tracking-wider text-slate-700 uppercase">Target course context</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <label className={contextLabel} htmlFor="upload-school"><Building2 className="size-3" /> School</label>
              <select id="upload-school" disabled className={inputClass()}>
                <option>{schoolName}</option>
              </select>
            </div>
            <div>
              <label className={contextLabel} htmlFor="upload-program"><BookOpen className="size-3" /> Program</label>
              <select
                id="upload-program"
                value={programId}
                onChange={(e) =>
                  recheck(() => {
                    setProgramId(e.target.value)
                    if (e.target.value && batches.find((b) => b.id === batchId)?.programId !== e.target.value) setBatchId(AUTO)
                  })
                }
                className={inputClass()}
              >
                <option value={AUTO}>Automatic (from file)</option>
                {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className={contextLabel} htmlFor="upload-batch"><Layers className="size-3" /> Batch</label>
              <select id="upload-batch" value={batchId} onChange={(e) => recheck(() => setBatchId(e.target.value))} className={inputClass()}>
                <option value={AUTO}>Automatic (from file)</option>
                {batchOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className={contextLabel} htmlFor="upload-subject"><Library className="size-3" /> Subject</label>
              <select id="upload-subject" value={subject} onChange={(e) => recheck(() => setSubject(e.target.value))} className={inputClass()}>
                <option value={AUTO}>Automatic (from file)</option>
                {(options?.subjects ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-slate-500">
            “Automatic” reads the column from each row. Rows naming another school are rejected.
          </p>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${
            dragging ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-slate-50/60 hover:bg-slate-50'
          }`}
        >
          <span className="flex size-12 items-center justify-center rounded-xl bg-white text-emerald-600 shadow-sm">
            {busy ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
          </span>
          <p className="mt-3 text-sm font-semibold text-slate-800">
            {file ? file.name : 'Click to select or drag & drop syllabus document'}
          </p>
          <p className="mt-1 text-xs text-slate-500">Supports CSV and XLSX files up to 10MB ({MAX_IMPORT_ROWS.toLocaleString()} rows)</p>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              void choose(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>

        <ErrorBanner message={error} />
        {records && !preview && !busy && (
          <button type="button" onClick={runPreview} className={`${btnSecondary} w-full`}>
            Check {records.length} row{records.length === 1 ? '' : 's'} again with the new context
          </button>
        )}
        {preview && <ImportPreviewTable preview={preview} />}
        {preview?.applied && (
          <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs font-medium text-emerald-800">
            <Check className="size-4" /> Imported. The tracker is updated for admin and faculty.
          </p>
        )}
      </div>

      <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
        <button type="button" onClick={onClose} className={btnSecondary}>
          {preview?.applied ? 'Done' : 'Cancel'}
        </button>
        {!preview?.applied && (
          <button
            type="button"
            onClick={apply}
            disabled={!importable || busy}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            <Check className="size-4" />
            {importable ? `Import ${preview.created + preview.updated} Chapter${preview.created + preview.updated === 1 ? '' : 's'}` : 'Import Syllabus'}
          </button>
        )}
      </div>
    </Dialog>
  )
}
