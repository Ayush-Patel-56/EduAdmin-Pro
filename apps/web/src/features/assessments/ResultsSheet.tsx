import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CircleAlert, Download, ListChecks, Save, Search, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { downloadFile, toCsv } from '@/lib/spreadsheet'
import { ConfirmDialog, ErrorBanner } from '@/components/ui/form'
import { AnswersDialog } from './AnswersDialog'
import {
  entryOf,
  entryPayload,
  filterRows,
  previewScore,
  resultChunks,
  resultsCsvRows,
  sameEntry,
  useInvalidateAssessments,
  useResults,
  type Entry,
  type ResultRow,
  type ResultsView,
  type RowFilter,
} from './api'
import { Card, Empty, iconBtn, Spinner, tdClass, thClass } from './ui'

const FILTERS: { key: RowFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'present', label: 'Present' },
  { key: 'absent', label: 'Absent' },
  { key: 'passed', label: 'Passed' },
  { key: 'failed', label: 'Failed' },
]

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'test'
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : String(n))

/** Test Results Entry (PRD 5.12): mark who sat the test and their result; ranks and class performance follow. */
export function ResultsSheet({ base, testId }: { base: string; testId: string }) {
  const results = useResults(base, testId)
  const view = results.data
  if (results.error) return <ErrorBanner message={results.error.message} />
  if (!view) return <Spinner />
  return <Sheet key={testId} base={base} view={view} />
}

