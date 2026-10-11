import { useRef, useState, type DragEvent } from 'react'
import { Check, Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { downloadFile, MAX_IMPORT_ROWS, readSpreadsheet, rowsToRecords, toCsv } from '@/lib/spreadsheet'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner } from '@/components/ui/form'
import { btnPrimary, btnSecondary, inputClass, labelClass } from '@/components/ui/formStyles'
import type { ImportPreview } from '@/features/academic/api'
import { ImportPreviewTable } from '@/features/academic/ImportPreviewTable'
import { curriculumApi, MASTER_FIELDS, useRefreshCurriculum, type CurriculumOptions } from './api'

const COLUMNS = {
  subject: ['Subject'],
  chapterName: ['Chapter Name', 'Chapter'],
  chapterCode: ['Chapter Code'],
  board: ['Board'],
  classLevel: ['Class', 'Class Level'],
  program: ['Program'],
  expectedHours: ['Expected Hours', 'Hours'],
  conceptName: ['Concept Name', 'Concept'],
  conceptCode: ['Concept Code'],
}

const FROM_FILE = ''

type ImportCurriculumDialogProps = {
  schoolId: string
  options: CurriculumOptions
  defaultSubject: string
  onClose: () => void
}

/**
 * PRD §7 curriculum import: one row per concept, chapter columns repeated.
 * Program must be blank or match one of the school's programs.
 */
export function ImportCurriculumDialog({ schoolId, options, defaultSubject, onClose }: ImportCurriculumDialogProps) {
  const refresh = useRefreshCurriculum(schoolId)
  const [file, setFile] = useState<File | null>(null)
  const [records, setRecords] = useState<Record<string, string>[] | null>(null)
  const [hasSubjectColumn, setHasSubjectColumn] = useState(false)
  const [subjectChoice, setSubjectChoice] = useState<string | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // With a Subject column the file decides; otherwise rows go to the chosen subject.
  const subject = subjectChoice ?? (hasSubjectColumn ? FROM_FILE : defaultSubject)

  const send = (rows: Record<string, string>[], dryRun: boolean, subjectValue: string) =>
    curriculumApi.importRows<ImportPreview>(schoolId, { rows, dryRun, subject: subjectValue || null })

  async function choose(next: File | undefined) {
    if (!next) return
    if (next.size > 10 * 1024 * 1024) return setError('Files must be 10 MB or smaller')
    setFile(next)
    setError(null)
    setPreview(null)
    setBusy(true)
    try {
      const { records: parsed, missing } = rowsToRecords(await readSpreadsheet(next), COLUMNS)
      if (missing.includes('chapterName')) throw new Error('The file needs a "Chapter Name" column. Download the template to see the format.')
      if (parsed.length === 0) throw new Error('The file has no rows under the header')
      if (parsed.length > MAX_IMPORT_ROWS) throw new Error(`Import at most ${MAX_IMPORT_ROWS} rows at a time`)
      const clean = parsed as Record<string, string>[]
      const withSubject = !missing.includes('subject')
      setRecords(clean)
      setHasSubjectColumn(withSubject)
      setPreview(await send(clean, true, subjectChoice ?? (withSubject ? FROM_FILE : defaultSubject)))
    } catch (err) {
      setRecords(null)
      setError(err instanceof Error ? err.message : 'Could not read the file')
    } finally {
      setBusy(false)
    }
  }

  async function changeSubject(value: string) {
    setSubjectChoice(value)
    if (!records) return
    setBusy(true)
    setError(null)
    try {
      setPreview(await send(records, true, value))
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
      setPreview(await send(records, false, subject))
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  function downloadTemplate() {
    const program = options.programs[0]?.name ?? ''
    const level = options.classes.find((c) => c === '11th') ?? options.classes[0] ?? ''
    const n = level.replace(/\D/g, '') || '11'
    const board = options.boards[0] ?? ''
    const rows = [
      ['Physics', 'Motion in a Straight Line', `PHY-${n}-CH03`, board, level, program, '14', 'Position and displacement', `PHY-${n}-CH03-CP01`],
      ['Physics', 'Motion in a Straight Line', `PHY-${n}-CH03`, board, level, program, '14', 'Uniformly accelerated motion', `PHY-${n}-CH03-CP02`],
      ['Chemistry', 'Some Basic Concepts of Chemistry', `CHE-${n}-CH01`, board, level, '', '8', 'Mole concept', `CHE-${n}-CH01-CP01`],
    ]
    downloadFile('curriculum-template.csv', toCsv([['Subject', ...MASTER_FIELDS], ...rows]))
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    void choose(e.dataTransfer.files[0])
  }

  const importable = preview && !preview.applied && preview.created + preview.updated > 0

  return (
    <Dialog title="Import Curriculum" description="One row per concept; chapter columns repeat on each of its rows." onClose={onClose} widthClass="max-w-2xl">
      <div className="space-y-4 px-6 py-5">
        <div className="flex flex-col gap-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 sm:flex-row sm:items-center">
          <div className="flex-1 text-[11px] text-slate-600">
            <p className="font-semibold text-slate-800">Columns</p>
            <p className="mt-0.5">
              {['Subject', ...MASTER_FIELDS].join(', ')}. Program must match one of this school’s programs (any case) or be
              blank. Class must be one the school offers ({options.classes.join(', ') || 'none set'}). To update chapters you
              imported before, keep the same Chapter Code; without one, a chapter is matched by name, and blank Board, Class or Program
              match it only if one chapter fits.
            </p>
          </div>
          <button type="button" onClick={downloadTemplate} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-xs font-semibold text-white hover:opacity-90">
            <Download className="size-3.5" /> Download Template
          </button>
        </div>

        <div>
          <label htmlFor="import-subject" className={labelClass}>Subject</label>
          <select id="import-subject" value={subject} onChange={(e) => changeSubject(e.target.value)} className={inputClass()}>
            <option value={FROM_FILE}>From the file’s Subject column</option>
            {options.subjects.map((s) => <option key={s} value={s}>All rows: {s}</option>)}
          </select>
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
            dragging ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'
          }`}
        >
          <span className="flex size-11 items-center justify-center rounded-xl bg-white text-emerald-600 shadow-sm">
            {busy ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
          </span>
          <p className="mt-3 text-sm font-semibold text-slate-800">{file ? file.name : 'Drag & drop your CSV / Excel here'}</p>
          <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
            <FileSpreadsheet className="size-3.5" /> .csv or .xlsx, up to {MAX_IMPORT_ROWS.toLocaleString()} rows
          </p>
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
        {preview && <ImportPreviewTable preview={preview} />}
        {preview?.applied && (
          <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs font-medium text-emerald-800">
            <Check className="size-4" /> Imported. Chapters, concepts and the Master Sheet are updated.
          </p>
        )}
      </div>
      <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
        <button type="button" onClick={onClose} className={btnSecondary}>{preview?.applied ? 'Done' : 'Cancel'}</button>
        {!preview?.applied && (
          <button type="button" onClick={apply} disabled={!importable || busy} className={btnPrimary}>
            {importable ? `Import ${preview.created + preview.updated} Row${preview.created + preview.updated === 1 ? '' : 's'}` : 'Import'}
          </button>
        )}
      </div>
    </Dialog>
  )
}
