import { useRef, useState, type DragEvent } from 'react'
import { CircleAlert, CircleCheck, Download, FileText, Loader2, Upload } from 'lucide-react'
import { api } from '@/lib/api'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner } from '@/components/ui/form'
import { btnPrimary, btnSecondary } from '@/components/ui/formStyles'
import type { ImportPreview } from './api'
import { readPdfText, sampleTemplatePdf } from './pdf'

const MCQ_SAMPLE = `Subject: Physics
Topic: Thermodynamics
Difficulty: Medium
Type: MCQ
Marks: 4
Negative Marks: -1
Source: Custom

1. What is the SI unit of temperature?
(A) Celsius
(B) Kelvin
(C) Fahrenheit
(D) Rankine

ANSWER KEY
1. B`

const NUMERIC_SAMPLE = `Subject: Physics
Topic: Kinematics
Difficulty: Easy
Type: Numerical
Marks: 4
Negative Marks: 0

1. A ball is dropped from 80 m. How many
seconds does it take to reach the ground?
(g = 10 m/s²)

ANSWER KEY
1. 4`

const RULES = [
  'The PDF must have selectable text (not a scan or photo).',
  'Start with the header block: Subject, Topic, Difficulty and Type are required; Marks (default 4), Negative Marks (default 0) and Source (default "PDF Upload") are optional.',
  'Subject is one of the school subjects; Difficulty is Easy, Medium or Hard; Type is MCQ, Numerical, Integer or Subjective. One file holds one type.',
  'Number questions "1." or "Q1."; give MCQ options as (A) to (D), on their own lines or one line.',
  'End with an ANSWER KEY block: one line per question number. Subjective questions may leave the answer out.',
  'Questions already in the bank (same subject and text), or repeated in the file, are skipped.',
]

/** Upload PDF Question Bank (PRD 4.10, 5.11): the file is read in the browser, checked by the server, then added on confirm. */
export function UploadPdfDialog({ base, onImported, onClose }: { base: string; onImported: () => Promise<unknown>; onClose: () => void }) {
  const [guide, setGuide] = useState<'mcq' | 'numeric'>('mcq')
  const [file, setFile] = useState<File | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [done, setDone] = useState<ImportPreview | null>(null)
  const [busy, setBusy] = useState<'read' | 'import' | 'sample' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  async function pick(f: File | undefined) {
    if (!f) return
    setFile(f)
    setText(null)
    setPreview(null)
    setDone(null)
    setError(null)
    setBusy('read')
    try {
      const content = await readPdfText(f)
      const checked = await api<ImportPreview>(`${base}/questions/import`, { method: 'POST', body: JSON.stringify({ text: content, dryRun: true }) })
      setText(content)
      setPreview(checked)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the PDF')
    } finally {
      setBusy(null)
    }
  }

  async function confirm() {
    if (!text) return
    setBusy('import')
    setError(null)
    try {
      const result = await api<ImportPreview>(`${base}/questions/import`, { method: 'POST', body: JSON.stringify({ text, dryRun: false }) })
      setDone(result)
      setPreview(null)
      await onImported()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import the questions')
    } finally {
      setBusy(null)
    }
  }

  async function sample() {
    setBusy('sample')
    try {
      ;(await sampleTemplatePdf()).save('question-bank-sample-mcq.pdf')
    } finally {
      setBusy(null)
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDrag(false)
    void pick(e.dataTransfer.files[0])
  }
  const problems = preview?.rows.filter((r) => r.action === 'error') ?? []

  return (
    <Dialog title="Upload PDF Question Bank" description="Add many questions at once from a PDF in the format below." onClose={onClose} widthClass="max-w-3xl">
      <div className="grid gap-6 px-6 py-5 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <div>
            <p className="text-xs font-bold tracking-wider text-slate-700 uppercase">PDF Format Guide</p>
            <div role="tablist" aria-label="Format" className="mt-2 inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1">
              {(
                [
                  ['mcq', 'MCQ'],
                  ['numeric', 'Numerical / Subjective'],
                ] as const
              ).map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={guide === key} onClick={() => setGuide(key)} className={`rounded-md px-3 py-1 text-xs font-semibold ${guide === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                  {label}
                </button>
              ))}
            </div>
            <pre className="mt-3 max-h-64 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-[11px] leading-relaxed text-slate-700">{guide === 'mcq' ? MCQ_SAMPLE : NUMERIC_SAMPLE}</pre>
          </div>
          <div>
            <p className="text-xs font-bold tracking-wider text-slate-700 uppercase">Important Rules</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs text-slate-600">
              {RULES.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
          <button type="button" onClick={() => void sample()} disabled={busy === 'sample'} className={`${btnSecondary} w-full`}>
            <Download className="size-4" /> Download Sample Template (MCQ)
          </button>
        </div>

        <div className="min-w-0 space-y-4">
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            disabled={!!busy}
            className={`flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-10 text-center transition disabled:opacity-70 ${drag ? 'border-emerald-400 bg-emerald-50' : 'border-slate-300 hover:border-indigo-300 hover:bg-slate-50'}`}
          >
            {busy === 'read' ? <Loader2 className="size-7 animate-spin text-slate-400" /> : <Upload className="size-7 text-emerald-600" />}
            <span className="text-sm font-bold text-slate-800">{busy === 'read' ? 'Reading the PDF…' : 'Drop your PDF here, or click to choose'}</span>
            <span className="text-[11px] text-slate-500">PDF with selectable text, up to 10 MB</span>
            <input
              ref={input}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                void pick(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </button>

          {file && (
            <p className="flex items-center gap-2 truncate text-xs text-slate-500">
              <FileText className="size-4 shrink-0" /> <span className="truncate">{file.name}</span>
            </p>
          )}
          <ErrorBanner message={error} />

          {preview && (
            <div className="rounded-xl border border-slate-200">
              <div className="flex flex-wrap gap-4 border-b border-slate-100 px-4 py-3 text-sm">
                <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
                  <CircleCheck className="size-4" /> {preview.created} ready to add
                </span>
                {problems.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-amber-700">
                    <CircleAlert className="size-4" /> {problems.length} skipped
                  </span>
                )}
              </div>
              {problems.length > 0 && (
                <ul className="max-h-48 space-y-2 overflow-y-auto px-4 py-3 text-xs">
                  {problems.map((r) => (
                    <li key={r.row}>
                      <span className="font-semibold text-slate-800 [overflow-wrap:anywhere]">{r.label}</span>
                      <span className="block text-amber-700">{r.errors.join('; ')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {done && (
            <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800">
              Added {done.created} question{done.created === 1 ? '' : 's'} to the bank{done.skipped ? `; ${done.skipped} skipped` : ''}.
            </p>
          )}
        </div>
      </div>
      <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
        <button type="button" onClick={onClose} className={btnSecondary}>
          {done ? 'Done' : 'Cancel'}
        </button>
        {!done && (
          <button type="button" onClick={() => void confirm()} disabled={!preview?.created || !!busy} className={btnPrimary}>
            {busy === 'import' ? 'Importing…' : preview?.created ? `Import ${preview.created} Question${preview.created === 1 ? '' : 's'}` : 'Import Questions'}
          </button>
        )}
      </div>
    </Dialog>
  )
}