function Sheet({ base, view }: { base: string; view: ResultsView }) {
  const client = useQueryClient()
  const invalidate = useInvalidateAssessments(base)
  const paper = view.paper
  const hasAnswers = view.rows.some((r) => r.result?.answers.length)
  const hasTotalsOnly = view.rows.some((r) => r.result?.present && !r.result.answers.length)
  // Question by question when there's a paper (unless results so far are totals), until the teacher picks.
  const [chosen, setMode] = useState<'marks' | 'answers' | null>(null)
  const mode = !paper.length ? 'marks' : (chosen ?? (hasAnswers || !hasTotalsOnly ? 'answers' : 'marks'))
  const [drafts, setDrafts] = useState<Record<string, Entry>>({})
  const [filter, setFilter] = useState<RowFilter>('all')
  const [search, setSearch] = useState('')
  const [answering, setAnswering] = useState<ResultRow | null>(null)
  const [clearing, setClearing] = useState<ResultRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const phase = view.test.phase
  const open = phase === 'ONGOING' || phase === 'COMPLETED'
  const editable = open && view.canGrade
  const initial = useMemo(() => new Map(view.rows.map((r) => [r.student.id, entryOf(r, paper)])), [view, paper])
  const entry = (id: string) => drafts[id] ?? initial.get(id)!
  const dirty = Object.keys(drafts)
  const rows = filterRows(view.rows, filter, search)

  useEffect(() => {
    if (!dirty.length) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty.length])

  function update(id: string, patch: Partial<Entry>) {
    setSaved(null)
    setError(null)
    setDrafts((d) => {
      const next = { ...(d[id] ?? initial.get(id)!), ...patch }
      const copy = { ...d }
      if (sameEntry(next, initial.get(id)!)) delete copy[id]
      else copy[id] = next
      return copy
    })
  }

  function markAllPresent() {
    for (const r of view.rows) if (entry(r.student.id).present === null) update(r.student.id, { present: true })
  }

  async function save() {
    const payload = []
    for (const id of dirty) {
      const row = view.rows.find((r) => r.student.id === id)!
      const p = entryPayload(id, drafts[id], mode, paper)
      if (typeof p === 'string') return setError(`${row.student.fullName}: ${p}`)
      payload.push(p)
    }
    setBusy(true)
    setError(null)
    // A large sheet goes in chunks (each its own save), so no request nears the size limit.
    let done = 0
    try {
      const chunks = resultChunks(payload)
      for (const [i, chunk] of chunks.entries()) {
        // Only the last chunk asks for the whole sheet back (ranks and stats over everyone).
        const last = i === chunks.length - 1
        const next = await api<ResultsView | { saved: number }>(`${base}/tests/${view.test.id}/results`, { method: 'PUT', body: JSON.stringify({ results: chunk, ...(!last && { summaryOnly: true }) }) })
        if ('rows' in next) client.setQueryData([base, 'results', view.test.id], next)
        done += chunk.length
        const savedIds = new Set(chunk.map((p) => p.studentId))
        setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([id]) => !savedIds.has(id))))
      }
      setSaved(`Saved ${done} result${done === 1 ? '' : 's'}.`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save the results'
      setError(done ? `${message} (${done} of ${payload.length} were saved; the rest are still unsaved.)` : message)
    } finally {
      setBusy(false)
      if (done) void invalidate()
    }
  }

  const s = view.stats
  const maxBand = Math.max(1, ...s.distribution.map((d) => d.count))

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="p-5">
          <h3 className="text-sm font-bold text-slate-900">Class Performance</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Of those present · pass mark {s.passPercent}% · out of {view.test.totalMarks}
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Average" value={s.averageMarks === null ? '—' : `${s.averageMarks}`} hint={s.averagePercent === null ? 'No results yet' : `${s.averagePercent}%`} />
            <Stat label="Highest" value={fmt(s.highest)} />
            <Stat label="Lowest" value={fmt(s.lowest)} />
            <Stat label="Passed" value={s.present ? `${s.passed}/${s.present}` : '—'} />
            <Stat label="Students" value={String(s.students)} />
            <Stat label="Graded" value={String(s.graded)} />
            <Stat label="Present" value={String(s.present)} />
            <Stat label="Absent" value={String(s.absent)} />
          </dl>
        </Card>
        <Card className="p-5">
          <h3 className="text-sm font-bold text-slate-900">Score Distribution</h3>
          <p className="mt-0.5 text-xs text-slate-500">Students present, by percentage</p>
          {s.present ? (
            <ul className="mt-4 space-y-2.5">
              {s.distribution.map((d) => (
                <li key={d.label} className="flex items-center gap-3 text-xs">
                  <span className="w-16 shrink-0 font-semibold text-slate-600">{d.label}</span>
                  <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <span className="block h-full rounded-full bg-indigo-500" style={{ width: `${(d.count / maxBand) * 100}%` }} />
                  </span>
                  <span className="w-6 shrink-0 text-right text-slate-500 tabular-nums">{d.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-6 text-xs text-slate-400 italic">The distribution shows once results are saved.</p>
          )}
        </Card>
      </div>

      {!open && (
        <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
          <CircleAlert className="size-4 shrink-0" />
          {phase === 'CANCELLED' ? 'This test is cancelled. Restore it to enter results.' : 'Results can be entered once the test starts.'}
        </p>
      )}
      {open && !view.canGrade && <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600">Your faculty profile is inactive, so results are read-only.</p>}

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div role="tablist" aria-label="Filter students" className="inline-flex self-start overflow-x-auto rounded-xl border border-slate-200 bg-slate-100 p-1">
              {FILTERS.map((f) => (
                <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition ${filter === f.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => downloadFile(`results-${slug(view.test.title)}-${view.test.date}.csv`, toCsv(resultsCsvRows(view)))}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Download className="size-4" /> Export CSV
              </button>
              {editable && (
                <button type="button" onClick={() => void save()} disabled={busy || !dirty.length} className="inline-flex h-9 items-center gap-2 rounded-lg bg-ink px-3.5 text-sm font-semibold text-white hover:bg-ink-hover disabled:opacity-50">
                  <Save className="size-4" /> {busy ? 'Saving…' : dirty.length ? `Save Results (${dirty.length})` : 'Save Results'}
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or roll no…"
                aria-label="Search students"
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pr-3 pl-9 text-sm focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
              />
            </div>
            {paper.length > 0 && (
              <div role="radiogroup" aria-label="Entry mode" className="inline-flex self-start rounded-lg border border-slate-200 p-0.5 text-xs font-semibold">
                {(
                  [
                    ['answers', 'Question by question'],
                    ['marks', 'Total marks'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={mode === key}
                    disabled={dirty.length > 0 && mode !== key}
                    title={dirty.length > 0 && mode !== key ? 'Save or discard your changes first' : undefined}
                    onClick={() => setMode(key)}
                    className={`rounded-md px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-50 ${mode === key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {editable && view.rows.some((r) => entry(r.student.id).present === null) && (
              <button type="button" onClick={markAllPresent} className="inline-flex h-9 items-center gap-1.5 self-start rounded-lg px-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50">
                <ListChecks className="size-4" /> Mark everyone not marked as present
              </button>
            )}
          </div>
          {paper.length === 0 && <p className="text-[11px] text-slate-500">This test has no paper, so enter each student’s total marks. Add a paper to record answers question by question (they feed topic and mistake reports).</p>}
          {mode === 'answers' && paper.length > 0 && <p className="text-[11px] text-slate-500">Enter each student’s answers; marks, counts, ranks and percentiles are worked out on save.</p>}
          <ErrorBanner message={error} />
          {saved && (
            <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              {saved}
            </p>
          )}
        </div>

        {!view.rows.length ? (
          <Empty>No active students in {view.test.batch.name} yet.</Empty>
        ) : !rows.length ? (
          <Empty>No students match.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px]">
              <thead className="border-b border-slate-100 bg-slate-50/60">
                <tr>
                  <th className={thClass}>Student</th>
                  <th className={thClass}>Roll No</th>
                  <th className={thClass}>Present / Absent</th>
                  <th className={thClass}>Marks</th>
                  <th className={thClass}>Correct</th>
                  <th className={thClass}>Incorrect</th>
                  <th className={thClass}>Unattempted</th>
                  <th className={thClass}>%</th>
                  <th className={thClass}>Rank</th>
                  <th className={thClass}>Percentile</th>
                  <th className={thClass}>Remarks</th>
                  <th className={thClass} aria-label="Actions" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const id = row.student.id
                  const e = entry(id)
                  const r = row.result
                  const changed = !!drafts[id]
                  const off = !editable || e.present !== true
                  const num = 'h-8 w-16 rounded-md border border-slate-200 px-2 text-sm tabular-nums focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400'
                  const preview = mode === 'answers' && e.present ? previewScore(paper, e.answers) : null
                  return (
                    <tr key={id} className={changed ? 'bg-amber-50/40' : 'hover:bg-slate-50/50'}>
                      <td className={tdClass}>
                        <span className="font-semibold text-slate-900">{row.student.fullName}</span>
                        {!row.student.inBatch && <span className="block text-[11px] text-slate-400">No longer in this batch</span>}
                        {changed && <span className="block text-[11px] font-semibold text-amber-700">Unsaved</span>}
                      </td>
                      <td className={`${tdClass} whitespace-nowrap`}>{row.student.rollNumber ?? '—'}</td>
                      <td className={tdClass}>
                        <div className="inline-flex rounded-lg border border-slate-200 p-0.5" role="radiogroup" aria-label={`${row.student.fullName} attendance`}>
                          {(
                            [
                              [true, 'P', 'Present', 'bg-emerald-600'],
                              [false, 'A', 'Absent', 'bg-rose-600'],
                            ] as const
                          ).map(([value, short, label, on]) => (
                            <button
                              key={short}
                              type="button"
                              role="radio"
                              aria-checked={e.present === value}
                              aria-label={label}
                              title={label}
                              disabled={!editable}
                              onClick={() => update(id, value ? { present: true } : { present: false, marks: '', correct: '', incorrect: '', unattempted: '', answers: {} })}
                              className={`h-7 w-8 rounded-md text-xs font-bold transition disabled:cursor-not-allowed ${e.present === value ? `${on} text-white` : 'text-slate-500 hover:bg-slate-50'}`}
                            >
                              {short}
                            </button>
                          ))}
                        </div>
                      </td>
                      {mode === 'marks' ? (
                        <>
                          <td className={tdClass}>
                            <span className="inline-flex items-center gap-1">
                              <input aria-label={`${row.student.fullName} marks`} inputMode="decimal" value={e.marks} disabled={off} onChange={(ev) => update(id, { marks: ev.target.value })} className={num} />
                              <span className="text-xs text-slate-400">/{view.test.totalMarks}</span>
                            </span>
                          </td>
                          {(['correct', 'incorrect', 'unattempted'] as const).map((k) => (
                            <td key={k} className={tdClass}>
                              <input aria-label={`${row.student.fullName} ${k}`} inputMode="numeric" value={e[k]} disabled={off} onChange={(ev) => update(id, { [k]: ev.target.value })} className={`${num} w-14`} />
                            </td>
                          ))}
                        </>
                      ) : (
                        <>
                          <td className={tdClass}>
                            <button
                              type="button"
                              disabled={e.present !== true}
                              onClick={() => setAnswering(row)}
                              className="inline-flex flex-col items-start rounded-md border border-slate-200 px-2.5 py-1 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <span className="tabular-nums">{changed && preview ? `${preview.marks}` : fmt(r?.marks)} / {view.test.totalMarks}</span>
                              <span className="font-normal text-slate-400">{e.present ? `${Object.keys(e.answers).length}/${paper.length} answered` : 'Answers'}</span>
                            </button>
                          </td>
                          <td className={`${tdClass} tabular-nums`}>{changed ? '…' : fmt(r?.correct)}</td>
                          <td className={`${tdClass} tabular-nums`}>{changed ? '…' : fmt(r?.incorrect)}</td>
                          <td className={`${tdClass} tabular-nums`}>{changed ? '…' : fmt(r?.unattempted)}</td>
                        </>
                      )}
                      <td className={`${tdClass} tabular-nums`}>
                        {r?.percent === null || r?.percent === undefined || changed ? (
                          '—'
                        ) : (
                          <span className={r.passed ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-600'}>{r.percent}%</span>
                        )}
                      </td>
                      <td className={`${tdClass} tabular-nums`}>{changed ? '—' : fmt(r?.rank)}</td>
                      <td className={`${tdClass} tabular-nums`}>{changed ? '—' : fmt(r?.percentile)}</td>
                      <td className={tdClass}>
                        <input aria-label={`${row.student.fullName} remarks`} value={e.remarks} maxLength={500} disabled={!editable || e.present === null} onChange={(ev) => update(id, { remarks: ev.target.value })} className={`${num} w-36`} />
                      </td>
                      <td className={`${tdClass} text-right`}>
                        {editable && r && (
                          <button type="button" aria-label={`Clear ${row.student.fullName}'s result`} title="Clear result" onClick={() => setClearing(row)} className={`${iconBtn} hover:text-red-600`}>
                            <Trash2 className="size-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {dirty.length > 0 && editable && (
          <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-5">
            <span className="text-xs font-semibold text-amber-700">
              {dirty.length} unsaved change{dirty.length === 1 ? '' : 's'}
            </span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setDrafts({})} className="h-9 rounded-lg px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100">
                Discard
              </button>
              <button type="button" onClick={() => void save()} disabled={busy} className="inline-flex h-9 items-center gap-2 rounded-lg bg-ink px-3.5 text-sm font-semibold text-white hover:bg-ink-hover disabled:opacity-50">
                <Save className="size-4" /> {busy ? 'Saving…' : 'Save Results'}
              </button>
            </div>
          </div>
        )}
      </Card>

      {answering && (
        <AnswersDialog
          student={answering.student}
          paper={paper}
          totalMarks={view.test.totalMarks}
          answers={entry(answering.student.id).answers}
          readOnly={!editable}
          onApply={(answers) => update(answering.student.id, { answers })}
          onClose={() => setAnswering(null)}
        />
      )}
      {clearing && (
        <ConfirmDialog
          title="Clear result?"
          message={`${clearing.student.fullName}'s result for this test is removed (use this for a result entered by mistake).`}
          confirmLabel="Clear Result"
          onConfirm={async () => {
            await api(`${base}/tests/${view.test.id}/results/${clearing.student.id}`, { method: 'DELETE' })
            setDrafts((d) => {
              const copy = { ...d }
              delete copy[clearing.student.id]
              return copy
            })
            await invalidate()
          }}
          onClose={() => setClearing(null)}
        />
      )}
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
      <dt className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">{label}</dt>
      <dd className="mt-1 text-lg font-black text-slate-900 tabular-nums">{value}</dd>
      {hint && <dd className="text-[11px] text-slate-500">{hint}</dd>}
    </div>
  )
}
