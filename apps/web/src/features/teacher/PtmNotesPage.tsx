import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { CalendarDays, CircleCheck, CircleX, Info, Loader2, MessageSquare, Pencil, Plus, Printer, Search, Send, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { todayIst } from '@/lib/dates'
import { ConfirmDialog, ErrorBanner } from '@/components/ui/form'
import { inputClass, textareaClass } from '@/components/ui/formStyles'
import {
  emptyPtmForm,
  PTM_PATH,
  ptmFormOf,
  ptmProblem,
  shortDay,
  studentLabel,
  toPtmPayload,
  useInvalidatePtm,
  usePtmNotes,
  usePtmOptions,
  type PtmForm,
  type PtmNote,
} from '@/features/ptm-notes/api'
import { printPtmReport } from '@/features/ptm-notes/ptmReport'

const label = 'mb-2 block text-[11px] font-bold tracking-wider text-slate-700 uppercase'

/** PTM Notes (PRD 5.8): Parent Meeting Notes & Action Items, faculty only. */
export function PtmNotesPage() {
  const options = usePtmOptions()
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])
  const notes = usePtmNotes(q)
  const invalidate = useInvalidatePtm()
  const [editing, setEditing] = useState<PtmNote | null>(null)
  const [deleting, setDeleting] = useState<PtmNote | null>(null)

  return (
    <>
      <h1 className="flex items-center gap-2.5 text-2xl font-bold text-slate-900 sm:text-[26px]">
        <MessageSquare className="size-6 shrink-0" /> Parent Meeting Notes &amp; Action Items (PTM Log)
      </h1>
      <p className="mt-1 text-sm text-slate-500">Record discussion notes, action items, parent attendance, and follow-up tasks from Parent-Teacher Meetings.</p>

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-2 2xl:grid-cols-[minmax(0,640px)_minmax(0,1fr)]">
        <LogForm
          key={editing?.id ?? 'new'}
          options={options.data}
          optionsError={options.error?.message}
          editing={editing}
          onDone={async () => { setEditing(null); await invalidate() }}
          onCancel={() => setEditing(null)}
        />

        <div className="space-y-5">
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by student name or notes..."
                aria-label="Search meeting notes"
                className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50/60 pr-3 pl-9 text-sm focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
              />
            </div>
            <span className="shrink-0 text-xs font-semibold text-slate-500">Total: {notes.data?.total ?? 0}</span>
          </div>

          {notes.error && <ErrorBanner message={notes.error.message} />}
          {!notes.data ? (
            !notes.error && <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-slate-300" aria-label="Loading" /></div>
          ) : notes.data.items.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center shadow-sm">
              <MessageSquare className="size-10 text-slate-300" strokeWidth={1.5} />
              <p className="mt-3 text-sm font-semibold text-slate-500">{q ? `No meeting notes match “${q}”.` : 'No parent meeting logs found.'}</p>
            </div>
          ) : (
            <>
              <ul className="space-y-4">
                {notes.data.items.map((n) => (
                  <NoteCard key={n.id} note={n} editing={editing?.id === n.id} canChange={!!options.data?.active} onEdit={() => { setEditing(n); window.scrollTo({ top: 0, behavior: 'smooth' }) }} onDelete={() => setDeleting(n)} />
                ))}
              </ul>
              {notes.data.total > notes.data.items.length && <p className="text-center text-xs text-slate-400">Showing the latest {notes.data.items.length} of {notes.data.total}. Search to find older notes.</p>}
            </>
          )}
        </div>
      </div>

      {deleting && (
        <ConfirmDialog
          title="Delete meeting notes?"
          message={<>The notes from your meeting about <strong className="text-slate-900">{deleting.student.fullName}</strong> on {shortDay(deleting.date)} will be deleted. This can’t be undone.</>}
          confirmLabel="Delete Notes"
          onConfirm={async () => {
            await api(`${PTM_PATH}/${deleting.id}`, { method: 'DELETE' })
            if (editing?.id === deleting.id) setEditing(null)
            await invalidate()
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  )
}

function LogForm({ options, optionsError, editing, onDone, onCancel }: {
  options: ReturnType<typeof usePtmOptions>['data']
  optionsError: string | undefined
  editing: PtmNote | null
  onDone: () => Promise<unknown>
  onCancel: () => void
}) {
  const today = options?.today ?? todayIst()
  const [form, setForm] = useState<PtmForm | null>(editing ? ptmFormOf(editing) : null)
  const f = form ?? emptyPtmForm(today, options?.batches[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const set = <K extends keyof PtmForm>(key: K, value: PtmForm[K]) => {
    setForm((prev) => ({ ...(prev ?? emptyPtmForm(today, options?.batches[0]?.id ?? '')), [key]: value }))
    setError(null)
    setSaved(null)
  }

  const canLog = !!options?.active && options.batches.length > 0
  const batch = options?.batches.find((b) => b.id === f.batchId)
  const recorded =
    editing && !options?.batches.some((b) => b.id === editing.batch.id)
      ? { value: editing.batch.id ?? '', label: `${editing.batch.name}${editing.batch.id ? '' : ' (batch deleted)'}` }
      : null
  const students = useMemo(() => {
    const list = batch?.students ?? []
    // A note being corrected keeps showing its student, even one who has moved batch since.
    if (editing && f.studentId === editing.student.id && !list.some((s) => s.id === editing.student.id)) return [editing.student, ...list]
    return list
  }, [batch, editing, f.studentId])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = ptmProblem(f, today, editing ? { studentId: editing.student.id } : undefined)
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    try {
      await api(editing ? `${PTM_PATH}/${editing.id}` : PTM_PATH, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(toPtmPayload(f)) })
      setForm(null)
      setSaved(editing ? 'Meeting notes updated.' : 'Meeting notes saved.')
      await onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the meeting notes')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="flex items-center gap-2 border-b border-slate-100 pb-4 text-base font-bold text-slate-900">
        {editing ? <Pencil className="size-4" /> : <Plus className="size-4" />} {editing ? 'Edit Parent Meeting' : 'Log New Parent Meeting'}
      </h2>
      {optionsError && <div className="mt-4"><ErrorBanner message={optionsError} /></div>}
      {options && !options.active && <Notice>Your faculty profile isn’t active in this school, so PTM notes aren’t available. Contact your school admin if this is a mistake.</Notice>}
      {options?.active && options.batches.length === 0 && <Notice>You don’t have any batches assigned yet. Once your admin assigns you a batch, you can log meetings with its students’ parents.</Notice>}

      <fieldset disabled={!canLog || busy} className="mt-5 grid gap-x-4 gap-y-5 sm:grid-cols-2">
        <div>
          <label htmlFor="ptm-batch" className={label}>Batch</label>
          <select id="ptm-batch" value={f.batchId} onChange={(e) => { set('batchId', e.target.value); set('studentId', '') }} className={`${inputClass()} h-11`}>
            {/* A note being corrected keeps its recorded batch, even one deleted or no longer the teacher's. */}
            {recorded ? <option value={recorded.value}>{recorded.label}</option> : !f.batchId && <option value="">Select batch...</option>}
            {(options?.batches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="ptm-date" className={label}>Date</label>
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input id="ptm-date" type="date" value={f.date} max={today} onChange={(e) => set('date', e.target.value)} className={`${inputClass()} h-11 pl-10`} />
          </div>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="ptm-student" className={label}>Select Student <span className="text-red-500">*</span></label>
          <select id="ptm-student" value={f.studentId} onChange={(e) => set('studentId', e.target.value)} className={`${inputClass()} h-11`}>
            <option value="">{batch && students.length === 0 ? 'No students in this batch' : 'Select student...'}</option>
            {students.map((s) => <option key={s.id} value={s.id}>{studentLabel(s)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="ptm-parent" className={label}>Parent Name</label>
          <input id="ptm-parent" value={f.parentName} maxLength={120} onChange={(e) => set('parentName', e.target.value)} placeholder="e.g. Mr. Sharma" className={`${inputClass()} h-11 bg-slate-50/60`} />
        </div>
        <div>
          <p className={label} id="ptm-attended-label">Parent Attended?</p>
          <div role="radiogroup" aria-labelledby="ptm-attended-label" className="grid grid-cols-2 gap-2">
            {([true, false] as const).map((v) => (
              <button
                key={String(v)}
                type="button"
                role="radio"
                aria-checked={f.parentAttended === v}
                onClick={() => set('parentAttended', v)}
                className={`h-11 rounded-lg border text-sm font-bold transition ${
                  f.parentAttended === v ? (v ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700') : 'border-slate-200 bg-slate-50/60 text-slate-500 hover:bg-slate-100'
                }`}
              >
                {v ? 'Yes' : 'No'}
              </button>
            ))}
          </div>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="ptm-discussion" className={label}>Discussion Notes <span className="text-red-500">*</span></label>
          <textarea id="ptm-discussion" value={f.discussion} maxLength={4000} rows={3} onChange={(e) => set('discussion', e.target.value)} placeholder="Key feedback discussed with parent regarding performance, attendance, behavior..." className={`${textareaClass()} min-h-24 bg-slate-50/60`} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="ptm-actions" className={label}>Action Items &amp; Commitments</label>
          <textarea id="ptm-actions" value={f.actionItems} maxLength={4000} rows={3} onChange={(e) => set('actionItems', e.target.value)} placeholder="Agreed action points (e.g. daily 1-hour self-study, extra guidance in Physics)..." className={`${textareaClass()} min-h-24 bg-slate-50/60`} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="ptm-follow" className={label}>Follow-up Date (Optional)</label>
          <input id="ptm-follow" type="date" value={f.followUpDate} min={f.date || undefined} onChange={(e) => set('followUpDate', e.target.value)} className={`${inputClass()} h-11`} />
        </div>
      </fieldset>

      {error && <div className="mt-5"><ErrorBanner message={error} /></div>}
      {saved && <p role="status" className="mt-5 text-sm font-semibold text-emerald-600">{saved}</p>}
      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        {editing && (
          <button type="button" onClick={onCancel} disabled={busy} className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-6 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60 sm:w-36">
            Cancel
          </button>
        )}
        <button type="submit" disabled={!canLog || busy} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-ink text-sm font-bold text-white transition hover:bg-ink-hover disabled:opacity-60">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} {editing ? 'Save Changes' : 'Submit Meeting Notes'}
        </button>
      </div>
    </form>
  )
}

function NoteCard({ note: n, editing, canChange, onEdit, onDelete }: { note: PtmNote; editing: boolean; canChange: boolean; onEdit: () => void; onDelete: () => void }) {
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function print() {
    setPrinting(true)
    setError(null)
    try {
      await printPtmReport(n)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not prepare the report')
    } finally {
      setPrinting(false)
    }
  }
  return (
    <li className={`rounded-2xl border bg-white p-5 shadow-sm ${editing ? 'border-indigo-300 ring-1 ring-indigo-200' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-bold text-slate-900">{n.student.fullName}</p>
          <p className="mt-0.5 text-xs text-slate-400">{n.batch.name} · Roll No: {n.student.rollNumber || 'N/A'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {n.parentAttended ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700"><CircleCheck className="size-3" /> Parent Attended</span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[11px] font-bold text-red-700"><CircleX className="size-3" /> Parent Absent</span>
          )}
          <span className="text-xs text-slate-500">{shortDay(n.date)}</span>
          <button type="button" onClick={() => void print()} disabled={printing} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-200 disabled:opacity-60">
            {printing ? <Loader2 className="size-3.5 animate-spin" /> : <Printer className="size-3.5" />} Print
          </button>
          {canChange && (
            <>
              <button type="button" onClick={onEdit} aria-label={`Edit notes for ${n.student.fullName}, ${shortDay(n.date)}`} title="Edit" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="size-4" /></button>
              <button type="button" onClick={onDelete} aria-label={`Delete notes for ${n.student.fullName}, ${shortDay(n.date)}`} title="Delete" className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" /></button>
            </>
          )}
        </div>
      </div>
      <div className="mt-4 space-y-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
        <Detail label="Discussion Notes">{n.discussion}</Detail>
        {n.actionItems && <Detail label="Action Items & Commitments">{n.actionItems}</Detail>}
        {(n.parentName || n.followUpDate) && (
          <p className="text-[11px] text-slate-500">
            {n.parentName && <>Parent: <span className="font-semibold text-slate-700">{n.parentName}</span></>}
            {n.parentName && n.followUpDate && ' · '}
            {n.followUpDate && <>Follow-up: <span className="font-semibold text-slate-700">{shortDay(n.followUpDate)}</span></>}
          </p>
        )}
      </div>
      {error && <div className="mt-3"><ErrorBanner message={error} /></div>}
    </li>
  )
}

function Detail({ label: title, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">{title}</p>
      <p className="mt-1 text-sm whitespace-pre-line text-slate-800 [overflow-wrap:anywhere]">{children}</p>
    </div>
  )
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs text-sky-800">
      <Info className="mt-px size-3.5 shrink-0" />
      {children}
    </p>
  )
}
