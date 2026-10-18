import { useState, type FormEvent } from 'react'
import { api } from '@/lib/api'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner, Field } from '@/components/ui/form'
import { btnPrimary, btnSecondary, inputClass, textareaClass } from '@/components/ui/formStyles'
import { Select } from '@/components/ui/Select'
import { DIFFICULTY_LABELS, emptyQuestion, LETTERS, questionForm, questionPayload, questionProblem, TYPE_LABELS, type Options, type Question, type QuestionForm } from './api'

type Props = {
  base: string
  options: Options
  /** The question being edited, or null to add one. */
  question: Question | null
  /** Faculty add a Source (default "Custom"); admins' questions keep theirs. */
  withSource: boolean
  onSaved: () => Promise<unknown>
  onClose: () => void
}

/** Add New Question (PRD 4.10, 5.11). */
export function QuestionDialog({ base, options, question, withSource, onSaved, onClose }: Props) {
  const [form, setForm] = useState<QuestionForm>(() => (question ? questionForm(question) : emptyQuestion(options.defaults)))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof QuestionForm>(key: K, value: QuestionForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    setError(null)
  }
  const chapters = options.chapters.filter((c) => c.subject === form.subject)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = questionProblem(form, withSource)
    if (problem) return setError(problem)
    setBusy(true)
    try {
      // An admin editing keeps the question's source (e.g. a PDF upload's).
      const body = { ...questionPayload(form, withSource), ...(!withSource && question ? { source: question.source } : {}) }
      await api(question ? `${base}/questions/${question.id}` : `${base}/questions`, { method: question ? 'PATCH' : 'POST', body: JSON.stringify(body) })
      await onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the question')
      setBusy(false)
    }
  }

  return (
    <Dialog title={question ? 'Edit Question' : 'Add New Question'} description={question ? 'Tests already built keep the question as it was.' : 'Add a question to the bank for building tests.'} onClose={onClose} widthClass="max-w-2xl">
      <form onSubmit={submit} noValidate>
        <div className="grid gap-4 px-6 py-5 sm:grid-cols-2">
          <Field id="q-subject" label="Subject *">
            <Select
              id="q-subject"
              value={form.subject || null}
              placeholder="Select subject"
              options={options.subjects.map((s) => ({ value: s, label: s }))}
              onChange={(v) => setForm((f) => ({ ...f, subject: v, chapterId: f.subject === v ? f.chapterId : '' }))}
            />
          </Field>
          <Field id="q-chapter" label="Chapter" hint={form.subject && !chapters.length ? `No ${form.subject} chapters in the curriculum yet` : undefined}>
            <Select
              id="q-chapter"
              value={form.chapterId || null}
              placeholder={form.subject ? 'Select chapter (optional)' : 'Select a subject first'}
              disabled={!form.subject || !chapters.length}
              options={[{ value: '', label: 'No chapter' }, ...chapters.map((c) => ({ value: c.id, label: c.name }))]}
              onChange={(v) => set('chapterId', v)}
            />
          </Field>
          <Field id="q-topic" label="Concept / Topic *">
            <input id="q-topic" value={form.topic} maxLength={200} onChange={(e) => set('topic', e.target.value)} placeholder="e.g. Laws of Thermodynamics" className={inputClass()} />
          </Field>
          <Field id="q-difficulty" label="Difficulty *">
            <Select id="q-difficulty" value={form.difficulty || null} placeholder="Select difficulty" options={options.difficulties.map((d) => ({ value: d, label: DIFFICULTY_LABELS[d] }))} onChange={(v) => set('difficulty', v as QuestionForm['difficulty'])} />
          </Field>
          <div className="sm:col-span-2">
            <p className="mb-1.5 block text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Question Type *</p>
            <div role="radiogroup" aria-label="Question type" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {options.questionTypes.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={form.type === t}
                  onClick={() => setForm((f) => ({ ...f, type: t, correctAnswer: f.type === t ? f.correctAnswer : '' }))}
                  className={`h-10 rounded-lg border text-sm font-semibold transition ${form.type === t ? 'border-ink bg-ink text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                >
                  {TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
          <Field id="q-text" label="Question Text *" className="sm:col-span-2">
            <textarea id="q-text" rows={4} value={form.text} maxLength={5000} onChange={(e) => set('text', e.target.value)} placeholder="Type the question…" className={textareaClass()} />
          </Field>

          {form.type === 'MCQ' && (
            <fieldset className="sm:col-span-2">
              <legend className="mb-1.5 block text-[11px] font-semibold tracking-wide text-slate-500 uppercase">MCQ Options * <span className="font-normal normal-case">(pick the correct one)</span></legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {LETTERS.map((letter, i) => (
                  <div key={letter} className={`flex items-center gap-2 rounded-lg border px-2 ${form.correctAnswer === letter ? 'border-emerald-400 bg-emerald-50/50' : 'border-slate-200'}`}>
                    <input type="radio" name="q-correct" aria-label={`Option ${letter} is correct`} checked={form.correctAnswer === letter} onChange={() => set('correctAnswer', letter)} className="size-4 accent-emerald-600" />
                    <span className="text-sm font-bold text-slate-500">{letter}</span>
                    <input
                      aria-label={`Option ${letter}`}
                      value={form.options[i]}
                      maxLength={1000}
                      onChange={(e) => set('options', form.options.map((o, j) => (j === i ? e.target.value : o)) as QuestionForm['options'])}
                      placeholder={`Option ${letter}`}
                      className="h-10 min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
                    />
                  </div>
                ))}
              </div>
            </fieldset>
          )}

          {form.type !== 'MCQ' && (
            <Field
              id="q-answer"
              label={form.type === 'SUBJECTIVE' ? 'Model Answer' : 'Correct Answer *'}
              className="sm:col-span-2"
              hint={form.type === 'INTEGER' ? 'A whole number, e.g. 42' : form.type === 'NUMERICAL' ? 'A number, e.g. 9.81 (matched to two decimals)' : 'Optional; subjective answers are marked by the teacher'}
            >
              {form.type === 'SUBJECTIVE' ? (
                <textarea id="q-answer" rows={3} value={form.correctAnswer} maxLength={2000} onChange={(e) => set('correctAnswer', e.target.value)} className={textareaClass()} />
              ) : (
                <input id="q-answer" inputMode="decimal" value={form.correctAnswer} maxLength={30} onChange={(e) => set('correctAnswer', e.target.value)} className={inputClass()} />
              )}
            </Field>
          )}

          <Field id="q-marks" label="Marks *">
            <input id="q-marks" type="number" min={1} max={100} value={form.marks} onChange={(e) => set('marks', e.target.value)} className={inputClass()} />
          </Field>
          <Field id="q-negative" label="Negative Marks *" hint="0 to -9, taken off for a wrong answer">
            <input id="q-negative" type="number" min={-9} max={0} value={form.negativeMarks} onChange={(e) => set('negativeMarks', e.target.value)} className={inputClass()} />
          </Field>
          {withSource && (
            <Field id="q-source" label="Source *" className="sm:col-span-2" hint="Where the question is from, e.g. Custom, NCERT, JEE Main 2024">
              <input id="q-source" value={form.source} maxLength={100} onChange={(e) => set('source', e.target.value)} className={inputClass()} />
            </Field>
          )}
          {error && (
            <div className="sm:col-span-2">
              <ErrorBanner message={error} />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={btnPrimary}>
            {busy ? 'Saving…' : question ? 'Save Changes' : 'Add Question'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
