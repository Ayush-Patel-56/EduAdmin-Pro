import { useState, type FormEvent, type ReactNode } from 'react'
import { api } from '@/lib/api'
import { todayIst } from '@/lib/dates'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner } from '@/components/ui/form'
import {
  fromClock,
  SPECIAL_TYPE_LABELS,
  toClock,
  WEEK_DAYS,
  type Clock,
  type FacultyOption,
  type Slot,
  type SpecialClass,
  type SpecialClassType,
} from './api'

const label = 'mb-1.5 block text-[11px] font-bold tracking-wide text-slate-500 uppercase'
const field =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 focus:outline-none read-only:bg-slate-50 read-only:text-slate-500'
const area = `${field.replace('h-10 ', '')} resize-y py-2.5`
// The field without its full width, for controls sharing a row: w-full next to
// another width class lets w-full win (Tailwind doesn't go by class order).
const fieldBox = field.replace('w-full ', '')

export type BatchOption = { id: string; name: string; program: string }

function F({ id, text, children, className }: { id: string; text: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={id} className={label}>{text}</label>
      {children}
    </div>
  )
}

function ClockField({ id, text, value, onChange }: { id: string; text: string; value: Clock; onChange: (v: Clock) => void }) {
  return (
    <F id={id} text={text}>
      <div className="flex gap-2">
        <input id={id} inputMode="numeric" placeholder="09:00" value={value.time} onChange={(e) => onChange({ ...value, time: e.target.value })} className={`${fieldBox} min-w-0 flex-1`} />
        <select aria-label={`${text} AM or PM`} value={value.meridiem} onChange={(e) => onChange({ ...value, meridiem: e.target.value as Clock['meridiem'] })} className={`${fieldBox} w-24 shrink-0`}>
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>
    </F>
  )
}

function Footer({ busy, label: submitLabel, onClose }: { busy: boolean; label: string; onClose: () => void }) {
  return (
    <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4">
      <button type="button" onClick={onClose} className="h-10 rounded-lg px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
      <button type="submit" disabled={busy} className="h-10 rounded-lg bg-ink px-5 text-sm font-semibold text-white hover:bg-ink-hover disabled:opacity-60">
        {busy ? 'Saving…' : submitLabel}
      </button>
    </div>
  )
}

/** A weekday from an ISO date (0 = Sunday), as the form defaults to today's. */
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay()

const readable = (b: BatchOption) => `${b.name} (${b.program})`

type SlotProps = {
  slot?: Slot
  batches: BatchOption[]
  onSaved: () => Promise<unknown>
  onClose: () => void
} & ({ mode: 'admin'; schoolId: string; faculty: FacultyOption[] } | { mode: 'teacher'; defaultSubject: string })

