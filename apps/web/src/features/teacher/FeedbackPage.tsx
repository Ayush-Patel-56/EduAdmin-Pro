import { useState, type FormEvent, type ReactNode } from 'react'
import { Info, Loader2, RefreshCw } from 'lucide-react'
import { api } from '@/lib/api'
import { ErrorBanner } from '@/components/ui/form'
import { textareaClass } from '@/components/ui/formStyles'
import { CATEGORY_LABELS, dayLabel, TEACHER_FEEDBACK_PATH, useInvalidateTeacherFeedback, useTeacherFeedback, type Feedback, type StudentFeedbackForTeacher } from '@/features/feedback/api'
import { Stars, StarInput, StatusBadge } from '@/features/feedback/ui'

/** Feedback (PRD 5.13): what management sent (to everyone or to them), what they sent to management, and what students said (without names). */
export function TeacherFeedbackPage() {
  const feedback = useTeacherFeedback()
  const invalidate = useInvalidateTeacherFeedback()
  const [composing, setComposing] = useState(false)
  const data = feedback.data

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 sm:text-[26px]">Feedback</h1>
          <p className="mt-1 text-sm text-slate-500">Feedback from management and from your students, and feedback you have sent to management</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void feedback.refetch()} disabled={feedback.isFetching} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60">
            <RefreshCw className={`size-4 ${feedback.isFetching ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button type="button" onClick={() => setComposing((c) => !c)} aria-expanded={composing} className="inline-flex h-10 shrink-0 items-center rounded-lg bg-ink px-4 text-sm font-semibold text-white shadow-sm hover:bg-ink-hover">
            {composing ? 'Close' : 'Send Feedback to Management'}
          </button>
        </div>
      </div>

      {composing && <Composer onSent={async () => { await invalidate(); setComposing(false) }} />}
      {feedback.error && <div className="mt-4"><ErrorBanner message={feedback.error.message} /></div>}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Column title={`From Management (${data?.received.length ?? 0})`} loading={!data && !feedback.error} empty="No feedback from management yet.">
          {data?.received.map((f) => <Received key={f.id} feedback={f} />)}
        </Column>
        <Column title={`Sent to Management (${data?.sent.length ?? 0})`} loading={!data && !feedback.error} empty="You haven't sent any feedback yet.">
          {data?.sent.map((f) => <Sent key={f.id} feedback={f} />)}
        </Column>
      </div>
      <div className="mt-6">
        <Column title={`From Students (${data?.fromStudents.length ?? 0})`} loading={!data && !feedback.error} empty="No feedback from students yet.">
          {data?.fromStudents.map((f) => <FromStudent key={f.id} feedback={f} />)}
        </Column>
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500"><Info className="size-3" /> Students send this through their batch's feedback link. Their names aren't shown to you.</p>
      </div>
    </>
  )
}

function Composer({ onSent }: { onSent: () => Promise<unknown> }) {
  const [content, setContent] = useState('')
  const [rating, setRating] = useState(5)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!content.trim()) return setError('Write the feedback')
    setBusy(true)
    setError(null)
    try {
      await api(TEACHER_FEEDBACK_PATH, { method: 'POST', body: JSON.stringify({ content, rating }) })
      await onSent()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the feedback')
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} noValidate className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <label htmlFor="tf-content" className="sr-only">Feedback for management</label>
      <textarea
        id="tf-content"
        autoFocus
        value={content}
        maxLength={2000}
        rows={3}
        onChange={(e) => { setContent(e.target.value); setError(null) }}
        placeholder="Share feedback, suggestions or concerns with management..."
        className={`${textareaClass()} min-h-20`}
      />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <StarInput value={rating} onChange={setRating} label="Rating" disabled={busy} />
        <button type="submit" disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-lg bg-ink px-5 text-sm font-bold text-white hover:bg-ink-hover disabled:opacity-60">
          {busy && <Loader2 className="size-4 animate-spin" />} Submit
        </button>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500"><Info className="size-3" /> Your name is shown to management with this feedback.</p>
      {error && <div className="mt-3"><ErrorBanner message={error} /></div>}
    </form>
  )
}

function Column({ title, loading, empty, children }: { title: string; loading: boolean; empty: string; children: ReactNode[] | undefined }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">{title}</h2>
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-slate-300" aria-label="Loading" /></div>
      ) : children && children.length > 0 ? (
        <ul className="mt-4 space-y-3">{children}</ul>
      ) : (
        <p className="mt-3 text-xs text-slate-400 italic">{empty}</p>
      )}
    </section>
  )
}

function Received({ feedback: f }: { feedback: Feedback }) {
  return (
    <li className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-bold text-slate-900">{f.sender.name}</span>
        <Stars rating={f.rating} size="xs" />
      </div>
      <p className="mt-2 text-sm whitespace-pre-line text-slate-700 italic [overflow-wrap:anywhere]">“{f.content}”</p>
      <p className="mt-2 text-[11px] text-slate-400">
        <span className="font-semibold text-indigo-500">{CATEGORY_LABELS[f.category]}</span> · {dayLabel(f.date)}
        {f.target?.all && <> · to all faculty</>}
      </p>
    </li>
  )
}

function FromStudent({ feedback: f }: { feedback: StudentFeedbackForTeacher }) {
  return (
    <li className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-bold text-slate-900">A student{f.batchName && <span className="font-semibold text-slate-500"> · {f.batchName}</span>}</span>
        <Stars rating={f.rating} size="xs" />
      </div>
      <p className="mt-2 text-sm whitespace-pre-line text-slate-700 italic [overflow-wrap:anywhere]">“{f.content}”</p>
      <p className="mt-2 text-[11px] text-slate-400">{dayLabel(f.date)}</p>
    </li>
  )
}

function Sent({ feedback: f }: { feedback: Feedback }) {
  return (
    <li className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <Stars rating={f.rating} size="xs" />
        <StatusBadge status={f.status} />
      </div>
      <p className="mt-2 text-sm whitespace-pre-line text-slate-700 italic [overflow-wrap:anywhere]">“{f.content}”</p>
      <p className="mt-2 text-[11px] text-slate-400">{dayLabel(f.date)}</p>
    </li>
  )
}
