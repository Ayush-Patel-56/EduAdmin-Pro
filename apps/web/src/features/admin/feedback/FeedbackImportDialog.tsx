import { useRef, useState, type DragEvent } from 'react'
import { Check, Download, Folder, Info, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { MAX_IMPORT_ROWS, readSpreadsheet, rowsToRecords } from '@/lib/spreadsheet'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner } from '@/components/ui/form'
import type { ImportPreview } from '@/features/academic/api'
import { ImportPreviewTable } from '@/features/academic/ImportPreviewTable'
import { feedbackPath } from '@/features/feedback/api'
import { FEEDBACK_COLUMNS, HEADERS, sampleRows } from '@/features/feedback/sheet'

const RULES: [string, boolean, string][] = [
  ['Type', true, 'Management -> Teacher or Teacher -> Management'],
  ['Sender', false, 'For a teacher’s feedback: the teacher (name, email or employee ID). For management’s: who gave it; blank is you.'],
  ['Rating', true, 'A whole number from 1 to 5'],
  ['Content', true, 'The feedback itself, up to 2000 characters'],
  ['Subject', false, 'What it is about'],
  ['Target', false, 'For management’s feedback: one teacher (name, email or employee ID), or blank / All Faculty for everyone'],
  ['Category', false, 'Academics, Discipline, Punctuality, Teaching Quality, Administration or General (blank is General)'],
  ['Date', false, 'YYYY-MM-DD or DD-MM-YYYY; blank is today; not in the future'],
]

type Props = { schoolId: string; onImported: () => Promise<unknown>; onClose: () => void }

/** Bulk Upload Feedbacks via Excel / CSV (PRD 4.12): every row checked first, then imported on confirm. */
export function FeedbackImportDialog({ schoolId, onImported, onClose }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [records, setRecords] = useState<Record<string, string>[] | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const send = (rows: Record<string, string>[], dryRun: boolean) =>
    api<ImportPreview>(`${feedbackPath(schoolId)}/import`, { method: 'POST', body: JSON.stringify({ rows, dryRun }) })

  async function choose(next: File | undefined) {
    if (!next) return
    setFile(next)
    setError(null)
    setPreview(null)
    setBusy(true)
    try {
      const { records: parsed, missing } = rowsToRecords(await readSpreadsheet(next), FEEDBACK_COLUMNS)
      const needed = (['type', 'rating', 'content'] as const).filter((k) => missing.includes(k))
      if (needed.length) throw new Error(`The file needs ${needed.map((k) => `"${HEADERS[Object.keys(FEEDBACK_COLUMNS).indexOf(k)]}"`).join(', ')} column${needed.length === 1 ? '' : 's'}. Download the template to see the format.`)
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

  async function apply() {
    if (!records) return
    setBusy(true)
    setError(null)
    try {
      setPreview(await send(records, false))
      await onImported()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  async function downloadTemplate() {
    const { default: writeXlsxFile } = await import('write-excel-file/browser')
    await writeXlsxFile([HEADERS.map((value) => ({ value, fontWeight: 'bold' as const })), ...sampleRows()], {
      sheet: 'Feedback',
      stickyRowsCount: 1,
      columns: [24, 24, 8, 48, 20, 24, 18, 12].map((width) => ({ width })),
    }).toFile('feedback-template.xlsx')
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    void choose(e.dataTransfer.files[0])
  }

  const count = preview && !preview.applied ? preview.created : 0
  return (
    <Dialog title="Bulk Upload Feedbacks via Excel / CSV" description="Import feedback between management and faculty directly into the console" onClose={onClose} widthClass="max-w-4xl">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="flex items-center gap-2 text-sm font-bold tracking-wide text-slate-900 uppercase"><Info className="size-4 text-emerald-600" /> Expected Excel / CSV sheet format</p>
              <p className="mt-1 text-xs text-slate-500">Ensure your columns match the headers below before uploading.</p>
            </div>
            <button type="button" onClick={() => void downloadTemplate()} className="inline-flex shrink-0 items-center gap-2 self-start rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-700">
              <Download className="size-3.5" /> Download Sample Template (.xlsx)
            </button>
          </div>
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="bg-slate-50">
                <tr>
                  {RULES.map(([h, required]) => (
                    <th key={h} scope="col" className={`px-3 py-2.5 font-bold ${required ? 'text-emerald-700' : 'text-slate-700'}`}>{h}{required && ' *'}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {sampleRows('2026-10-18').map((r, i) => (
                  <tr key={i}>
                    {r.map((cell, j) => (
                      <td key={j} className={`px-3 py-2.5 align-top ${j === 2 ? 'font-bold text-orange-600' : ''} ${j === 3 ? 'italic' : ''}`}>{j === 3 ? `“${cell}”` : cell || '—'}</td>
                    ))}
                  </tr>
                ))}
                <tr className="bg-slate-50/60 text-[11px] text-slate-500">
                  {RULES.map(([h, , rule]) => <td key={h} className="px-3 py-2.5 align-top">{rule}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <div>
          <p className="mb-2 text-xs font-bold tracking-wider text-slate-700 uppercase">Select Excel / CSV file</p>
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${dragging ? 'border-emerald-400 bg-emerald-50' : 'border-slate-300 bg-slate-50/50 hover:bg-slate-50'}`}
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-emerald-100">
              {busy ? <Loader2 className="size-5 animate-spin text-emerald-600" /> : <Folder className="size-5 text-emerald-600" />}
            </span>
            <p className="mt-3 text-sm font-bold text-slate-800">{file ? file.name : 'Click here to select or drag and drop spreadsheet'}</p>
            <p className="mt-1 text-xs text-slate-500">Supports .XLSX and .CSV formats (save an old .XLS as .XLSX first), up to {MAX_IMPORT_ROWS} rows</p>
            <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = '' }} />
          </div>
        </div>

        <ErrorBanner message={error} />
        {preview && <ImportPreviewTable preview={preview} />}
        {preview?.applied && (
          <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs font-medium text-emerald-800"><Check className="size-4" /> Uploaded {preview.created} feedback entr{preview.created === 1 ? 'y' : 'ies'}.</p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
        <p className="flex items-center gap-1.5 text-[11px] text-slate-500"><Info className="size-3.5" /> Rows with problems, or already uploaded, are skipped and listed.</p>
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
