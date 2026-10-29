import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, CircleAlert, Lock, Plus, Search, X } from 'lucide-react'
import { api } from '@/lib/api'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner } from '@/components/ui/form'
import { btnPrimary, btnSecondary, inputClass } from '@/components/ui/formStyles'
import { allMatchingQuestions, SELECT_ALL_LIMIT, answerLabel, DIFFICULTY_LABELS, paperTotal, TYPE_LABELS, useInvalidateAssessments, useQuestions, type Options, type PaperQuestion, type Question, type TestDetail } from './api'
import { Card, DifficultyBadge, Empty, FilterSelect, iconBtn, Pager, TypeBadge } from './ui'

/** A question on the draft paper: `key` is its paper id (already on it) or its bank id (being added). */
type Item = { key: string; questionId: string | null; text: string; subject: string; topic: string; difficulty: PaperQuestion['difficulty']; type: PaperQuestion['type']; options: string[]; correctAnswer: string | null; marks: number; negativeMarks: number }

const fromPaper = (q: PaperQuestion): Item => ({ key: q.id, questionId: q.questionId, text: q.text, subject: q.subject, topic: q.topic, difficulty: q.difficulty, type: q.type, options: q.options, correctAnswer: q.correctAnswer, marks: q.marks, negativeMarks: q.negativeMarks })
const fromBank = (q: Question): Item => ({ key: q.id, questionId: q.id, text: q.text, subject: q.subject, topic: q.topic, difficulty: q.difficulty, type: q.type, options: q.options, correctAnswer: q.correctAnswer, marks: q.marks, negativeMarks: q.negativeMarks })