/** Add Schedule Slot (admin, any teacher) / Add Weekly Slot (teacher, themselves). */
export function SlotDialog(props: SlotProps) {
  const { slot, onSaved, onClose } = props
  const admin = props.mode === 'admin'
  const today = todayIst()
  const [v, setV] = useState({
    facultyId: slot?.faculty.id ?? '',
    subject: slot?.subject ?? (props.mode === 'teacher' ? props.defaultSubject : ''),
    batchId: slot?.batch.id ?? '',
    dayOfWeek: String(slot?.dayOfWeek ?? weekday(today)),
    room: slot?.room ?? '',
    start: toClock(slot?.startTime ?? '09:00'),
    end: toClock(slot?.endTime ?? '10:00'),
    effectiveFrom: slot?.effectiveFrom ?? today,
    effectiveTo: slot?.effectiveTo ?? '',
    active: slot?.active ?? true,
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof v>(key: K, value: (typeof v)[K]) => {
    setV((prev) => ({ ...prev, [key]: value }))
    setError(null)
  }
  const teacher = admin ? props.faculty.find((f) => f.id === v.facultyId) : undefined
  // A slot's batch must be one the teacher is assigned to.
  const batches = admin ? props.batches.filter((b) => teacher?.batchIds.includes(b.id)) : props.batches

  function pickTeacher(id: string) {
    const next = admin ? props.faculty.find((f) => f.id === id) : undefined
    setV((prev) => ({
      ...prev,
      facultyId: id,
      subject: prev.subject || next?.subject || '',
      batchId: next?.batchIds.includes(prev.batchId) ? prev.batchId : '',
    }))
    setError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (admin && !v.facultyId) return setError('Select a teacher')
    if (!v.subject.trim()) return setError('Subject is required')
    if (!v.batchId) return setError('Select a batch')
    const startTime = fromClock(v.start)
    const endTime = fromClock(v.end)
    if (!startTime) return setError('Enter the start time like 09:00')
    if (!endTime) return setError('Enter the end time like 10:00')
    if (endTime <= startTime) return setError('End time must be after the start time')
    if (!v.effectiveFrom) return setError('Effective from is required')
    if (v.effectiveTo && v.effectiveTo < v.effectiveFrom) return setError('Effective to can’t be before effective from')
    setBusy(true)
    try {
      const body: Record<string, unknown> = {
        subject: v.subject,
        batchId: v.batchId,
        dayOfWeek: Number(v.dayOfWeek),
        room: v.room,
        startTime,
        endTime,
        effectiveFrom: v.effectiveFrom,
        effectiveTo: v.effectiveTo,
      }
      if (admin) Object.assign(body, { facultyId: v.facultyId, active: v.active })
      const base = admin ? `/schools/${props.schoolId}/schedule/slots` : '/teacher/schedule/slots'
      await api(slot ? `${base}/${slot.id}` : base, { method: slot ? 'PATCH' : 'POST', body: JSON.stringify(body) })
      await onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the slot')
      setBusy(false)
    }
  }

  return (
    <Dialog title={slot ? 'Edit Slot' : admin ? 'Add Schedule Slot' : 'Add Weekly Slot'} onClose={onClose} widthClass="max-w-xl">
      <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
        <div className="grid gap-4 overflow-y-auto px-6 py-5 sm:grid-cols-2">
          {admin && (
            <>
              <F id="sl-faculty" text="Faculty / Teacher *" className="sm:col-span-2">
                <select id="sl-faculty" value={v.facultyId} onChange={(e) => pickTeacher(e.target.value)} className={field}>
                  <option value="">Select Faculty...</option>
                  {props.faculty.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}{f.subject ? ` (${f.subject})` : ''}</option>
                  ))}
                  {slot && !props.faculty.some((f) => f.id === slot.faculty.id) && (
                    <option value={slot.faculty.id}>{slot.faculty.name} (inactive)</option>
                  )}
                </select>
              </F>
              <F id="sl-name" text="Teacher Name"><input id="sl-name" readOnly value={teacher?.name ?? slot?.faculty.name ?? ''} placeholder="Auto-filled" className={field} /></F>
              <F id="sl-email" text="Teacher Email"><input id="sl-email" readOnly value={teacher?.email ?? ''} placeholder="Auto-filled" className={field} /></F>
            </>
          )}
          <F id="sl-subject" text="Subject *"><input id="sl-subject" maxLength={80} value={v.subject} onChange={(e) => set('subject', e.target.value)} className={field} /></F>
          <F id="sl-batch" text="Batch *">
            <select id="sl-batch" value={v.batchId} onChange={(e) => set('batchId', e.target.value)} disabled={slot?.hasAttendance} className={field}>
              <option value="">{admin && !v.facultyId ? 'Select a teacher first' : 'Select Batch...'}</option>
              {batches.map((b) => <option key={b.id} value={b.id}>{readable(b)}</option>)}
              {slot && !batches.some((b) => b.id === slot.batch.id) && <option value={slot.batch.id}>{slot.batch.name}</option>}
            </select>
            {slot?.hasAttendance && <p className="mt-1 text-[10px] text-slate-400">Attendance is recorded, so the batch stays.</p>}
            {admin && teacher && batches.length === 0 && (
              <p className="mt-1 text-[10px] text-amber-600">{teacher.name} has no batches yet. Assign one on their Teacher Portal profile.</p>
            )}
          </F>
          <F id="sl-day" text="Day of Week">
            <select id="sl-day" value={v.dayOfWeek} onChange={(e) => set('dayOfWeek', e.target.value)} className={field}>
              {WEEK_DAYS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </F>
          <F id="sl-room" text="Room"><input id="sl-room" maxLength={60} value={v.room} onChange={(e) => set('room', e.target.value)} placeholder="e.g. Room 302" className={field} /></F>
          <ClockField id="sl-start" text="Start Time *" value={v.start} onChange={(c) => set('start', c)} />
          <ClockField id="sl-end" text="End Time *" value={v.end} onChange={(c) => set('end', c)} />
          <F id="sl-from" text="Effective From"><input id="sl-from" type="date" value={v.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} className={field} /></F>
          <F id="sl-to" text="Effective To"><input id="sl-to" type="date" value={v.effectiveTo} min={v.effectiveFrom} onChange={(e) => set('effectiveTo', e.target.value)} className={field} /></F>
          {admin && (
            <label className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm font-medium text-slate-700 sm:col-span-2">
              <input type="checkbox" checked={v.active} onChange={(e) => set('active', e.target.checked)} className="size-4 accent-indigo-600" />
              Slot is active
            </label>
          )}
          <div className="sm:col-span-2"><ErrorBanner message={error} /></div>
        </div>
        <Footer busy={busy} label={slot ? 'Save Changes' : 'Add Slot'} onClose={onClose} />
      </form>
    </Dialog>
  )
}

