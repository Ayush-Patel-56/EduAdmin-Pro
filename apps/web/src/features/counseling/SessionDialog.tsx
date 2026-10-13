import { useState, type FormEvent, type ReactNode } from 'react'
import { api } from '@/lib/api'
import { todayIst } from '@/lib/dates'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner } from '@/components/ui/form'
import { StudentPicker, type PickedStudent } from '@/features/students/StudentPicker'
import {
  COUNSELING_STATUS_LABELS,
  COUNSELING_TYPE_LABELS,
  type Counselor,
  type CounselingStatus,
  type CounselingType,
  type Session,
} from './api'

const label = 'mb-1.5 block text-[10px] font-bold tracking-[0.12em] text-slate-500 uppercase'
const field =
  'h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100 focus:outline-none'
const area = `${field.replace('h-11 ', '')} resize-y py-2.5`

function F({ id, text, children }: { id: string; text: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={label}>{text}</label>
      {children}
    </div>
  )
}

type Props =
  | {
      /** Admin: Schedule Session, any counselor of the school. */
      mode: 'admin'
      schoolId: string
      counselors: Counselor[]
      session?: Session
      onSaved: () => Promise<unknown>
      onClose: () => void
    }
  | {
      /** Teacher: Log Counseling Session, always as themselves. */
      mode: 'teacher'
      session?: Session
      onSaved: () => Promise<unknown>
      onClose: () => void
    }

const DURATIONS = [15, 30, 45, 60, 90]

