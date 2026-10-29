import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { CircleCheck, Loader2, TriangleAlert } from 'lucide-react'
import { ApiError } from '@/lib/api'
import { inputClass, labelClass, textareaClass } from '@/components/ui/formStyles'
import { AuthLayout } from '@/features/auth/AuthLayout'
import { submitStudentFeedback, usePublicFeedbackForm } from '@/features/feedback/api'
import { StarInput } from '@/features/feedback/ui'
import { draftReady, EMPTY_DRAFT, MAX_COMMENT, MIN_COMMENT, viewState, type Draft, type ViewState } from './state'

/**
 * The page a batch's feedback link opens (no login): a student picks their
 * name and a teacher, and rates them. Only the link's batch is ever shown.
 */
export function StudentFeedbackPage() {
  const { token = '' } = useParams()
  const query = usePublicFeedbackForm(token)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [gone, setGone] = useState(false)

  async function submit() {
    if (!draftReady(draft) || busy) return
    setBusy(true)
    setError(null)
    try {
      await submitStudentFeedback(token, { ...draft, comment: draft.comment.trim() })
      setSent(true)
      setDraft((d) => ({ ...EMPTY_DRAFT, studentId: d.studentId }))
    } catch (err) {
      // Switched off or replaced while the page was open.
      if (err instanceof ApiError && err.status === 404) setGone(true)
      // Anything else (the cool-down, a teacher no longer listed) keeps what they typed.
      else setError(err instanceof Error ? err.message : 'Could not send your feedback')
    } finally {
      setBusy(false)
    }
  }

  return (
    <StudentFeedbackView
      state={gone ? { kind: 'inactive' } : viewState(query)}
      draft={draft}
      busy={busy}
      error={error}
      sent={sent}
      onDraft={(change) => {
        setDraft((d) => ({ ...d, ...change }))
        setError(null)
      }}
      onSubmit={() => void submit()}
      onAgain={() => setSent(false)}
    />
  )
}

export type ViewProps = {
  state: ViewState
  draft: Draft
  busy: boolean
  error: string | null
  sent: boolean
  onDraft: (change: Partial<Draft>) => void
  onSubmit: () => void
  onAgain: () => void
}

export function StudentFeedbackView({ state, draft, busy, error, sent, onDraft, onSubmit, onAgain }: ViewProps) {
  return (
    <AuthLayout>
      <div className="au-card au-solo">
        <div className="au-form">
          <div>{body()}</div>
        </div>
      </div>
    </AuthLayout>
  )

  function body() {
    if (state.kind === 'loading') return <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-slate-300" aria-label="Loading" /></div>
    if (state.kind === 'inactive' || state.kind === 'failed') {
      return (
        <div className="au-done">
          <div className="badge" style={{ background: '#fef2f2', color: '#b42318' }}><TriangleAlert className="size-7" /></div>
          <h1>{state.kind === 'inactive' ? "This feedback link isn't active" : 'Something went wrong'}</h1>
          <p className="au-sub">{state.kind === 'inactive' ? 'Ask your school for the current link.' : state.message}</p>
        </div>
      )
    }
    const { form } = state
    if (sent) {
      return (
        <div className="au-done">
          <div className="badge"><CircleCheck className="size-7" /></div>
          <h1>Feedback sent</h1>
          <p className="au-sub">Thanks! You can send more feedback after {form.cooldownMinutes} minutes.</p>
          <button type="button" onClick={onAgain} className="au-btn">Back to the form</button>
        </div>
      )
    }
    const submit = (e: FormEvent) => {
      e.preventDefault()
      onSubmit()
    }
    return (
      <form onSubmit={submit} noValidate className="space-y-5">
        <div>
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{form.schoolName}</p>
          <h1>Feedback for {form.batchName}</h1>
          <p className="au-sub">Your teacher sees the rating and comment, not your name.</p>
        </div>
        <div>
          <label htmlFor="sf-student" className={labelClass}>Your name</label>
          <select id="sf-student" value={draft.studentId} onChange={(e) => onDraft({ studentId: e.target.value })} className={`${inputClass()} h-12`}>
            <option value="">Pick your name</option>
            {form.students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="sf-teacher" className={labelClass}>Teacher</label>
          <select id="sf-teacher" value={draft.facultyId} onChange={(e) => onDraft({ facultyId: e.target.value })} className={`${inputClass()} h-12`}>
            <option value="">Pick a teacher</option>
            {form.teachers.map((t) => (
              <option key={t.id} value={t.id}>{t.subjects.length ? `${t.name} · ${t.subjects.join(', ')}` : t.name}</option>
            ))}
          </select>
        </div>
        <div>
          <p className={labelClass}>Rating</p>
          <StarInput value={draft.rating} onChange={(rating) => onDraft({ rating })} label="Rating" disabled={busy} />
        </div>
        <div>
          <label htmlFor="sf-comment" className={labelClass}>Comment</label>
          <textarea
            id="sf-comment"
            value={draft.comment}
            maxLength={MAX_COMMENT}
            rows={5}
            onChange={(e) => onDraft({ comment: e.target.value })}
            placeholder="What's going well, and what could be better?"
            className={`${textareaClass()} min-h-32`}
          />
          <p className="mt-1 flex justify-between text-[11px] text-slate-400">
            <span>At least {MIN_COMMENT} characters</span>
            <span className="tabular-nums">{draft.comment.length}/{MAX_COMMENT}</span>
          </p>
        </div>
        {error && (
          <p className="au-err" role="alert"><TriangleAlert className="size-4" /> {error}</p>
        )}
        <button type="submit" disabled={busy || !draftReady(draft)} className="au-btn disabled:cursor-not-allowed">
          {busy ? <><span className="au-spin" /> Sending…</> : 'Send feedback'}
        </button>
      </form>
    )
  }
}
