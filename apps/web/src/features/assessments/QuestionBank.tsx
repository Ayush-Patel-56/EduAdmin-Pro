import { useEffect, useState } from 'react'
import { BookOpen, FileDown, Filter, GraduationCap, Pencil, Plus, Search, Trash2, Upload, UserRound } from 'lucide-react'
import { api } from '@/lib/api'
import { ConfirmDialog, ErrorBanner } from '@/components/ui/form'
import { answerLabel, DIFFICULTY_LABELS, useInvalidateAssessments, useQuestions, type Options, type Question, type QuestionFilters } from './api'
import { ExportPaperDialog } from './ExportPaperDialog'
import { QuestionDialog } from './QuestionDialog'
import { Card, DifficultyBadge, Empty, FilterSelect, iconBtn, Pager, Spinner, tdClass, thClass, TypeBadge } from './ui'
import { UploadPdfDialog } from './UploadPdfDialog'

const PAGE_SIZE = 20

type Props = {
  base: string
  options: Options
  /** "admin": the school's whole bank (Question Bank Overview); "faculty": the teacher's own (My Question Bank). */
  variant: 'admin' | 'faculty'
  institute?: string
}

export function QuestionBank({ base, options, variant, institute = '' }: Props) {
  const admin = variant === 'admin'
  const [filters, setFilters] = useState<QuestionFilters>({ page: 1, pageSize: PAGE_SIZE })
  const [search, setSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === (search.trim() || undefined) ? f : { ...f, q: search.trim() || undefined, page: 1 })), 250)
    return () => clearTimeout(t)
  }, [search])
  const list = useQuestions(base, filters)
  const invalidate = useInvalidateAssessments(base)
  const [dialog, setDialog] = useState<'add' | 'upload' | 'export' | null>(null)
  const [editing, setEditing] = useState<Question | null>(null)
  const [deleting, setDeleting] = useState<Question | null>(null)
  const set = (key: keyof QuestionFilters, value: string) => setFilters((f) => ({ ...f, [key]: value || undefined, ...(key === 'subject' && { chapterId: undefined }), page: 1 }))
  const canWrite = options.active
  const data = list.data
  const chapters = options.chapters.filter((c) => !filters.subject || c.subject === filters.subject)
  const filtered = !!(filters.q || filters.subject || filters.difficulty || filters.chapterId || filters.author)

  return (
    <Card>
      <div className="flex flex-col gap-4 border-b border-slate-100 p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">{admin ? 'Question Bank Overview' : 'My Question Bank'}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{admin ? 'Every question in the school’s bank, by faculty and admins.' : 'Questions you’ve added. Build test papers from the whole school bank.'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {admin && (
              <button type="button" onClick={() => setDialog('export')} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                <FileDown className="size-4" /> Export PDF
              </button>
            )}
            {canWrite && (
              <>
                <button type="button" onClick={() => setDialog('upload')} className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-3.5 text-sm font-semibold text-white hover:bg-emerald-700">
                  <Upload className="size-4" /> Upload PDF
                </button>
                <button type="button" onClick={() => setDialog('add')} className="inline-flex h-9 items-center gap-2 rounded-lg bg-ink px-3.5 text-sm font-semibold text-white hover:bg-ink-hover">
                  <Plus className="size-4" /> Add Question
                </button>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative w-full sm:max-w-xs sm:flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search questions, topics, sources…"
              aria-label="Search questions"
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pr-3 pl-9 text-sm focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
            />
          </div>
          <FilterSelect label="Subject" icon={BookOpen} all="All Subjects" value={filters.subject ?? ''} options={options.subjects.map((s) => ({ value: s, label: s }))} onChange={(v) => set('subject', v)} />
          {!admin && <FilterSelect label="Chapter" icon={GraduationCap} all="All Chapters" value={filters.chapterId ?? ''} options={chapters.map((c) => ({ value: c.id, label: c.name }))} onChange={(v) => set('chapterId', v)} />}
          <FilterSelect label="Difficulty" icon={Filter} all="All Difficulties" value={filters.difficulty ?? ''} options={options.difficulties.map((d) => ({ value: d, label: DIFFICULTY_LABELS[d] }))} onChange={(v) => set('difficulty', v)} />
          {admin && (
            <FilterSelect
              label="Faculty"
              icon={UserRound}
              all="All Faculty"
              value={filters.author ?? ''}
              options={[{ value: 'admin', label: 'Admins' }, ...options.faculty.map((f) => ({ value: f.id, label: f.name }))]}
              onChange={(v) => set('author', v)}
            />
          )}
        </div>
      </div>

      {list.error && (
        <div className="p-4">
          <ErrorBanner message={list.error.message} />
        </div>
      )}
      {!data && !list.error ? (
        <Spinner />
      ) : data && !data.items.length ? (
        <Empty>{filtered ? 'No questions match these filters.' : admin ? 'The question bank is empty. Add questions or upload a PDF to start.' : 'You haven’t added any questions yet. Add one or upload a PDF.'}</Empty>
      ) : (
        data && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead className="border-b border-slate-100 bg-slate-50/60">
                <tr>
                  {admin ? (
                    <>
                      <th className={thClass}>Topic</th>
                      <th className={thClass}>Subject</th>
                      <th className={thClass}>Question Details</th>
                      <th className={thClass}>Difficulty</th>
                      <th className={thClass}>Type</th>
                      <th className={thClass}>Faculty</th>
                      <th className={thClass}>Correct Answer</th>
                    </>
                  ) : (
                    <>
                      <th className={thClass}>Question</th>
                      <th className={thClass}>Type</th>
                      <th className={thClass}>Difficulty</th>
                      <th className={thClass}>Marks</th>
                      <th className={thClass}>Source</th>
                    </>
                  )}
                  <th className={`${thClass} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((q) => (
                  <tr key={q.id} className="hover:bg-slate-50/50">
                    {admin ? (
                      <>
                        <td className={`${tdClass} font-semibold text-slate-900`}>
                          {q.topic}
                          {q.chapter?.name && <span className="block text-[11px] font-normal text-slate-400">{q.chapter.name}</span>}
                        </td>
                        <td className={tdClass}>{q.subject}</td>
                        <td className={`${tdClass} max-w-sm`}>
                          <span className="line-clamp-2 [overflow-wrap:anywhere]" title={q.text}>
                            {q.text}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-slate-400">
                            {q.marks} marks{q.negativeMarks ? ` · −${q.negativeMarks}` : ''} · {q.source}
                          </span>
                        </td>
                        <td className={tdClass}>
                          <DifficultyBadge value={q.difficulty} />
                        </td>
                        <td className={tdClass}>
                          <TypeBadge value={q.type} />
                        </td>
                        <td className={`${tdClass} whitespace-nowrap`}>
                          {q.author.name}
                          {!q.author.facultyId && <span className="block text-[11px] text-slate-400">Admin</span>}
                        </td>
                        <td className={`${tdClass} max-w-[180px] font-semibold text-emerald-700`}>
                          <span className="line-clamp-2 [overflow-wrap:anywhere]">{answerLabel(q)}</span>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className={`${tdClass} max-w-md`}>
                          <span className="line-clamp-2 font-medium text-slate-900 [overflow-wrap:anywhere]" title={q.text}>
                            {q.text}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-slate-400">
                            {q.subject} · {q.chapter?.name ? `${q.chapter.name} · ` : ''}
                            {q.topic} · Answer: {answerLabel(q)}
                          </span>
                        </td>
                        <td className={tdClass}>
                          <TypeBadge value={q.type} />
                        </td>
                        <td className={tdClass}>
                          <DifficultyBadge value={q.difficulty} />
                        </td>
                        <td className={`${tdClass} whitespace-nowrap tabular-nums`}>
                          +{q.marks}
                          {q.negativeMarks ? <span className="text-rose-600"> / −{q.negativeMarks}</span> : null}
                        </td>
                        <td className={tdClass}>
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{q.source}</span>
                        </td>
                      </>
                    )}
                    <td className={`${tdClass} text-right whitespace-nowrap`}>
                      <button type="button" aria-label="Edit question" title="Edit" disabled={!canWrite} onClick={() => setEditing(q)} className={iconBtn}>
                        <Pencil className="size-4" />
                      </button>
                      <button type="button" aria-label="Delete question" title="Delete" disabled={!canWrite} onClick={() => setDeleting(q)} className={`${iconBtn} hover:text-red-600`}>
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setFilters((f) => ({ ...f, page }))} noun="questions" />}

      {dialog === 'add' && <QuestionDialog base={base} options={options} question={null} withSource={!admin} onSaved={invalidate} onClose={() => setDialog(null)} />}
      {editing && <QuestionDialog base={base} options={options} question={editing} withSource={!admin} onSaved={invalidate} onClose={() => setEditing(null)} />}
      {dialog === 'upload' && <UploadPdfDialog base={base} onImported={invalidate} onClose={() => setDialog(null)} />}
      {dialog === 'export' && <ExportPaperDialog base={base} options={options} institute={institute} onClose={() => setDialog(null)} />}
      {deleting && (
        <ConfirmDialog
          title="Delete question?"
          message={
            <>
              <p className="line-clamp-3 font-medium text-slate-800">{deleting.text}</p>
              <p className="mt-2">It’s removed from the bank. Tests that already use it keep their copy, and their results stay.</p>
            </>
          }
          confirmLabel="Delete"
          onConfirm={async () => {
            await api(`${base}/questions/${deleting.id}`, { method: 'DELETE' })
            await invalidate()
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </Card>
  )
}
