import { useRef, useState, type DragEvent } from 'react'
import { Check, Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { api } from '@/lib/api'
import { MAX_IMPORT_ROWS, readSpreadsheet, rowsToRecords } from '@/lib/spreadsheet'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner } from '@/components/ui/form'
import { btnPrimary, btnSecondary } from '@/components/ui/formStyles'
import type { ImportPreview, Structure } from '@/features/academic/api'
import { ImportPreviewTable } from '@/features/academic/ImportPreviewTable'
import { field } from './styles'
import { downloadStudentSample, STUDENT_COLUMNS } from './studentSheet'

type Props = {
  schoolId: string
  structure: Structure | undefined
  onImported: () => Promise<unknown>
  onClose: () => void
}

export function ImportStudentsDialog({ schoolId, structure, onImported, onClose }: Props) {
  const [programId, setProgramId] = useState('')
  const [batchId, setBatchId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [records, setRecords] = useState<Record<string, string>[] | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const batches = (structure?.batches ?? []).filter((b) => !programId || b.programId === programId)
  const send = (rows: Record<string, string>[], dryRun: boolean, defaults = { programId, batchId }) =>
    api<ImportPreview>(`/schools/${schoolId}/students/import`, {
      method: 'POST',
      body: JSON.stringify({ rows, dryRun, defaults }),
    })

  async function choose(next: File | undefined) {
    if (!next) return
    setFile(next)
    setError(null)
    setPreview(null)
    setBusy(true)
    try {
      const { records: parsed, missing } = rowsToRecords(await readSpreadsheet(next), STUDENT_COLUMNS)
      if (missing.includes('fullName')) throw new Error('The file needs a "Name" column. Download the sample to see the format.')
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

  /** Changing a default re-runs the preview, so what's shown is what will be imported. */
  async function changeDefaults(next: { programId: string; batchId: string }) {
    setProgramId(next.programId)
    setBatchId(next.batchId)
    if (!records) return
    setBusy(true)
    setError(null)
    try {
      setPreview(await send(records, true, next))
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
      await onImported()
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
    <Dialog title="Upload CSV / Excel" onClose={onClose} widthClass="max-w-2xl">
      <div className="space-y-4 px-6 py-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="imp-program" className="mb-1.5 block text-[11px] font-bold tracking-wide text-slate-500 uppercase">Default Program</label>
            <select
              id="imp-program"
              value={programId}
              disabled={busy || preview?.applied}
              onChange={(e) => {
                const next = e.target.value
                const keep = (structure?.batches ?? []).some((b) => b.id === batchId && b.programId === next)
                void changeDefaults({ programId: next, batchId: keep ? batchId : '' })
              }}
              className={field}
            >
              <option value="">No default — use CSV value</option>
              {structure?.programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="imp-batch" className="mb-1.5 block text-[11px] font-bold tracking-wide text-slate-500 uppercase">Default Batch</label>
            <select
              id="imp-batch"
              value={batchId}
              disabled={busy || preview?.applied}
              onChange={(e) => {
                const batch = structure?.batches.find((b) => b.id === e.target.value)
                void changeDefaults({ programId: batch ? batch.programId : programId, batchId: e.target.value })
              }}
              className={field}
            >
              <option value="">No default — use CSV value</option>
              {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        </div>
        <p className="-mt-2 text-[11px] text-slate-400">A default above applies to every row unless the CSV file itself has a value in that column.</p>

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
          className={`flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed px-4 py-10 text-center transition ${
            dragging ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'
          }`}
        >
          <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-50 text-indigo-600">
            {busy ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
          </span>
          <p className="mt-3 text-sm font-semibold text-slate-800">{file ? file.name : 'Drag & drop your Excel/CSV here'}</p>
          <p className="mt-1 text-xs text-slate-500">or click to browse from your device (.csv, .xlsx)</p>
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
        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5">
          <p className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
            <FileSpreadsheet className="size-3.5 text-emerald-600" /> Format template
          </p>
          <button type="button" onClick={downloadStudentSample} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800 hover:text-brand-600">
            <Download className="size-3.5" /> Download Sample CSV
          </button>
        </div>
        <p className="text-[11px] text-slate-500">
          A row with the admission number (or Aadhaar) of an existing student updates them; blank cells keep the current value.
          Students are never matched by name. Program and batch names must match this school’s.
        </p>
        <ErrorBanner message={error} />
        {preview && <ImportPreviewTable preview={preview} />}
        {preview?.applied && (
          <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs font-medium text-emerald-800">
            <Check className="size-4" /> Imported.
          </p>
        )}
      </div>
      <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
        <button type="button" onClick={onClose} className={btnSecondary}>{preview?.applied ? 'Done' : 'Cancel'}</button>
        {!preview?.applied && (
          <button type="button" onClick={apply} disabled={!importable || busy} className={btnPrimary}>
            {importable ? `Import ${preview.created + preview.updated} Student${preview.created + preview.updated === 1 ? '' : 's'}` : 'Import'}
          </button>
        )}
      </div>
    </Dialog>
  )
}
