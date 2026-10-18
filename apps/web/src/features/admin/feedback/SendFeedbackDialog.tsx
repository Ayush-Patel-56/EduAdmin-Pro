import { useState, type FormEvent } from 'react'
import { api } from '@/lib/api'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner } from '@/components/ui/form'
import { inputClass, labelClass, textareaClass } from '@/components/ui/formStyles'
import { CATEGORIES, CATEGORY_LABELS, feedbackPath, useRecipients, type FeedbackCategory } from '@/features/feedback/api'
import { StarInput } from '@/features/feedback/ui'

type Props = { schoolId: string; onSent: () => Promise<unknown>; onClose: () => void }

/** Send Feedback to Teachers (PRD 4.12): All Faculty or one teacher, content, appraisal rating and category. */
export function SendFeedbackDialog({ schoolId, onSent, onClose }: Props) {
  const recipients = useRecipients(schoolId, true)
  const [target, setTarget] = useState('ALL')
  const [content, setContent] = useState('')
  const [rating, setRating] = useState(5)
  const [category, setCategory] = useState<FeedbackCategory>('ACADEMICS')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!content.trim()) return setError('Write the feedback')
    setBusy(true)
    setError(null)
    try {
      await api(feedbackPath(schoolId), { method: 'POST', body: JSON.stringify({ target, content, rating, category }) })
      await onSent()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the feedback')
      setBusy(false)
    }
  }

  const audience = target === 'ALL' ? 'visible to all faculty in this school' : `visible to ${recipients.data?.find((r) => r.id === target)?.name ?? 'the selected teacher'}`
  return (
    <Dialog title="Send Feedback to Teachers" description={`Management → Teacher · ${audience}`} onClose={onClose} widthClass="max-w-lg">
      <form onSubmit={submit} noValidate className="space-y-5 px-6 py-5">
        <div>
          <label htmlFor="fb-target" className={labelClass}>Select Faculty Member (Target) *</label>
          <select id="fb-target" value={target} onChange={(e) => setTarget(e.target.value)} className={`${inputClass()} h-11`}>
            <option value="ALL">All Faculty (General Announcement / Feedback)</option>
            {(recipients.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name} — ({r.subject})</option>)}
          </select>
          {recipients.error && <p className="mt-1 text-[11px] text-red-600">{recipients.error.message}</p>}
        </div>
        <div>
          <label htmlFor="fb-content" className={labelClass}>Feedback Content *</label>
          <textarea
            id="fb-content"
            value={content}
            maxLength={2000}
            rows={4}
            onChange={(e) => { setContent(e.target.value); setError(null) }}
            placeholder="Share detailed observations, appreciation, or improvement points with the faculty member..."
            className={`${textareaClass()} min-h-28 bg-slate-50/60`}
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <p className={labelClass} id="fb-rating-label">Appraisal Rating</p>
            <StarInput value={rating} onChange={setRating} label="Appraisal rating" />
          </div>
          <div>
            <label htmlFor="fb-category" className={labelClass}>Category</label>
            <select id="fb-category" value={category} onChange={(e) => setCategory(e.target.value as FeedbackCategory)} className={`${inputClass()} h-11`}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
          </div>
        </div>
        <ErrorBanner message={error} />
        <div className="grid grid-cols-2 gap-3 pt-1">
          <button type="button" onClick={onClose} className="h-11 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={busy} className="h-11 rounded-lg bg-ink text-sm font-bold text-white hover:bg-ink-hover disabled:opacity-60">
            {busy ? 'Sending…' : 'Send Personalised Feedback'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
