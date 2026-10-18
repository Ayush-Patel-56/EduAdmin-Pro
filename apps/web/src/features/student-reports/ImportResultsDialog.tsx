import { useEffect, useRef, useState } from 'react'
import { Check, Download, Folder, Info, Loader2, Search } from 'lucide-react'
import { api } from '@/lib/api'
import { MAX_IMPORT_ROWS, readSpreadsheet } from '@/lib/spreadsheet'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner } from '@/components/ui/form'
import { ImportPreviewTable } from '@/features/academic/ImportPreviewTable'
import { resultChunks, useGradableTests, useInvalidateAssessments, useResults, type ResultsView } from '@/features/assessments/api'
import { dayLabel, fileSlug, useInvalidateReports } from './api'
import { checkResults, resultHeader, resultTemplate, type CheckedRow } from './resultsSheet'
import { selectClass } from './styles'

type Props = { assessmentsBase: string; reportsBase: string; onClose: () => void }

/** Import Test Results (PRD 4.5): pick a test, fill in its sheet, check every row, then save. */
export function ImportResultsDialog({ assessmentsBase, reportsBase, onClose }: Props) {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [testId, setTestId] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])
  const tests = useGradableTests(assessmentsBase, debounced)
  const results = useResults(assessmentsBase, testId || null)
  const view = results.data?.test.id === testId ? results.data : undefined
  return (
    <Dialog title="Import Test Results" description="Bulk-grade up to 1,000 students of one test from an Excel / CSV sheet" onClose={onClose} widthClass="max-w-4xl">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
          <label className="relative block">
            <span className="sr-only">Search tests</span>
            <Search className="pointer-events-none absolute top-3 left-3 size-4 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tests by title, subject or batch" className="h-10 w-full rounded-lg border border-slate-200 bg-white pr-3 pl-9 text-sm shadow-sm focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 focus:outline-none" />
          </label>
          <div>
            <label htmlFor="ir-test" className="sr-only">Test</label>
            <select id="ir-test" value={testId} onChange={(e) => setTestId(e.target.value)} className={`${selectClass} w-full`}>
              <option value="">{tests.loaded ? (tests.tests.length ? 'Select a test that has started *' : 'No tests have started yet') : 'Loading tests…'}</option>
              {tests.tests.map((t) => <option key={t.id} value={t.id}>{t.title} · {t.batch.name} · {dayLabel(t.date)} ({t.totalMarks} marks)</option>)}
            </select>
            {tests.remaining > 0 && <button type="button" onClick={() => void tests.loadMore()} className="mt-1 text-[11px] font-semibold text-indigo-600 hover:underline">{tests.loadingMore ? 'Loading…' : `Load ${Math.min(50, tests.remaining)} more tests`}</button>}
          </div>
        </div>
        <ErrorBanner message={tests.error?.message ?? results.error?.message} />
        {testId && !view && !results.error && <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-slate-300" /></div>}
        {view && <Sheet key={view.test.id} view={view} assessmentsBase={assessmentsBase} reportsBase={reportsBase} onClose={onClose} />}
        {!testId && <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-600"><Info className="mt-px size-3.5 shrink-0" /> Results already entered for the test are updated for the students in the sheet; students not in the sheet keep theirs.</p>}
      </div>
    </Dialog>
  )
}

function Sheet({ view, assessmentsBase, reportsBase, onClose }: { view: ResultsView; assessmentsBase: string; reportsBase: string; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [rows, setRows] = useState<CheckedRow[] | null>(null)
  const [saved, setSaved] = useState<number | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const invalidateTests = useInvalidateAssessments(assessmentsBase)
  const invalidateReports = useInvalidateReports(reportsBase)
  const ready = rows?.filter((r) => r.result) ?? []

  async function template() {
    const { default: writeXlsxFile } = await import('write-excel-file/browser')
    const header = resultHeader(view.paper)
    await writeXlsxFile([header.map((value) => ({ value, fontWeight: 'bold' as const })), ...resultTemplate(view).map((r) => r.map((value) => ({ value })))], {
      sheet: 'Results',
      stickyRowsCount: 1,
      columns: header.map((h) => ({ width: h === 'Name' ? 28 : h.startsWith('Q') ? 6 : 12 })),
    }).toFile(`results-${fileSlug(view.test.title)}-${view.test.date}.xlsx`)
  }

  async function choose(next: File | undefined) {
    if (!next) return
    setFile(next)
    setError(null)
    setRows(null)
    setSaved(null)
    try {
      const sheet = await readSpreadsheet(next)
      if (sheet.length < 2) throw new Error('The file has no rows under the header')
      if (sheet.length - 1 > MAX_IMPORT_ROWS) throw new Error(`Import at most ${MAX_IMPORT_ROWS} students at a time`)
      const out = checkResults(sheet, view)
      if (out.missing.length) throw new Error(`The file needs ${out.missing.map((m) => `"${m}"`).join(', ')} column${out.missing.length === 1 ? '' : 's'}. Download the template to see the format.`)
      setRows(out.rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the file')
    }
  }

  async function save() {
    setBusy(true)
    setError(null)
    let done = 0
    try {
      const chunks = resultChunks(ready.map((r) => r.result!))
      for (const [i, chunk] of chunks.entries()) {
        setProgress(chunks.length > 1 ? `Saving part ${i + 1} of ${chunks.length}…` : 'Saving…')
        await api(`${assessmentsBase}/tests/${view.test.id}/results`, { method: 'PUT', body: JSON.stringify({ results: chunk, summaryOnly: true }) })
        done += chunk.length
      }
      setSaved(done)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save'
      setError(done ? `${message} (${done} result${done === 1 ? ' was' : 's were'} saved before this; fix the row and import the sheet again.)` : message)
    } finally {
      setProgress(null)
      setBusy(false)
      if (done) await Promise.all([invalidateTests(), invalidateReports()])
    }
  }

  const preview = rows && {
    applied: saved !== null,
    created: rows.filter((r) => r.action === 'create').length,
    updated: rows.filter((r) => r.action === 'update').length,
    skipped: rows.filter((r) => r.action === 'error').length,
    rows: rows.map(({ row, label, action, errors }) => ({ row, label, action, errors })),
  }
  return (
    <>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 text-xs text-slate-600">
            <p className="text-sm font-bold text-slate-900">{view.test.title} · {view.test.batch.name}</p>
            <p className="mt-1">{view.rows.length} students on the roster · {view.test.totalMarks} marks{view.paper.length ? ` · ${view.paper.length}-question paper` : ''}</p>
            <ul className="mt-2 list-disc space-y-0.5 pl-4">
              <li><b>Roll No</b> and <b>Present</b> (Yes / No) are required; Name is for your reference.</li>
              {view.paper.length ? (
                <li>Fill <b>Q1…Q{view.paper.length}</b> with each answer (the option letter or value; marks given for subjective questions) and marks are worked out, or give <b>Marks</b> alone.</li>
              ) : (
                <li><b>Marks</b> is required for a present student; Correct / Incorrect / Unattempted are optional counts.</li>
              )}
              <li>Ratings and attendance aren’t in this sheet: teachers record them on their own pages.</li>
            </ul>
          </div>
          <button type="button" onClick={() => void template()} className="inline-flex shrink-0 items-center gap-2 self-start rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-700">
            <Download className="size-3.5" /> Download sheet (.xlsx)
          </button>
        </div>
      </section>

      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        className="flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/50 px-4 py-7 text-center hover:bg-slate-50"
      >
        <span className="flex size-11 items-center justify-center rounded-full bg-emerald-100"><Folder className="size-5 text-emerald-600" /></span>
        <p className="mt-2 text-sm font-bold text-slate-800">{file ? file.name : 'Select the filled-in sheet'}</p>
        <p className="mt-1 text-xs text-slate-500">.xlsx or .csv, up to {MAX_IMPORT_ROWS} students</p>
        <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = '' }} />
      </div>

      <ErrorBanner message={error} />
      {preview && <ImportPreviewTable preview={preview} />}
      {saved !== null && <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs font-medium text-emerald-800"><Check className="size-4" /> Saved {saved} result{saved === 1 ? '' : 's'}. Ranks, the results sheet and the student reports now include them.</p>}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-4">
        {progress && <span className="mr-auto text-xs text-slate-500">{progress}</span>}
        <button type="button" onClick={onClose} className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">{saved !== null ? 'Done' : 'Cancel'}</button>
        {saved === null && (
          <button type="button" onClick={() => void save()} disabled={!ready.length || busy} className="h-10 rounded-lg bg-emerald-600 px-5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
            Save results{ready.length ? ` (${ready.length})` : ''}
          </button>
        )}
      </div>
    </>
  )
}
