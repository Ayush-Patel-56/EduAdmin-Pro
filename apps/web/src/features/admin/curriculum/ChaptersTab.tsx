import { useState, type FormEvent } from 'react'
import { Check, Clock, Layers, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { ConfirmDialog, ErrorBanner, Field } from '@/components/ui/form'
import { btnPrimary, btnSecondary, inputClass, labelClass } from '@/components/ui/formStyles'
import {
  curriculumApi,
  useChapters,
  useConcepts,
  useRefreshCurriculum,
  type Chapter,
  type Concept,
  type CurriculumOptions,
} from './api'

type ChaptersTabProps = {
  schoolId: string
  options: CurriculumOptions
  subject: string
  onSubjectChange: (subject: string) => void
}

export function ChaptersTab({ schoolId, options, subject, onSubjectChange }: ChaptersTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { data: chapters, error, isPending } = useChapters(schoolId, subject)
  // A chapter from another subject (or one just deleted) is never "selected".
  const selected = chapters?.find((c) => c.id === selectedId) ?? null

  return (
    <>
      <div className="max-w-xs">
        <label htmlFor="curriculum-subject" className={labelClass}>Subject</label>
        <select
          id="curriculum-subject"
          value={subject}
          onChange={(e) => {
            onSubjectChange(e.target.value)
            setSelectedId(null)
          }}
          className={inputClass()}
        >
          {options.subjects.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold tracking-wide text-slate-900 uppercase">Chapters</h2>
          <AddChapterForm schoolId={schoolId} options={options} subject={subject} onAdded={setSelectedId} />
          <div className="mt-4">
            <ErrorBanner message={error?.message} />
            {isPending ? (
              <Loader2 className="mx-auto size-5 animate-spin text-slate-300" aria-label="Loading" />
            ) : chapters?.length === 0 ? (
              <p className="text-xs text-slate-400">No chapters yet for this subject.</p>
            ) : (
              <ul className="space-y-2">
                {chapters?.map((c) => (
                  <ChapterItem
                    key={c.id}
                    schoolId={schoolId}
                    options={options}
                    chapter={c}
                    selected={c.id === selected?.id}
                    onSelect={() => setSelectedId(c.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold tracking-wide text-slate-900 uppercase">Concepts</h2>
          {selected ? (
            <ConceptsPanel key={selected.id} schoolId={schoolId} chapter={selected} />
          ) : (
            <p className="mt-4 text-xs text-slate-400">Select a chapter to manage its concepts.</p>
          )}
        </section>
      </div>
    </>
  )
}

type ChapterValues = {
  name: string
  code: string
  board: string
  classLevel: string
  programId: string
  expectedHours: string
}

const emptyChapter: ChapterValues = { name: '', code: '', board: '', classLevel: '', programId: '', expectedHours: '' }

const toBody = (subject: string, v: ChapterValues) => ({
  subject,
  name: v.name,
  code: v.code || null,
  board: v.board || null,
  classLevel: v.classLevel || null,
  programId: v.programId || null,
  expectedHours: v.expectedHours === '' ? null : Number(v.expectedHours),
})

function validateChapter(v: ChapterValues) {
  if (!v.name.trim()) return 'Chapter name is required'
  if (v.expectedHours !== '' && !/^\d{1,4}$/.test(v.expectedHours)) return 'Expected hours must be a whole number'
  return null
}

function ChapterFields({ v, set, options, idPrefix }: { v: ChapterValues; set: (k: keyof ChapterValues, value: string) => void; options: CurriculumOptions; idPrefix: string }) {
  const field = `${inputClass()} bg-slate-50 focus:bg-white`
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <input id={`${idPrefix}-name`} aria-label="Chapter name" value={v.name} onChange={(e) => set('name', e.target.value)} placeholder="Chapter name *" maxLength={150} className={field} />
      <input
        id={`${idPrefix}-code`}
        aria-label="Chapter code"
        value={v.code}
        onChange={(e) => set('code', e.target.value.toUpperCase())}
        placeholder="Chapter Code (e.g. PHY-11-CH03)"
        maxLength={40}
        spellCheck={false}
        className={`${field} font-mono placeholder:font-sans`}
      />
      <select aria-label="Board" value={v.board} onChange={(e) => set('board', e.target.value)} className={field}>
        <option value="">No board</option>
        {options.boards.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
      <select aria-label="Class" value={v.classLevel} onChange={(e) => set('classLevel', e.target.value)} className={field}>
        <option value="">No class</option>
        {/* Keep a class the school no longer offers selectable on chapters that already use it. */}
        {[...options.classes, ...(v.classLevel && !options.classes.includes(v.classLevel) ? [v.classLevel] : [])].map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      <select aria-label="Program" value={v.programId} onChange={(e) => set('programId', e.target.value)} className={field}>
        <option value="">No program</option>
        {options.programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <input
        aria-label="Expected hours"
        inputMode="numeric"
        value={v.expectedHours}
        onChange={(e) => set('expectedHours', e.target.value.replace(/\D/g, '').slice(0, 4))}
        placeholder="Expected hours"
        className={field}
      />
    </div>
  )
}

function AddChapterForm({ schoolId, options, subject, onAdded }: { schoolId: string; options: CurriculumOptions; subject: string; onAdded: (id: string) => void }) {
  const refresh = useRefreshCurriculum(schoolId)
  const [values, setValues] = useState<ChapterValues>(emptyChapter)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof ChapterValues, value: string) => {
    setValues((v) => ({ ...v, [k]: value }))
    setError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = validateChapter(values)
    if (problem) return setError(problem)
    setBusy(true)
    try {
      const chapter = await curriculumApi.createChapter(schoolId, toBody(subject, values))
      // Keep board/class/program for the next chapter, which is usually in the same set.
      setValues((v) => ({ ...emptyChapter, board: v.board, classLevel: v.classLevel, programId: v.programId }))
      await refresh()
      onAdded(chapter.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the chapter')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-4 space-y-3">
      <ChapterFields v={values} set={set} options={options} idPrefix="new-chapter" />
      <ErrorBanner message={error} />
      <button type="submit" disabled={busy} className={`${btnPrimary} h-9`}>
        <Plus className="size-4" /> {busy ? 'Adding…' : 'Add Chapter'}
      </button>
    </form>
  )
}

type ChapterItemProps = { schoolId: string; options: CurriculumOptions; chapter: Chapter; selected: boolean; onSelect: () => void }

function ChapterItem({ schoolId, options, chapter, selected, onSelect }: ChapterItemProps) {
  const refresh = useRefreshCurriculum(schoolId)
  const [modal, setModal] = useState<'edit' | 'delete' | null>(null)
  const meta = [chapter.board, chapter.classLevel, chapter.program?.name].filter(Boolean)
  return (
    <li>
      <div
        className={`group flex items-start gap-3 rounded-xl border px-3.5 py-3 transition ${
          selected ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-400' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
        }`}
      >
        <button type="button" onClick={onSelect} aria-pressed={selected} className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm font-semibold text-slate-900">{chapter.name}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
            {chapter.code && <span className="font-mono text-slate-700">{chapter.code}</span>}
            {meta.map((m) => (
              <span key={m as string} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{m}</span>
            ))}
            {chapter.expectedHours !== null && (
              <span className="inline-flex items-center gap-1"><Clock className="size-3" /> {chapter.expectedHours} hrs</span>
            )}
            <span className="inline-flex items-center gap-1">
              <Layers className="size-3" /> {chapter.conceptCount} concept{chapter.conceptCount === 1 ? '' : 's'}
            </span>
          </p>
        </button>
        <div className="flex shrink-0 gap-1 opacity-60 group-hover:opacity-100">
          <button type="button" onClick={() => setModal('edit')} aria-label={`Edit ${chapter.name}`} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <Pencil className="size-3.5" />
          </button>
          <button type="button" onClick={() => setModal('delete')} aria-label={`Delete ${chapter.name}`} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
      {modal === 'edit' && <EditChapterDialog schoolId={schoolId} options={options} chapter={chapter} onClose={() => setModal(null)} />}
      {modal === 'delete' && (
        <ConfirmDialog
          title="Delete chapter?"
          message={
            <>
              <strong className="text-slate-900">{chapter.name}</strong>
              {chapter.conceptCount > 0 && <> and its {chapter.conceptCount} concept{chapter.conceptCount === 1 ? '' : 's'}</>} will be
              removed from the curriculum.
            </>
          }
          confirmLabel="Delete Chapter"
          onConfirm={async () => {
            await curriculumApi.deleteChapter(schoolId, chapter.id)
            await refresh()
          }}
          onClose={() => setModal(null)}
        />
      )}
    </li>
  )
}

function EditChapterDialog({ schoolId, options, chapter, onClose }: { schoolId: string; options: CurriculumOptions; chapter: Chapter; onClose: () => void }) {
  const refresh = useRefreshCurriculum(schoolId)
  const [values, setValues] = useState<ChapterValues>({
    name: chapter.name,
    code: chapter.code ?? '',
    board: chapter.board ?? '',
    classLevel: chapter.classLevel ?? '',
    programId: chapter.program?.id ?? '',
    expectedHours: chapter.expectedHours?.toString() ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = validateChapter(values)
    if (problem) return setError(problem)
    setBusy(true)
    try {
      await curriculumApi.updateChapter(schoolId, chapter.id, toBody(chapter.subject, values))
      await refresh()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the chapter')
      setBusy(false)
    }
  }

  return (
    <Dialog title="Edit Chapter" description={chapter.subject} onClose={onClose} widthClass="max-w-xl">
      <form onSubmit={submit} noValidate className="space-y-4 px-6 py-5">
        <ChapterFields
          v={values}
          set={(k, value) => {
            setValues((v) => ({ ...v, [k]: value }))
            setError(null)
          }}
          options={options}
          idPrefix="edit-chapter"
        />
        <ErrorBanner message={error} />
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Saving…' : 'Save Changes'}</button>
        </div>
      </form>
    </Dialog>
  )
}

function ConceptsPanel({ schoolId, chapter }: { schoolId: string; chapter: Chapter }) {
  const refresh = useRefreshCurriculum(schoolId)
  const { data: concepts, error, isPending } = useConcepts(schoolId, chapter.id)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<Concept | null>(null)
  const nextNumber = String((concepts?.length ?? 0) + 1).padStart(2, '0')
  const codeHint = chapter.code ? `${chapter.code}-CP${nextNumber}` : 'PHY-11-CH03-CP02'

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setFormError('Concept name is required')
    setBusy(true)
    try {
      await curriculumApi.createConcept(schoolId, chapter.id, { name, code: code || null })
      setName('')
      setCode('')
      await refresh()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not add the concept')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-1">
      <p className="text-xs text-slate-500">
        In <span className="font-semibold text-slate-800">{chapter.name}</span>
        {chapter.code && <span className="ml-1 font-mono text-slate-500">({chapter.code})</span>}
      </p>
      <form onSubmit={add} noValidate className="mt-4 space-y-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            aria-label="Concept name"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setFormError(null)
            }}
            placeholder="Concept name *"
            maxLength={150}
            className={`${inputClass()} bg-slate-50 focus:bg-white`}
          />
          <input
            aria-label="Concept code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase())
              setFormError(null)
            }}
            placeholder={`Concept Code (e.g. ${codeHint})`}
            maxLength={40}
            spellCheck={false}
            className={`${inputClass()} bg-slate-50 font-mono placeholder:font-sans focus:bg-white`}
          />
        </div>
        <ErrorBanner message={formError} />
        <button type="submit" disabled={busy} className={`${btnPrimary} h-9`}>
          <Plus className="size-4" /> {busy ? 'Adding…' : 'Add Concept'}
        </button>
      </form>

      <div className="mt-4">
        <ErrorBanner message={error?.message} />
        {isPending ? (
          <Loader2 className="mx-auto size-5 animate-spin text-slate-300" aria-label="Loading" />
        ) : concepts?.length === 0 ? (
          <p className="text-xs text-slate-400">No concepts yet for this chapter.</p>
        ) : (
          <ol className="space-y-2">
            {concepts?.map((c, i) => (
              <ConceptItem key={c.id} schoolId={schoolId} concept={c} index={i + 1} onDelete={() => setDeleting(c)} />
            ))}
          </ol>
        )}
      </div>

      {deleting && (
        <ConfirmDialog
          title="Delete concept?"
          message={<><strong className="text-slate-900">{deleting.name}</strong> will be removed from {chapter.name}.</>}
          confirmLabel="Delete Concept"
          onConfirm={async () => {
            await curriculumApi.deleteConcept(schoolId, deleting.id)
            await refresh()
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

function ConceptItem({ schoolId, concept, index, onDelete }: { schoolId: string; concept: Concept; index: number; onDelete: () => void }) {
  const refresh = useRefreshCurriculum(schoolId)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(concept.name)
  const [code, setCode] = useState(concept.code ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Concept name is required')
    setBusy(true)
    try {
      await curriculumApi.updateConcept(schoolId, concept.id, { name, code: code || null })
      await refresh()
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <li className="rounded-xl border border-brand-400 bg-brand-50/40 p-3">
        <form onSubmit={save} noValidate className="space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field id={`concept-name-${concept.id}`} label="Concept name">
              <input id={`concept-name-${concept.id}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={150} autoFocus className={inputClass()} />
            </Field>
            <Field id={`concept-code-${concept.id}`} label="Concept code">
              <input id={`concept-code-${concept.id}`} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={40} className={`${inputClass()} font-mono`} />
            </Field>
          </div>
          <ErrorBanner message={error} />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setName(concept.name)
                setCode(concept.code ?? '')
                setError(null)
              }}
              className={`${btnSecondary} h-8 px-3 text-xs`}
            >
              <X className="size-3.5" /> Cancel
            </button>
            <button type="submit" disabled={busy} className={`${btnPrimary} h-8 px-3 text-xs`}>
              <Check className="size-3.5" /> Save
            </button>
          </div>
        </form>
      </li>
    )
  }

  return (
    <li className="group flex items-center gap-3 rounded-xl border border-slate-200 px-3.5 py-2.5">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500">{index}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">{concept.name}</p>
        {concept.code && <p className="font-mono text-[11px] text-slate-500">{concept.code}</p>}
      </div>
      <div className="flex shrink-0 gap-1 opacity-60 group-hover:opacity-100">
        <button type="button" onClick={() => setEditing(true)} aria-label={`Edit ${concept.name}`} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <Pencil className="size-3.5" />
        </button>
        <button type="button" onClick={onDelete} aria-label={`Delete ${concept.name}`} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </li>
  )
}
