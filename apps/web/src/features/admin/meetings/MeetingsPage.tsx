import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarDays, CircleAlert, Clock, FileText, Loader2, MapPin, Pencil, Plus, Printer, Search, Trash2, UsersRound } from 'lucide-react'
import { api } from '@/lib/api'
import { Dialog } from '@/components/ui/Dialog'
import { ConfirmDialog, ErrorBanner } from '@/components/ui/form'
import {
  dmy,
  meetingsPath,
  PRIORITY_LABELS,
  PRIORITY_STYLE,
  STATUS_LABELS,
  STATUS_STYLE,
  TYPE_LABELS,
  useInvalidateMeetings,
  useMeeting,
  useMeetings,
  type AgendaItem,
  type AgendaPriority,
  type AgendaStatus,
  type Meeting,
  type MeetingType,
} from '@/features/meetings/api'
import { useAdminContext } from '../adminContext'
import { MeetingDocDialog } from './meetingDocs'

const field =
  'h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100 focus:outline-none'
const area = `${field.replace('h-10 ', '')} resize-y py-2.5`
const label = 'mb-1.5 block text-[11px] font-bold tracking-wide text-slate-500 uppercase'
const message = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)

/** Meetings (PRD 4.14): the Meetings Log on the left, the chosen meeting and its agenda on the right. */
export function MeetingsPage() {
  const { schoolId } = useAdminContext()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])
  const list = useMeetings(schoolId, q)
  const picked = params.get('meeting')
  const selectedId = list.data?.some((m) => m.id === picked) ? picked : (list.data?.[0]?.id ?? null)
  const meeting = useMeeting(schoolId, selectedId)
  const invalidate = useInvalidateMeetings(schoolId)
  const [dialog, setDialog] = useState<{ kind: 'meeting'; meeting?: Meeting } | null>(null)
  const select = (id: string) => setParams({ meeting: id }, { replace: true })

  return (
    <div className="-mx-4 -my-6 flex min-h-[calc(100dvh-68px)] flex-col sm:-mx-6 lg:-my-8 lg:flex-row">
      <aside className="border-b border-slate-200 bg-white lg:w-80 lg:shrink-0 lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between px-4 pt-5">
          <h1 className="text-sm font-bold tracking-wide text-slate-900 uppercase">Meetings Log</h1>
          <button type="button" onClick={() => setDialog({ kind: 'meeting' })} aria-label="Log new meeting" className="flex size-8 items-center justify-center rounded-lg bg-ink text-white hover:bg-ink-hover">
            <Plus className="size-4" />
          </button>
        </div>
        <div className="relative mx-4 mt-4">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search meetings..." aria-label="Search meetings" className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pr-3 pl-9 text-sm focus:outline-none" />
        </div>
        <div className="mt-4 border-t border-slate-100 p-3">
          {list.error ? (
            <ErrorBanner message={list.error.message} />
          ) : list.isPending ? (
            <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-slate-300" aria-label="Loading" /></div>
          ) : list.data!.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-slate-400 italic">{q ? `No meeting matches “${q}”.` : 'No meetings logged yet. Use + to log one.'}</p>
          ) : (
            <ul className="space-y-2">
              {list.data!.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => select(m.id)}
                    aria-current={m.id === selectedId}
                    className={`w-full rounded-xl border px-3.5 py-3 text-left transition ${m.id === selectedId ? 'border-emerald-200 bg-emerald-50' : 'border-transparent hover:bg-slate-50'}`}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="text-sm font-bold text-slate-900">{m.title}</span>
                      <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 shadow-sm">{TYPE_LABELS[m.type]}</span>
                    </span>
                    <span className="mt-1.5 flex items-center gap-3 text-xs text-slate-500">
                      <span className="flex items-center gap-1"><CalendarDays className="size-3.5" /> {dmy(m.date)}</span>
                      {m.time && <span className="flex items-center gap-1"><Clock className="size-3.5" /> {m.time}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <section aria-label="Meeting" className="min-w-0 flex-1 px-4 py-6 lg:px-10 lg:py-8">
        {!selectedId ? (
          list.data && (
            <div className="mx-auto mt-16 max-w-md text-center">
              <FileText className="mx-auto size-10 text-slate-300" />
              <p className="mt-3 text-sm font-bold text-slate-900">No meeting selected</p>
              <p className="mt-1 text-xs text-slate-500">Log a meeting to record its agenda and minutes.</p>
            </div>
          )
        ) : meeting.error ? (
          <ErrorBanner message={meeting.error.message} />
        ) : !meeting.data ? (
          <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-slate-300" aria-label="Loading" /></div>
        ) : (
          <MeetingDetail key={meeting.data.id} schoolId={schoolId} meeting={meeting.data} onChanged={invalidate} onEdit={() => setDialog({ kind: 'meeting', meeting: meeting.data })} />
        )}
      </section>

      {dialog && (
        <MeetingDialog
          schoolId={schoolId}
          meeting={dialog.meeting}
          onSaved={async (id) => {
            await invalidate()
            select(id)
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

function Info({ icon: Icon, tone, label: text, children }: { icon: typeof Clock; tone: string; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${tone}`}><Icon className="size-5" /></span>
      <div className="min-w-0">
        <p className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">{text}</p>
        <p className="text-sm font-semibold break-words text-slate-900">{children}</p>
      </div>
    </div>
  )
}

function MeetingDetail({ schoolId, meeting: m, onChanged, onEdit }: { schoolId: string; meeting: Meeting; onChanged: () => Promise<unknown>; onEdit: () => void }) {
  const [doc, setDoc] = useState<'agenda' | 'minutes' | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [adding, setAdding] = useState(false)
  const { setParams } = useParamsSetter()

  return (
    <div className="mx-auto max-w-4xl">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span className="rounded-lg bg-emerald-50 px-3 py-1 text-xs font-bold tracking-wider text-indigo-700 uppercase">{TYPE_LABELS[m.type]} Meeting</span>
            <h2 className="mt-3 text-2xl font-bold break-words text-slate-900">{m.title}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setDoc('agenda')} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Printer className="size-4" /> Print Agenda</button>
            <button type="button" onClick={() => setDoc('minutes')} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Printer className="size-4" /> Print Minutes</button>
            <button type="button" onClick={onEdit} aria-label="Edit meeting" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="size-4" /></button>
            <button type="button" onClick={() => setDeleting(true)} aria-label="Delete meeting" className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" /></button>
          </div>
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <Info icon={CalendarDays} tone="bg-sky-50 text-sky-600" label="Date">{dmy(m.date)}</Info>
          <Info icon={Clock} tone="bg-amber-50 text-amber-500" label="Time">{m.time ?? 'Not set'}</Info>
          <Info icon={MapPin} tone="bg-violet-50 text-violet-600" label="Venue">{m.venue ?? 'Not set'}</Info>
          <Info icon={UsersRound} tone="bg-emerald-50 text-emerald-600" label="Attendees">{m.attendees.length ? m.attendees.join(', ') : 'Not listed'}</Info>
          <Info icon={FileText} tone="bg-emerald-50 text-emerald-600" label="Minutes Prepared By">{m.minutesPreparedBy ?? 'Not specified'}</Info>
          <Info icon={CalendarDays} tone="bg-rose-50 text-rose-500" label="Next Meeting Date">{dmy(m.nextMeetingDate) ?? 'Not scheduled'}</Info>
        </div>
      </section>

      <h3 className="mt-8 flex items-center gap-2 text-sm font-bold tracking-wide text-slate-900 uppercase"><FileText className="size-4 text-indigo-600" /> Agenda &amp; Discussion Items</h3>
      <div className="mt-4 space-y-4">
        {m.agendaItems.length === 0 && !adding && <p className="text-sm text-slate-400 italic">No agenda items yet.</p>}
        {m.agendaItems.map((a) => <AgendaCard key={a.id} schoolId={schoolId} meetingId={m.id} item={a} onChanged={onChanged} />)}
        {adding ? (
          <AgendaForm schoolId={schoolId} meetingId={m.id} onSaved={onChanged} onClose={() => setAdding(false)} />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 py-3.5 text-sm font-semibold text-slate-500 hover:border-slate-300 hover:text-slate-700">
            <Plus className="size-4" /> Add Agenda Item
          </button>
        )}
      </div>

      {doc && <MeetingDocDialog meeting={m} kind={doc} onClose={() => setDoc(null)} />}
      {deleting && (
        <ConfirmDialog
          title="Delete meeting?"
          message={<><strong className="text-slate-900">{m.title}</strong> ({dmy(m.date)}) and its {m.agendaItems.length} agenda item{m.agendaItems.length === 1 ? '' : 's'} will be deleted. This can’t be undone.</>}
          confirmLabel="Delete Meeting"
          onConfirm={async () => {
            await api(`${meetingsPath(schoolId)}/${m.id}`, { method: 'DELETE' })
            setParams({})
            await onChanged()
          }}
          onClose={() => setDeleting(false)}
        />
      )}
    </div>
  )
}

/** Clears the selection after a delete (the log then shows the newest meeting). */
function useParamsSetter() {
  const [, setParams] = useSearchParams()
  return { setParams: (next: Record<string, string>) => setParams(next, { replace: true }) }
}

function Detail({ label: text, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">{text}</p>
      <p className="text-sm font-medium whitespace-pre-line text-slate-800">{children}</p>
    </div>
  )
}

function Pill<T extends string>({ value, options, labels, styles, onChange, aria, icon }: { value: T; options: T[]; labels: Record<T, string>; styles: Record<T, string>; onChange: (v: T) => void; aria: string; icon?: ReactNode }) {
  return (
    <label className={`relative inline-flex h-8 items-center gap-1.5 rounded-full border pr-2 pl-3 text-xs font-semibold ${styles[value]}`}>
      {icon}
      <select aria-label={aria} value={value} onChange={(e) => onChange(e.target.value as T)} className="cursor-pointer appearance-none bg-transparent pr-4 focus:outline-none">
        {options.map((o) => <option key={o} value={o}>{labels[o]}</option>)}
      </select>
      <span aria-hidden className="pointer-events-none absolute right-2.5 text-[9px]">▾</span>
    </label>
  )
}

function AgendaCard({ schoolId, meetingId, item, onChanged }: { schoolId: string; meetingId: string; item: AgendaItem; onChanged: () => Promise<unknown> }) {
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const path = `${meetingsPath(schoolId)}/${meetingId}/agenda/${item.id}`

  async function setState(patch: { status?: AgendaStatus; priority?: AgendaPriority }) {
    setError(null)
    try {
      await api(`${path}/state`, { method: 'PATCH', body: JSON.stringify(patch) })
      await onChanged()
    } catch (err) {
      setError(message(err, 'Could not update the item'))
    }
  }

  if (editing) return <AgendaForm schoolId={schoolId} meetingId={meetingId} item={item} onSaved={onChanged} onClose={() => setEditing(false)} />
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between">
        <div className="min-w-0 space-y-4">
          <div>
            <p className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">Agenda</p>
            <p className="text-base font-bold break-words text-slate-900">{item.title}</p>
          </div>
          {item.discussion && <Detail label="Discussion">{item.discussion}</Detail>}
          {item.action && <Detail label="Action">{item.action}</Detail>}
        </div>
        <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
          <div className="flex gap-1">
            <button type="button" onClick={() => setEditing(true)} aria-label={`Edit ${item.title}`} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="size-4" /></button>
            <button type="button" onClick={() => setDeleting(true)} aria-label={`Delete ${item.title}`} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" /></button>
          </div>
          <div className="flex gap-2">
            <Pill aria="Status" value={item.status} options={['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED']} labels={STATUS_LABELS} styles={STATUS_STYLE} onChange={(status) => void setState({ status })} icon={<CircleAlert className="size-3.5" />} />
            <Pill aria="Priority" value={item.priority} options={['LOW', 'MEDIUM', 'HIGH']} labels={PRIORITY_LABELS} styles={PRIORITY_STYLE} onChange={(priority) => void setState({ priority })} />
          </div>
        </div>
      </div>
      {(item.responsible || item.targetDate || item.communicatedTo || item.communicatedBy) && (
        <div className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
          {item.responsible && <Detail label="Responsibility">{item.responsible}</Detail>}
          {item.targetDate && <Detail label="Target Date">{dmy(item.targetDate)}</Detail>}
          {item.communicatedTo && <Detail label="Communicated To">{item.communicatedTo}</Detail>}
          {item.communicatedBy && <Detail label="Communicated By">{item.communicatedBy}</Detail>}
        </div>
      )}
      {error && <div className="mt-3"><ErrorBanner message={error} /></div>}
      {deleting && (
        <ConfirmDialog
          title="Delete agenda item?"
          message={<><strong className="text-slate-900">{item.title}</strong> will be removed from this meeting’s agenda and minutes.</>}
          confirmLabel="Delete"
          onConfirm={async () => {
            await api(path, { method: 'DELETE' })
            await onChanged()
          }}
          onClose={() => setDeleting(false)}
        />
      )}
    </article>
  )
}

function AgendaForm({ schoolId, meetingId, item, onSaved, onClose }: { schoolId: string; meetingId: string; item?: AgendaItem; onSaved: () => Promise<unknown>; onClose: () => void }) {
  const [v, setV] = useState({
    title: item?.title ?? '',
    discussion: item?.discussion ?? '',
    action: item?.action ?? '',
    responsible: item?.responsible ?? '',
    targetDate: item?.targetDate ?? '',
    communicatedTo: item?.communicatedTo ?? '',
    communicatedBy: item?.communicatedBy ?? '',
    priority: item?.priority ?? ('MEDIUM' as AgendaPriority),
    status: item?.status ?? ('NOT_STARTED' as AgendaStatus),
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (key: keyof typeof v, value: string) => {
    setV((p) => ({ ...p, [key]: value }))
    setError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!v.title.trim()) return setError('Agenda is required')
    setBusy(true)
    try {
      const base = `${meetingsPath(schoolId)}/${meetingId}/agenda`
      await api(item ? `${base}/${item.id}` : base, { method: item ? 'PATCH' : 'POST', body: JSON.stringify(v) })
      await onSaved()
      onClose()
    } catch (err) {
      setError(message(err, 'Could not save the agenda item'))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <textarea aria-label="Agenda" rows={2} maxLength={300} value={v.title} onChange={(e) => set('title', e.target.value)} placeholder="Agenda (what is to be discussed) *" className={area} autoFocus />
      <textarea aria-label="Discussion" rows={3} maxLength={4000} value={v.discussion} onChange={(e) => set('discussion', e.target.value)} placeholder="Discussion" className={area} />
      <textarea aria-label="Action to be taken" rows={2} maxLength={2000} value={v.action} onChange={(e) => set('action', e.target.value)} placeholder="Action to be taken" className={area} />
      <div className="grid gap-4 sm:grid-cols-2">
        <input aria-label="Person responsible" maxLength={120} value={v.responsible} onChange={(e) => set('responsible', e.target.value)} placeholder="Person responsible" className={field} />
        <input aria-label="Target date" type="date" value={v.targetDate} onChange={(e) => set('targetDate', e.target.value)} className={field} />
        <input aria-label="To be communicated to" maxLength={200} value={v.communicatedTo} onChange={(e) => set('communicatedTo', e.target.value)} placeholder="To be communicated to" className={field} />
        <input aria-label="To be communicated by" maxLength={120} value={v.communicatedBy} onChange={(e) => set('communicatedBy', e.target.value)} placeholder="To be communicated by" className={field} />
        <select aria-label="Priority" value={v.priority} onChange={(e) => set('priority', e.target.value)} className={field}>
          {(['LOW', 'MEDIUM', 'HIGH'] as const).map((p) => <option key={p} value={p}>Priority: {PRIORITY_LABELS[p]}</option>)}
        </select>
        <select aria-label="Status" value={v.status} onChange={(e) => set('status', e.target.value)} className={field}>
          {(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'] as const).map((s) => <option key={s} value={s}>Status: {STATUS_LABELS[s]}</option>)}
        </select>
      </div>
      <ErrorBanner message={error} />
      <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
        <button type="button" onClick={onClose} className="h-9 rounded-lg px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
        <button type="submit" disabled={busy} className="h-9 rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
          {busy ? 'Saving…' : item ? 'Save Changes' : 'Add Item'}
        </button>
      </div>
    </form>
  )
}

function MeetingDialog({ schoolId, meeting, onSaved, onClose }: { schoolId: string; meeting?: Meeting; onSaved: (id: string) => Promise<void>; onClose: () => void }) {
  const [v, setV] = useState({
    title: meeting?.title ?? '',
    date: meeting?.date ?? '',
    time: meeting?.time ?? '',
    type: meeting?.type ?? ('GENERAL' as MeetingType),
    venue: meeting?.venue ?? '',
    attendees: meeting?.attendees.join(', ') ?? '',
    minutesPreparedBy: meeting?.minutesPreparedBy ?? '',
    nextMeetingDate: meeting?.nextMeetingDate ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (key: keyof typeof v, value: string) => {
    setV((p) => ({ ...p, [key]: value }))
    setError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!v.title.trim()) return setError('Title is required')
    if (!v.date) return setError('Date is required')
    if (v.nextMeetingDate && v.nextMeetingDate < v.date) return setError('The next meeting can’t be before this one')
    setBusy(true)
    try {
      const result = await api<{ id: string }>(meeting ? `${meetingsPath(schoolId)}/${meeting.id}` : meetingsPath(schoolId), {
        method: meeting ? 'PATCH' : 'POST',
        body: JSON.stringify(v),
      })
      await onSaved(result.id)
      onClose()
    } catch (err) {
      setError(message(err, 'Could not save the meeting'))
      setBusy(false)
    }
  }

  const F = ({ id, text, children, className }: { id: string; text: string; children: ReactNode; className?: string }) => (
    <div className={className}>
      <label htmlFor={id} className={label}>{text}</label>
      {children}
    </div>
  )
  return (
    <Dialog title={meeting ? 'Edit Meeting' : 'Log New Meeting'} onClose={onClose} widthClass="max-w-2xl">
      <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
        <div className="space-y-4 overflow-y-auto px-6 py-5">
          <p className="text-xs font-bold tracking-wider text-emerald-600 uppercase">Meeting Details</p>
          {F({ id: 'mt-title', text: 'Title *', children: <input id="mt-title" maxLength={150} value={v.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Weekly Management Alignment" className={field} /> })}
          <div className="grid gap-4 sm:grid-cols-2">
            {F({ id: 'mt-date', text: 'Date *', children: <input id="mt-date" type="date" value={v.date} onChange={(e) => set('date', e.target.value)} className={field} /> })}
            {F({ id: 'mt-time', text: 'Time', children: <input id="mt-time" type="time" value={v.time} onChange={(e) => set('time', e.target.value)} className={field} /> })}
            {F({
              id: 'mt-type',
              text: 'Type',
              children: (
                <select id="mt-type" value={v.type} onChange={(e) => set('type', e.target.value)} className={field}>
                  {(Object.keys(TYPE_LABELS) as MeetingType[]).map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                </select>
              ),
            })}
            {F({ id: 'mt-venue', text: 'Venue', children: <input id="mt-venue" maxLength={120} value={v.venue} onChange={(e) => set('venue', e.target.value)} placeholder="e.g. Conference Room" className={field} /> })}
          </div>
          {F({ id: 'mt-attendees', text: 'Attendees (comma-separated)', children: <input id="mt-attendees" maxLength={1000} value={v.attendees} onChange={(e) => set('attendees', e.target.value)} placeholder="e.g. Principal, HODs" className={field} /> })}
          <div className="grid gap-4 sm:grid-cols-2">
            {F({ id: 'mt-minutes', text: 'Minutes Prepared By', children: <input id="mt-minutes" maxLength={120} value={v.minutesPreparedBy} onChange={(e) => set('minutesPreparedBy', e.target.value)} placeholder="e.g. Office Secretary" className={field} /> })}
            {F({ id: 'mt-next', text: 'Next Meeting Date', children: <input id="mt-next" type="date" value={v.nextMeetingDate} min={v.date || undefined} onChange={(e) => set('nextMeetingDate', e.target.value)} className={field} /> })}
          </div>
          <ErrorBanner message={error} />
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4">
          <button type="button" onClick={onClose} className="h-10 rounded-lg px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
          <button type="submit" disabled={busy} className="h-10 rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
            {busy ? 'Saving…' : meeting ? 'Save Changes' : 'Create Meeting'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
