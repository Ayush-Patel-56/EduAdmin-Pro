import { useEffect, useState } from 'react'
import { FileDown, Search } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner, Field } from '@/components/ui/form'
import { btnPrimary, btnSecondary, inputClass, textareaClass } from '@/components/ui/formStyles'
import { DIFFICULTY_LABELS, paperTotal, TYPE_LABELS, useQuestions, type Options, type Question } from './api'
import { paperPdf, type PaperHeader } from './pdf'
import { DifficultyBadge, FilterSelect, Pager } from './ui'

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'question-paper'

/** Export Question Paper to PDF (PRD 4.10): pick questions from the bank and print them as a paper. */
export function ExportPaperDialog({ base, options, institute, onClose }: { base: string; options: Options; institute: string; onClose: () => void }) {
  const [header, setHeader] = useState<PaperHeader>({ institute, title: '', subject: '', date: '', duration: '', totalMarks: '', instructions: '' })
  const [showMarks, setShowMarks] = useState(true)
  const [answerKey, setAnswerKey] = useState(false)
  const [filters, setFilters] = useState({ subject: '', difficulty: '', type: '', q: '' })
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [picked, setPicked] = useState<Question[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.q === search.trim() ? f : { ...f, q: search.trim() }))
      setPage(1)
    }, 250)
    return () => clearTimeout(t)
  }, [search])
  const list = useQuestions(base, { ...filters, page, pageSize: 25 })
  const items = list.data?.items ?? []
  const isPicked = (id: string) => picked.some((p) => p.id === id)
  const toggle = (q: Question) => setPicked((p) => (p.some((x) => x.id === q.id) ? p.filter((x) => x.id !== q.id) : [...p, q]))
  const allOnPage = items.length > 0 && items.every((q) => isPicked(q.id))
  const setH = <K extends keyof PaperHeader>(k: K, v: string) => setHeader((h) => ({ ...h, [k]: v }))
  const setF = (k: keyof typeof filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }))
    setPage(1)
  }

  async function generate() {
    if (!header.title.trim()) return setError('Enter the paper title')
    if (!picked.length) return setError('Select at least one question')
    setBusy(true)
    setError(null)
    try {
      const doc = await paperPdf({ ...header, totalMarks: header.totalMarks || String(paperTotal(picked)) }, picked, { showMarks, answerKey })
      doc.save(`${slug(header.title)}.pdf`)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not make the PDF')
      setBusy(false)
    }
  }

  return (
    <Dialog title="Export Question Paper to PDF" description="Choose questions from the bank and print them as a paper." onClose={onClose} widthClass="max-w-4xl">
      <div className="grid gap-6 px-6 py-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-4">
          <p className="text-xs font-bold tracking-wider text-slate-700 uppercase">Header Settings</p>
          <Field id="p-inst" label="Institute Name">
            <input id="p-inst" value={header.institute} maxLength={120} onChange={(e) => setH('institute', e.target.value)} className={inputClass()} />
          </Field>
          <Field id="p-title" label="Paper Title *">
            <input id="p-title" value={header.title} maxLength={150} onChange={(e) => setH('title', e.target.value)} placeholder="e.g. Physics Unit Test 2" className={inputClass()} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="p-subject" label="Subject">
              <input id="p-subject" value={header.subject} maxLength={60} onChange={(e) => setH('subject', e.target.value)} className={inputClass()} />
            </Field>
            <Field id="p-date" label="Date">
              <input id="p-date" value={header.date} maxLength={40} onChange={(e) => setH('date', e.target.value)} placeholder="e.g. 20 Oct 2026" className={inputClass()} />
            </Field>
            <Field id="p-duration" label="Duration">
              <input id="p-duration" value={header.duration} maxLength={40} onChange={(e) => setH('duration', e.target.value)} placeholder="e.g. 3 hours" className={inputClass()} />
            </Field>
            <Field id="p-total" label="Max. Marks" hint={`Selected questions: ${paperTotal(picked)}`}>
              <input id="p-total" value={header.totalMarks} maxLength={10} onChange={(e) => setH('totalMarks', e.target.value)} placeholder={String(paperTotal(picked) || '')} className={inputClass()} />
            </Field>
          </div>
          <Field id="p-instr" label="Instructions">
            <textarea id="p-instr" rows={3} value={header.instructions} maxLength={2000} onChange={(e) => setH('instructions', e.target.value)} placeholder="Optional, printed under the header" className={textareaClass()} />
          </Field>
          <p className="pt-1 text-xs font-bold tracking-wider text-slate-700 uppercase">Formatting Options</p>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={showMarks} onChange={(e) => setShowMarks(e.target.checked)} className="size-4 accent-ink" /> Show marks per question
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={answerKey} onChange={(e) => setAnswerKey(e.target.checked)} className="size-4 accent-ink" /> Include answer key (last page)
          </label>
        </div>

        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-bold tracking-wider text-slate-700 uppercase">Select Questions</p>
            <span className="text-xs font-semibold text-slate-500">
              {picked.length} selected · {paperTotal(picked)} marks
            </span>
          </div>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search questions, topics…" aria-label="Search questions" className={`${inputClass()} pl-9`} />
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3 [&>div]:sm:w-auto">
            <FilterSelect label="Subject" all="All Subjects" value={filters.subject} options={options.subjects.map((s) => ({ value: s, label: s }))} onChange={(v) => setF('subject', v)} />
            <FilterSelect label="Difficulty" all="All Difficulties" value={filters.difficulty} options={options.difficulties.map((d) => ({ value: d, label: DIFFICULTY_LABELS[d] }))} onChange={(v) => setF('difficulty', v)} />
            <FilterSelect label="Type" all="All Types" value={filters.type} options={options.questionTypes.map((t) => ({ value: t, label: TYPE_LABELS[t] }))} onChange={(v) => setF('type', v)} />
          </div>
          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
            <label className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
              <input
                type="checkbox"
                checked={allOnPage}
                disabled={!items.length}
                onChange={() => setPicked((p) => (allOnPage ? p.filter((x) => !items.some((q) => q.id === x.id)) : [...p, ...items.filter((q) => !p.some((x) => x.id === q.id))]))}
                className="size-4 accent-ink"
              />
              Select all on this page
            </label>
            <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
              {items.map((q) => (
                <li key={q.id}>
                  <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-slate-50">
                    <input type="checkbox" checked={isPicked(q.id)} onChange={() => toggle(q)} className="mt-0.5 size-4 shrink-0 accent-ink" />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm text-slate-800">{q.text}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                        {q.subject} · {q.topic} · {TYPE_LABELS[q.type]} · {q.marks} marks <DifficultyBadge value={q.difficulty} />
                      </span>
                    </span>
                  </label>
                </li>
              ))}
              {!items.length && <li className="px-3 py-10 text-center text-sm text-slate-400">{list.isLoading ? 'Loading…' : 'No questions match.'}</li>}
            </ul>
            <Pager page={page} pageSize={25} total={list.data?.total ?? 0} onPage={setPage} noun="questions" />
          </div>
          {error && (
            <div className="mt-3">
              <ErrorBanner message={error} />
            </div>
          )}
        </div>
      </div>
      <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
        <button type="button" onClick={onClose} className={btnSecondary}>
          Cancel
        </button>
        <button type="button" onClick={() => void generate()} disabled={busy} className={btnPrimary}>
          <FileDown className="size-4" /> {busy ? 'Generating…' : 'Generate PDF'}
        </button>
      </div>
    </Dialog>
  )
}