type SpecialProps = {
  special?: SpecialClass
  batches: BatchOption[]
  onSaved: () => Promise<unknown>
  onClose: () => void
} & ({ mode: 'admin'; schoolId: string; faculty: FacultyOption[] } | { mode: 'teacher'; defaultSubject: string })

/** Add Special Class (admin; the teacher is optional) / Schedule Special Class (teacher, themselves). */
export function SpecialClassDialog(props: SpecialProps) {
  const { special, onSaved, onClose } = props
  const admin = props.mode === 'admin'
  const [v, setV] = useState({
    title: special?.title ?? '',
    type: (special?.type ?? 'EXTRA') as SpecialClassType,
    subject: special?.subject ?? (props.mode === 'teacher' ? props.defaultSubject : ''),
    batchId: special?.batch.id ?? '',
    date: special?.date ?? todayIst(),
    room: special?.room ?? '',
    start: toClock(special?.startTime ?? '10:00'),
    end: toClock(special?.endTime ?? '11:00'),
    facultyId: special?.faculty?.id ?? '',
    notes: special?.notes ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof v>(key: K, value: (typeof v)[K]) => {
    setV((prev) => ({ ...prev, [key]: value }))
    setError(null)
  }
  // The teacher, if one is set, must be assigned to the class's batch.
  const teachers = admin ? props.faculty.filter((f) => !v.batchId || f.batchIds.includes(v.batchId)) : []
  const teacher = admin ? props.faculty.find((f) => f.id === v.facultyId) : undefined
  const locked = !!special?.hasAttendance

  function pickBatch(id: string) {
    setV((prev) => ({
      ...prev,
      batchId: id,
      facultyId: admin && prev.facultyId && !props.faculty.find((f) => f.id === prev.facultyId)?.batchIds.includes(id) ? '' : prev.facultyId,
    }))
    setError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!v.title.trim()) return setError('Title is required')
    if (!v.batchId) return setError('Select a batch')
    if (!v.date) return setError('Date is required')
    const startTime = fromClock(v.start)
    const endTime = fromClock(v.end)
    if (!startTime) return setError('Enter the start time like 10:00')
    if (!endTime) return setError('Enter the end time like 11:00')
    if (endTime <= startTime) return setError('End time must be after the start time')
    setBusy(true)
    try {
      const body: Record<string, unknown> = {
        title: v.title,
        type: v.type,
        subject: v.subject,
        batchId: v.batchId,
        date: v.date,
        room: v.room,
        startTime,
        endTime,
        notes: v.notes,
      }
      if (admin) body.facultyId = v.facultyId
      const base = admin ? `/schools/${props.schoolId}/schedule/special-classes` : '/teacher/schedule/special-classes'
      await api(special ? `${base}/${special.id}` : base, { method: special ? 'PATCH' : 'POST', body: JSON.stringify(body) })
      await onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the class')
      setBusy(false)
    }
  }

  return (
    <Dialog title={special ? 'Edit Special Class' : admin ? 'Add Special Class' : 'Schedule Special Class'} onClose={onClose} widthClass="max-w-xl">
      <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
        <div className="grid gap-4 overflow-y-auto px-6 py-5 sm:grid-cols-2">
          <F id="sp-title" text="Title *" className={admin ? '' : 'sm:col-span-2'}>
            <input id="sp-title" maxLength={120} value={v.title} onChange={(e) => set('title', e.target.value)} placeholder={admin ? 'e.g. Revision Session' : 'e.g. Calculus Doubt Clearing'} className={field} />
          </F>
          <F id="sp-type" text={admin ? 'Class Type' : 'Type'}>
            <select id="sp-type" value={v.type} onChange={(e) => set('type', e.target.value as SpecialClassType)} className={field}>
              {(Object.keys(SPECIAL_TYPE_LABELS) as SpecialClassType[]).map((t) => <option key={t} value={t}>{SPECIAL_TYPE_LABELS[t]}</option>)}
            </select>
          </F>
          {!admin && <F id="sp-date" text="Date *"><input id="sp-date" type="date" value={v.date} disabled={locked} onChange={(e) => set('date', e.target.value)} className={field} /></F>}
          {admin && <F id="sp-subject" text="Subject"><input id="sp-subject" maxLength={80} value={v.subject} onChange={(e) => set('subject', e.target.value)} placeholder="e.g. Mathematics" className={field} /></F>}
          {admin && (
            <F id="sp-batch" text="Batch *">
              <select id="sp-batch" value={v.batchId} disabled={locked} onChange={(e) => pickBatch(e.target.value)} className={field}>
                <option value="">Select Batch...</option>
                {props.batches.map((b) => <option key={b.id} value={b.id}>{readable(b)}</option>)}
              </select>
            </F>
          )}
          {admin && <F id="sp-date" text="Date *"><input id="sp-date" type="date" value={v.date} disabled={locked} onChange={(e) => set('date', e.target.value)} className={field} /></F>}
          {admin && <F id="sp-room" text="Room"><input id="sp-room" maxLength={60} value={v.room} onChange={(e) => set('room', e.target.value)} className={field} /></F>}
          <ClockField id="sp-start" text="Start Time *" value={v.start} onChange={(c) => set('start', c)} />
          <ClockField id="sp-end" text="End Time *" value={v.end} onChange={(c) => set('end', c)} />
          {admin ? (
            <>
              <F id="sp-faculty" text="Faculty / Teacher" className="sm:col-span-2">
                <select id="sp-faculty" value={v.facultyId} onChange={(e) => set('facultyId', e.target.value)} className={field}>
                  <option value="">{v.batchId ? 'No teacher yet (any teacher of the batch can mark attendance)' : 'Select Faculty...'}</option>
                  {teachers.map((f) => <option key={f.id} value={f.id}>{f.name}{f.subject ? ` (${f.subject})` : ''}</option>)}
                  {special?.faculty && !teachers.some((f) => f.id === special.faculty!.id) && (
                    <option value={special.faculty.id}>{special.faculty.name}</option>
                  )}
                </select>
              </F>
              <F id="sp-name" text="Teacher Name"><input id="sp-name" readOnly value={teacher?.name ?? (v.facultyId ? special?.faculty?.name ?? '' : '')} placeholder="Auto-filled" className={field} /></F>
              <F id="sp-email" text="Teacher Email"><input id="sp-email" readOnly value={teacher?.email ?? ''} placeholder="Auto-filled" className={field} /></F>
            </>
          ) : (
            <>
              <F id="sp-subject" text="Subject"><input id="sp-subject" maxLength={80} value={v.subject} onChange={(e) => set('subject', e.target.value)} className={field} /></F>
              <F id="sp-batch" text="Batch *">
                <select id="sp-batch" value={v.batchId} disabled={locked} onChange={(e) => set('batchId', e.target.value)} className={field}>
                  <option value="">Select Batch...</option>
                  {props.batches.map((b) => <option key={b.id} value={b.id}>{readable(b)}</option>)}
                </select>
              </F>
              <F id="sp-room" text="Room" className="sm:col-span-2"><input id="sp-room" maxLength={60} value={v.room} onChange={(e) => set('room', e.target.value)} placeholder="e.g. Library Rm B" className={field} /></F>
            </>
          )}
          {locked && <p className="text-[10px] text-slate-400 sm:col-span-2">Attendance is recorded for this class, so its batch and date stay.</p>}
          <F id="sp-notes" text={admin ? 'Notes / Description' : 'Notes'} className="sm:col-span-2">
            <textarea id="sp-notes" rows={2} maxLength={1000} value={v.notes} onChange={(e) => set('notes', e.target.value)} placeholder={admin ? 'Any preparation instructions...' : 'Session focus or instructions...'} className={area} />
          </F>
          <div className="sm:col-span-2"><ErrorBanner message={error} /></div>
        </div>
        <Footer busy={busy} label={special ? 'Save Changes' : admin ? 'Add Special Class' : 'Schedule Class'} onClose={onClose} />
      </form>
    </Dialog>
  )
}