/** The test's paper (PRD 5.11 "attach questions from the bank"): pick, order, save. Fixed once answers are entered. */
export function PaperBuilder({ base, detail, options }: { base: string; detail: TestDetail; options: Options }) {
  const client = useQueryClient()
  const invalidate = useInvalidateAssessments(base)
  const saved = detail.paper.questions.map(fromPaper)
  const [items, setItems] = useState<Item[]>(saved)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const savedKey = saved.map((i) => i.key).join(',')
  // When the saved paper changes (after a save, or someone else's), start from it again.
  const [syncedKey, setSyncedKey] = useState(savedKey)
  if (syncedKey !== savedKey) {
    setSyncedKey(savedKey)
    setItems(saved)
  }
  const dirty = items.map((i) => i.key).join(',') !== savedKey
  const locked = detail.paper.locked
  const editable = !locked && options.active && detail.test.phase !== 'CANCELLED'
  const total = paperTotal(items)
  const move = (i: number, by: number) =>
    setItems((list) => {
      const next = [...list]
      ;[next[i], next[i + by]] = [next[i + by], next[i]]
      return next
    })

  async function save() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await api(`${base}/tests/${detail.test.id}/paper`, { method: 'PUT', body: JSON.stringify({ questionIds: items.map((i) => i.key) }) })
      await Promise.all([client.invalidateQueries({ queryKey: [base, 'test', detail.test.id] }), invalidate()])
      setNotice(`Paper saved with ${items.length} question${items.length === 1 ? '' : 's'}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the paper')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <h3 className="text-base font-bold text-slate-900">Question Paper</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {items.length} question{items.length === 1 ? '' : 's'} · {total} marks · test out of {detail.test.totalMarks}
          </p>
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setPicking(true)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <Plus className="size-4" /> Add from Question Bank
            </button>
            {dirty && (
              <>
                <button type="button" onClick={() => setItems(saved)} className="h-9 rounded-lg px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100">
                  Discard
                </button>
                <button type="button" onClick={() => void save()} disabled={busy} className="inline-flex h-9 items-center rounded-lg bg-ink px-3.5 text-sm font-semibold text-white hover:bg-ink-hover disabled:opacity-60">
                  {busy ? 'Saving…' : 'Save Paper'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <div className="space-y-3 p-4 empty:hidden sm:px-5">
        {locked && (
          <p className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
            <Lock className="size-4 shrink-0" /> Answers are recorded against this paper, so it’s fixed.
          </p>
        )}
        {items.length > 0 && total !== detail.test.totalMarks && (
          <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
            <CircleAlert className="size-4 shrink-0" />
            {total > detail.test.totalMarks
              ? `The paper adds up to ${total} marks, more than the test’s ${detail.test.totalMarks}. Remove questions or raise the test’s total marks, or scores from answers can’t be saved.`
              : `The paper adds up to ${total} of the test’s ${detail.test.totalMarks} marks.`}
          </p>
        )}
        <ErrorBanner message={error} />
        {notice && !dirty && (
          <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            {notice}
          </p>
        )}
      </div>
      {!items.length ? (
        <Empty>{editable ? 'No questions yet. Add them from the question bank.' : 'This test has no paper.'}</Empty>
      ) : (
        <ol className="divide-y divide-slate-100">
          {items.map((q, i) => (
            <li key={q.key} className="flex gap-3 px-4 py-3 sm:px-5">
              <span className="w-7 shrink-0 pt-0.5 text-sm font-bold text-slate-400 tabular-nums">{i + 1}.</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm whitespace-pre-line text-slate-800 [overflow-wrap:anywhere]">{q.text}</p>
                {q.type === 'MCQ' && (
                  <ul className="mt-1.5 grid gap-x-4 gap-y-0.5 text-xs text-slate-600 sm:grid-cols-2">
                    {q.options.map((o, j) => (
                      <li key={j} className={q.correctAnswer === 'ABCD'[j] ? 'font-semibold text-emerald-700' : ''}>
                        ({'ABCD'[j]}) {o}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                  <TypeBadge value={q.type} /> <DifficultyBadge value={q.difficulty} /> {q.subject} · {q.topic} · +{q.marks}
                  {q.negativeMarks ? ` / −${q.negativeMarks}` : ''}
                  {q.type !== 'MCQ' && <span>· Answer: {answerLabel(q)}</span>}
                  {!q.questionId && <span className="text-slate-400">· removed from the bank (kept on this paper)</span>}
                </p>
              </div>
              {editable && (
                <div className="flex shrink-0 flex-col items-center gap-0.5 sm:flex-row">
                  <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className={iconBtn}>
                    <ArrowUp className="size-4" />
                  </button>
                  <button type="button" aria-label="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)} className={iconBtn}>
                    <ArrowDown className="size-4" />
                  </button>
                  <button type="button" aria-label="Remove from paper" onClick={() => setItems((list) => list.filter((x) => x.key !== q.key))} className={`${iconBtn} hover:text-red-600`}>
                    <X className="size-4" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {picking && (
        <BankPicker
          base={base}
          options={options}
          subject={detail.test.subject}
          taken={new Set(items.flatMap((i) => (i.questionId ? [i.questionId] : [])))}
          onAdd={(qs) => setItems((list) => [...list, ...qs.map(fromBank)])}
          onClose={() => setPicking(false)}
        />
      )}
    </Card>
  )
}

/** The school's question bank, to pick questions for a paper (teachers see every teacher's questions here). */
function BankPicker({ base, options, subject, taken, onAdd, onClose }: { base: string; options: Options; subject: string; taken: Set<string>; onAdd: (qs: Question[]) => void; onClose: () => void }) {
  const [filters, setFilters] = useState({ subject, difficulty: '', type: '', q: '' })
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [picked, setPicked] = useState<Question[]>([])
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.q === search.trim() ? f : { ...f, q: search.trim() }))
      setPage(1)
    }, 250)
    return () => clearTimeout(t)
  }, [search])
  const list = useQuestions(base, { ...filters, bank: 'school', page, pageSize: 20 })
  const items = list.data?.items ?? []
  const setF = (k: keyof typeof filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }))
    setPage(1)
  }
  const toggle = (q: Question) => setPicked((p) => (p.some((x) => x.id === q.id) ? p.filter((x) => x.id !== q.id) : [...p, q]))
  // Questions already on the paper can't be picked again.
  const selectable = items.filter((q) => !taken.has(q.id))
  const pageAllOn = selectable.length > 0 && selectable.every((q) => picked.some((p) => p.id === q.id))
  const add = (qs: Question[]) => setPicked((p) => [...p, ...qs.filter((q) => !taken.has(q.id) && !p.some((x) => x.id === q.id))])
  const togglePage = () => (pageAllOn ? setPicked((p) => p.filter((x) => !selectable.some((q) => q.id === x.id))) : add(selectable))
  const total = list.data?.total ?? 0
  const [selectingAll, setSelectingAll] = useState(false)
  const [selectError, setSelectError] = useState<string | null>(null)
  async function selectAllMatching() {
    // The search box may still be waiting out its debounce: use what's typed now,
    // and show that same result in the list.
    const latest = { ...filters, q: search.trim() }
    if (latest.q !== filters.q) {
      setFilters(latest)
      setPage(1)
    }
    setSelectingAll(true)
    setSelectError(null)
    try {
      add(await allMatchingQuestions(base, { ...latest, bank: 'school' }))
    } catch (err) {
      setSelectError(err instanceof Error ? err.message : 'Could not load all the questions')
    } finally {
      setSelectingAll(false)
    }
  }

  return (
    <Dialog title="Add from Question Bank" description="The school’s whole bank. Questions are copied onto the paper as they are now." onClose={onClose} widthClass="max-w-3xl">
      <div className="space-y-3 px-6 py-5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search questions, topics, sources…" aria-label="Search the bank" className={`${inputClass()} pl-9`} />
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 [&>div]:sm:w-auto">
          <FilterSelect label="Subject" all="All Subjects" value={filters.subject} options={options.subjects.map((s) => ({ value: s, label: s }))} onChange={(v) => setF('subject', v)} />
          <FilterSelect label="Difficulty" all="All Difficulties" value={filters.difficulty} options={options.difficulties.map((d) => ({ value: d, label: DIFFICULTY_LABELS[d] }))} onChange={(v) => setF('difficulty', v)} />
          <FilterSelect label="Type" all="All Types" value={filters.type} options={options.questionTypes.map((t) => ({ value: t, label: TYPE_LABELS[t] }))} onChange={(v) => setF('type', v)} />
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200">
          {items.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
              <label className={`flex items-center gap-3 text-xs font-semibold text-slate-600 ${selectable.length ? 'cursor-pointer' : 'opacity-50'}`}>
                <input type="checkbox" disabled={!selectable.length} checked={pageAllOn} onChange={togglePage} className="size-4 shrink-0 accent-ink" />
                {total > items.length ? `Select all ${selectable.length} on this page` : `Select all ${selectable.length}`}
              </label>
              <div className="flex items-center gap-3 text-xs font-semibold">
                {total > items.length && (
                  <button type="button" onClick={selectAllMatching} disabled={selectingAll} className="text-brand-600 hover:underline disabled:opacity-60">
                    {selectingAll ? 'Selecting…' : total > SELECT_ALL_LIMIT ? `Select all matching (up to ${SELECT_ALL_LIMIT.toLocaleString('en-IN')})` : `Select all ${total} matching`}
                  </button>
                )}
                {picked.length > 0 && (
                  <button type="button" onClick={() => setPicked([])} className="text-slate-500 hover:text-slate-700 hover:underline">
                    Clear selection
                  </button>
                )}
              </div>
            </div>
          )}
          {selectError && <div className="px-3 pt-2"><ErrorBanner message={selectError} /></div>}
          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {items.map((q) => {
              const on = taken.has(q.id)
              return (
                <li key={q.id}>
                  <label className={`flex items-start gap-3 px-3 py-2.5 ${on ? 'opacity-50' : 'cursor-pointer hover:bg-slate-50'}`}>
                    <input type="checkbox" disabled={on} checked={on || picked.some((p) => p.id === q.id)} onChange={() => toggle(q)} className="mt-0.5 size-4 shrink-0 accent-ink" />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm text-slate-800">{q.text}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                        {q.subject} · {q.topic} · {TYPE_LABELS[q.type]} · +{q.marks}
                        {q.negativeMarks ? `/−${q.negativeMarks}` : ''} · {q.author.name} <DifficultyBadge value={q.difficulty} />
                        {on && <span className="font-semibold">On the paper</span>}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
            {!items.length && <li className="px-3 py-10 text-center text-sm text-slate-400">{list.isLoading ? 'Loading…' : 'No questions match. Add questions to the bank first.'}</li>}
          </ul>
          <Pager page={page} pageSize={20} total={list.data?.total ?? 0} onPage={setPage} noun="questions" />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
        <span className="text-xs font-semibold text-slate-500">
          {picked.length} selected · {paperTotal(picked)} marks
        </span>
        <div className="flex gap-3">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!picked.length}
            onClick={() => {
              onAdd(picked)
              onClose()
            }}
            className={btnPrimary}
          >
            Add {picked.length || ''} to Paper
          </button>
        </div>
      </div>
    </Dialog>
  )
}