export function SessionDialog(props: Props) {
  const { session, onSaved, onClose } = props
  const admin = props.mode === 'admin'
  const [student, setStudent] = useState<PickedStudent | null>(
    session ? { id: session.student.id, fullName: session.student.fullName, detail: [session.student.classLevel && `Class ${session.student.classLevel}`, session.student.batch].filter(Boolean).join(' · ') } : null,
  )
  const [v, setV] = useState({
    counselor: session?.counselor.key ?? (admin ? (props.counselors[0]?.id ?? '') : ''),
    type: (session?.type ?? 'ACADEMIC') as CounselingType,
    date: session?.date ?? (admin ? '' : todayIst()),
    time: session?.time ?? '10:00',
    durationMinutes: String(session?.durationMinutes ?? 30),
    nextSessionDate: session?.nextSessionDate ?? '',
    notes: session?.notes ?? '',
    actionItems: session?.actionItems ?? '',
    status: (session?.status ?? 'SCHEDULED') as CounselingStatus,
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (key: keyof typeof v, value: string) => {
    setV((prev) => ({ ...prev, [key]: value }))
    setError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!student) return setError('Select a student')
    if (admin && !v.counselor) return setError('Select a counselor')
    if (!v.date) return setError('Date is required')
    if (!v.time) return setError('Time is required')
    const minutes = Number(v.durationMinutes)
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480) return setError('Duration must be between 5 and 480 minutes')
    if (v.nextSessionDate && v.nextSessionDate < v.date) return setError('The next session can’t be before this one')
    setBusy(true)
    try {
      const body: Record<string, unknown> = {
        studentId: student.id,
        type: v.type,
        date: v.date,
        time: v.time,
        durationMinutes: minutes,
        nextSessionDate: v.nextSessionDate,
        notes: v.notes,
        actionItems: v.actionItems,
      }
      if (admin) {
        body.counselor = v.counselor
        if (session) body.status = v.status
      } else if (session) body.status = v.status
      const path = admin ? `/schools/${props.schoolId}/counseling` : '/teacher/counseling'
      await api(session ? `${path}/${session.id}` : path, { method: session ? 'PATCH' : 'POST', body: JSON.stringify(body) })
      await onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
      setBusy(false)
    }
  }

  const title = admin ? (session ? 'Edit Session' : 'Schedule Session') : session ? 'Edit Session' : 'Log Counseling Session'
  return (
    <Dialog title={title} description={admin && !session ? 'Book a new counseling appointment' : undefined} onClose={onClose} widthClass="max-w-xl">
      <form onSubmit={submit} noValidate className="space-y-5 px-6 py-5">
        <F id="cs-student" text={admin ? 'Student Name *' : 'Select Student'}>
          <StudentPicker id="cs-student" portal={admin ? { kind: 'admin', schoolId: props.schoolId } : { kind: 'teacher' }} value={student} onChange={setStudent} />
        </F>
        {admin && (
          <F id="cs-counselor" text="Counselor *">
            <select id="cs-counselor" value={v.counselor} onChange={(e) => set('counselor', e.target.value)} className={field}>
              <option value="">Select a Counselor...</option>
              {props.counselors.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.kind === 'ADMIN' ? 'Admin' : 'Faculty'})</option>)}
              {session?.counselor.key && !props.counselors.some((c) => c.id === session.counselor.key) && (
                <option value={session.counselor.key}>{session.counselor.name} (no longer active)</option>
              )}
            </select>
          </F>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <F id="cs-type" text={admin ? 'Session Type *' : 'Session Type'}>
            <select id="cs-type" value={v.type} onChange={(e) => set('type', e.target.value)} className={field}>
              {(Object.keys(COUNSELING_TYPE_LABELS) as CounselingType[]).map((t) => <option key={t} value={t}>{COUNSELING_TYPE_LABELS[t]}</option>)}
            </select>
          </F>
          {admin ? (
            <F id="cs-time" text="Time *"><input id="cs-time" type="time" value={v.time} onChange={(e) => set('time', e.target.value)} className={field} /></F>
          ) : (
            <F id="cs-duration" text="Duration">
              <select id="cs-duration" value={v.durationMinutes} onChange={(e) => set('durationMinutes', e.target.value)} className={field}>
                {(DURATIONS.includes(Number(v.durationMinutes)) ? DURATIONS : [...DURATIONS, Number(v.durationMinutes)]).map((d) => <option key={d} value={d}>{d} mins</option>)}
              </select>
            </F>
          )}
          <F id="cs-date" text={admin ? 'Date *' : 'Date'}><input id="cs-date" type="date" value={v.date} onChange={(e) => set('date', e.target.value)} className={field} /></F>
          {admin ? (
            <F id="cs-duration" text="Duration (minutes)">
              <input id="cs-duration" inputMode="numeric" value={v.durationMinutes} onChange={(e) => set('durationMinutes', e.target.value)} className={field} />
            </F>
          ) : (
            <F id="cs-time" text="Time"><input id="cs-time" type="time" value={v.time} onChange={(e) => set('time', e.target.value)} className={field} /></F>
          )}
        </div>
        {session && (
          <F id="cs-status" text="Status">
            <select id="cs-status" value={v.status} onChange={(e) => set('status', e.target.value)} className={field}>
              {(Object.keys(COUNSELING_STATUS_LABELS) as CounselingStatus[]).map((s) => <option key={s} value={s}>{COUNSELING_STATUS_LABELS[s]}</option>)}
            </select>
          </F>
        )}
        {admin && <F id="cs-next" text="Next Session Date"><input id="cs-next" type="date" value={v.nextSessionDate} onChange={(e) => set('nextSessionDate', e.target.value)} className={field} /></F>}
        <F id="cs-notes" text={admin ? 'Notes' : 'Notes & Observations'}>
          <textarea id="cs-notes" rows={3} maxLength={4000} value={v.notes} onChange={(e) => set('notes', e.target.value)} placeholder={admin ? 'Session purpose or observations...' : 'Describe notes and observations...'} className={area} />
        </F>
        <F id="cs-actions" text="Action Items">
          <textarea id="cs-actions" rows={2} maxLength={2000} value={v.actionItems} onChange={(e) => set('actionItems', e.target.value)} placeholder="Follow-up tasks agreed in the session..." className={area} />
        </F>
        {!admin && <F id="cs-next" text="Next Session Date (opt)"><input id="cs-next" type="date" value={v.nextSessionDate} onChange={(e) => set('nextSessionDate', e.target.value)} className={field} /></F>}
        <ErrorBanner message={error} />
        <div className={admin ? 'grid grid-cols-2 gap-3' : 'flex justify-end gap-3 border-t border-slate-100 pt-4'}>
          <button type="button" onClick={onClose} className={admin ? 'h-12 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50' : 'h-10 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50'}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={admin ? 'h-12 rounded-xl bg-ink text-sm font-semibold text-white hover:bg-ink-hover disabled:opacity-60' : 'h-10 rounded-lg bg-ink px-5 text-sm font-semibold text-white hover:bg-ink-hover disabled:opacity-60'}>
            {busy ? 'Saving…' : session ? 'Save Changes' : admin ? 'Schedule Session' : 'Save Session'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
