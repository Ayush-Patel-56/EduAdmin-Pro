import { useState, type FormEvent, type ReactNode } from 'react'
import { api } from '@/lib/api'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner } from '@/components/ui/form'
import type { Structure } from '@/features/academic/api'
import { REPEAT_LABELS, TYPE_LABELS, type EventRepeat, type EventScope, type EventType, type Occurrence } from '@/features/calendar/api'

const label = 'mb-1.5 block text-[11px] font-bold tracking-wide text-slate-500 uppercase'
const field =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 focus:outline-none'

function F({ id, text, children, className }: { id: string; text: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={id} className={label}>{text}</label>
      {children}
    </div>
  )
}

type Props = {
  schoolId: string
  structure: Structure | undefined
  /** Editing: the event (any of its occurrences). */
  event?: Occurrence
  /** Adding: the day clicked on the calendar. */
  date?: string
  onSaved: () => Promise<unknown>
  onClose: () => void
}

/** Add Event / Edit Event (PRD 4.15). Editing a repeating event changes the whole series. */
export function EventDialog({ schoolId, structure, event, date, onSaved, onClose }: Props) {
  const [v, setV] = useState({
    title: event?.title ?? '',
    type: (event?.type ?? 'EVENT') as EventType,
    scope: (event?.scope ?? 'SCHOOL') as EventScope,
    programId: event?.program?.id ?? '',
    batchId: event?.batch?.id ?? '',
    startDate: event?.startDate ?? date ?? '',
    endDate: event?.endDate ?? date ?? '',
    description: event?.description ?? '',
    repeat: (event?.repeat ?? 'NONE') as EventRepeat,
    repeatUntil: event?.repeatUntil ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = <K extends keyof typeof v>(key: K, value: (typeof v)[K]) => {
    setV((p) => ({ ...p, [key]: value }))
    setError(null)
  }
  const path = `/schools/${schoolId}/calendar/events`

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!v.title.trim()) return setError('Title is required')
    if (!v.startDate || !v.endDate) return setError('Start and end dates are required')
    if (v.endDate < v.startDate) return setError('The end date can’t be before the start date')
    if (v.scope === 'PROGRAM' && !v.programId) return setError('Select a program')
    if (v.scope === 'BATCH' && !v.batchId) return setError('Select a batch')
    if (v.repeat !== 'NONE' && v.repeatUntil && v.repeatUntil < v.startDate) return setError('Repeat until can’t be before the start date')
    setBusy(true)
    try {
      const body = { ...v, repeatUntil: v.repeat === 'NONE' ? null : v.repeatUntil || null }
      await api(event ? `${path}/${event.id}` : path, { method: event ? 'PATCH' : 'POST', body: JSON.stringify(body) })
      await onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the event')
      setBusy(false)
    }
  }

  async function remove() {
    if (!event) return
    setBusy(true)
    setError(null)
    try {
      await api(`${path}/${event.id}`, { method: 'DELETE' })
      await onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the event')
      setBusy(false)
    }
  }

  return (
    <Dialog title={event ? 'Edit Event' : 'Add Event'} description={event && event.repeat !== 'NONE' ? 'This event repeats; changes apply to every repeat.' : undefined} onClose={onClose} widthClass="max-w-xl">
      <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
        <div className="grid gap-4 overflow-y-auto px-6 py-5 sm:grid-cols-2">
          <F id="ev-title" text="Title *" className="sm:col-span-2">
            <input id="ev-title" maxLength={150} value={v.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Diwali Break, Unit Test 2" className={field} />
          </F>
          <F id="ev-type" text="Type">
            <select id="ev-type" value={v.type} onChange={(e) => set('type', e.target.value as EventType)} className={field}>
              {(Object.keys(TYPE_LABELS) as EventType[]).map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
          </F>
          <F id="ev-scope" text="Scope">
            <select id="ev-scope" value={v.scope} onChange={(e) => set('scope', e.target.value as EventScope)} className={field}>
              <option value="SCHOOL">School-wide</option>
              <option value="PROGRAM">One program</option>
              <option value="BATCH">One batch</option>
            </select>
          </F>
          {v.scope === 'PROGRAM' && (
            <F id="ev-program" text="Program *" className="sm:col-span-2">
              <select id="ev-program" value={v.programId} onChange={(e) => set('programId', e.target.value)} className={field}>
                <option value="">Select a program...</option>
                {(structure?.programs ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </F>
          )}
          {v.scope === 'BATCH' && (
            <F id="ev-batch" text="Batch *" className="sm:col-span-2">
              <select id="ev-batch" value={v.batchId} onChange={(e) => set('batchId', e.target.value)} className={field}>
                <option value="">Select a batch...</option>
                {(structure?.batches ?? []).map((b) => (
                  <option key={b.id} value={b.id}>{b.name} ({structure?.programs.find((p) => p.id === b.programId)?.name})</option>
                ))}
              </select>
            </F>
          )}
          <F id="ev-start" text="Start Date *">
            <input id="ev-start" type="date" value={v.startDate} onChange={(e) => setV((p) => ({ ...p, startDate: e.target.value, endDate: !p.endDate || p.endDate < e.target.value ? e.target.value : p.endDate }))} className={field} />
          </F>
          <F id="ev-end" text="End Date *">
            <input id="ev-end" type="date" value={v.endDate} min={v.startDate || undefined} onChange={(e) => set('endDate', e.target.value)} className={field} />
          </F>
          <F id="ev-repeat" text="Repeat">
            <select id="ev-repeat" value={v.repeat} onChange={(e) => set('repeat', e.target.value as EventRepeat)} className={field}>
              {(Object.keys(REPEAT_LABELS) as EventRepeat[]).map((r) => <option key={r} value={r}>{REPEAT_LABELS[r]}</option>)}
            </select>
          </F>
          {v.repeat !== 'NONE' ? (
            <F id="ev-until" text="Repeat Until (optional)">
              <input id="ev-until" type="date" value={v.repeatUntil} min={v.startDate || undefined} onChange={(e) => set('repeatUntil', e.target.value)} className={field} />
            </F>
          ) : <div />}
          <F id="ev-desc" text="Description" className="sm:col-span-2">
            <textarea id="ev-desc" rows={3} maxLength={2000} value={v.description} onChange={(e) => set('description', e.target.value)} placeholder="Details for staff (optional)" className={`${field} h-auto resize-y py-2.5`} />
          </F>
          <div className="sm:col-span-2"><ErrorBanner message={error} /></div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
          <div>
            {event &&
              (confirmDelete ? (
                <span className="flex items-center gap-2 text-sm">
                  <span className="text-slate-600">{event.repeat !== 'NONE' ? 'Delete every repeat?' : 'Delete this event?'}</span>
                  <button type="button" onClick={() => void remove()} disabled={busy} className="h-9 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">Delete</button>
                  <button type="button" onClick={() => setConfirmDelete(false)} className="h-9 rounded-lg px-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Keep</button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(true)} className="h-9 rounded-lg px-3 text-sm font-semibold text-red-600 hover:bg-red-50">Delete Event</button>
              ))}
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="h-10 rounded-lg px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
            <button type="submit" disabled={busy} className="h-10 rounded-lg bg-ink px-5 text-sm font-semibold text-white hover:bg-ink-hover disabled:opacity-60">{busy ? 'Saving…' : event ? 'Save Changes' : 'Add Event'}</button>
          </div>
        </div>
      </form>
    </Dialog>
  )
}
