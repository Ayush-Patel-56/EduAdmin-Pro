import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Award, CalendarDays, ClipboardList, Info, Loader2, Pencil, Send, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { todayIst } from '@/lib/dates'
import { ConfirmDialog, ErrorBanner } from '@/components/ui/form'
import { inputClass, textareaClass } from '@/components/ui/formStyles'
import { Select } from '@/components/ui/Select'
import {
  emptyForm,
  formOf,
  formProblem,
  shortDay,
  TEACHER_PATH,
  toPayload,
  useInvalidateMyReports,
  useMyReports,
  useReportOptions,
  type DailyReport,
  type ReportForm,
} from '@/features/daily-reports/api'
import { ProgressReportsLater, ReportTab, ReportTabBar, StatusPill } from '@/features/daily-reports/ui'

type Tab = 'daily' | 'progress'

/** Daily Class Report (PRD 5.6): log what was taught; reports sent after their day are marked Late. */
export function DailyReportPage() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'progress' ? 'progress' : 'daily'
  return (
    <>
      <ReportTabBar label="Daily Class Report">
        <ReportTab accent="ink" active={tab === 'daily'} onClick={() => setParams({}, { replace: true })} icon={ClipboardList} label="Daily Class Report" />
        <ReportTab accent="ink" active={tab === 'progress'} onClick={() => setParams({ tab: 'progress' }, { replace: true })} icon={Award} label="Student Progress Reports" />
      </ReportTabBar>
      {tab === 'daily' ? <DailyClassReport /> : <ProgressReportsLater />}
    </>
  )
}

function DailyClassReport() {
  const options = useReportOptions()
  const mine = useMyReports()
  const invalidate = useInvalidateMyReports()
  const today = options.data?.today ?? todayIst()
  const [form, setForm] = useState<ReportForm | null>(null)
  const [editing, setEditing] = useState<DailyReport | null>(null)
  const [deleting, setDeleting] = useState<DailyReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const top = useRef<HTMLDivElement>(null)
  const f = form ?? emptyForm(today)
  const set = <K extends keyof ReportForm>(key: K, value: ReportForm[K]) => {
    setForm((prev) => ({ ...(prev ?? emptyForm(today)), [key]: value }))
    setError(null)
    setSaved(null)
  }

  const o = options.data
  const canSubmit = !!o?.active && o.batches.length > 0
  const batchOptions = useMemo(() => {
    const list = (o?.batches ?? []).map((b) => ({ value: b.id, label: b.program ? `${b.name} (${b.program})` : b.name }))
    // A report being edited keeps showing its batch.
    if (editing && !list.some((b) => b.value === editing.batch.id)) list.push({ value: editing.batch.id, label: editing.batch.name })
    return list
  }, [o, editing])
  const subjectOptions = useMemo(() => {
    const list = (o?.subjects ?? []).map((s) => ({ value: s, label: s }))
    if (f.subject && !list.some((s) => s.value.toLowerCase() === f.subject.toLowerCase())) list.unshift({ value: f.subject, label: f.subject })
    return list
  }, [o, f.subject])

  const startEdit = (r: DailyReport) => {
    setEditing(r)
    setForm(formOf(r))
    setError(null)
    setSaved(null)
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const reset = () => {
    setEditing(null)
    setForm(null)
    setError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = formProblem(f, today)
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    try {
      const result = await api<{ id: string; late: boolean }>(editing ? `${TEACHER_PATH}/${editing.id}` : TEACHER_PATH, {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(toPayload(f)),
      })
      await invalidate()
      setSaved(
        editing
          ? 'Report updated.'
          : result.late
            ? 'Report submitted. It is marked Late because it is for an earlier day.'
            : 'Report submitted successfully!',
      )
      setEditing(null)
      setForm(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit the report')
    } finally {
      setBusy(false)
    }
  }

  const earlier = !!f.date && f.date < today
  const moving = editing && f.date !== editing.date

  return (
    <div ref={top} className="max-w-[900px] scroll-mt-24">
      <h1 className="text-2xl font-bold text-slate-900 sm:text-[26px]">{editing ? 'Edit Daily Report' : 'Daily Report'}</h1>
      <p className="mt-1 text-sm text-slate-500">{editing ? `Editing your ${editing.subject} report for ${shortDay(editing.date)}` : 'Log what was taught today'}</p>

      {options.error && <div className="mt-4"><ErrorBanner message={options.error.message} /></div>}
      {o && !o.active && (
        <Notice>Your faculty profile isn’t active in this school, so you can’t submit daily reports. Your earlier reports are still listed below.</Notice>
      )}
      {o?.active && o.batches.length === 0 && (
        <Notice>You don’t have any batches assigned yet. Once your admin assigns you a batch, you can report on it here.</Notice>
      )}

      <form onSubmit={submit} noValidate className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
        <fieldset disabled={!canSubmit || busy} className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          <Labelled id="dr-date" label="Date">
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <input id="dr-date" type="date" value={f.date} max={today} onChange={(e) => set('date', e.target.value)} className={`${inputClass()} h-11 pl-10`} />
            </div>
          </Labelled>
          <Labelled id="dr-batch" label="Batch">
            <Select id="dr-batch" value={f.batchId || null} options={batchOptions} onChange={(v) => set('batchId', v)} placeholder="Select batch..." disabled={!canSubmit} />
          </Labelled>
          <Labelled id="dr-subject" label="Subject">
            <Select id="dr-subject" value={f.subject || null} options={subjectOptions} onChange={(v) => set('subject', v)} placeholder="Select subject..." disabled={!canSubmit} />
          </Labelled>
          <Labelled id="dr-chapter" label="Chapter">
            <input id="dr-chapter" value={f.chapter} maxLength={150} onChange={(e) => set('chapter', e.target.value)} placeholder="Enter chapter name..." className={`${inputClass()} h-11`} />
          </Labelled>
          <Labelled id="dr-topics" label="Topics Covered" required className="sm:col-span-2">
            <textarea id="dr-topics" value={f.topics} maxLength={4000} rows={4} onChange={(e) => set('topics', e.target.value)} placeholder="Briefly describe the topics discussed..." className={`${textareaClass()} min-h-28 bg-slate-50/60`} />
          </Labelled>
          <Labelled id="dr-homework" label="Homework Given">
            <textarea id="dr-homework" value={f.homework} maxLength={4000} rows={3} onChange={(e) => set('homework', e.target.value)} placeholder="Assignments or readings..." className={`${textareaClass()} min-h-24 bg-slate-50/60`} />
          </Labelled>
          <Labelled id="dr-observations" label="Observations (Optional)">
            <textarea id="dr-observations" value={f.observations} maxLength={4000} rows={3} onChange={(e) => set('observations', e.target.value)} placeholder="Any behavioral or academic notes..." className={`${textareaClass()} min-h-24 bg-slate-50/60`} />
          </Labelled>
        </fieldset>

        {canSubmit && (earlier || moving) && (
          <p className="mt-5 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
            <Info className="mt-px size-3.5 shrink-0" />
            {moving
              ? 'Changing the date makes this a report for that day, submitted now: it is On Time only if that day is today.'
              : editing
                ? 'This report keeps the status it was submitted with.'
                : `This report is for ${shortDay(f.date)}, an earlier day, so it will be marked Late. Only a report submitted on the day itself is On Time.`}
          </p>
        )}
        {error && <div className="mt-5"><ErrorBanner message={error} /></div>}
        {saved && <p role="status" className="mt-5 text-sm font-semibold text-emerald-600">{saved}</p>}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          {editing && (
            <button type="button" onClick={reset} disabled={busy} className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-6 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60 sm:w-40">
              Cancel
            </button>
          )}
          <button type="submit" disabled={!canSubmit || busy} className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-ink text-sm font-bold text-white transition hover:bg-ink-hover disabled:opacity-60">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {editing ? 'Save Changes' : 'Submit Daily Report'}
          </button>
        </div>
      </form>

      <section className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b border-slate-100 px-6 py-5 text-base font-bold text-slate-900">Your Recent Submissions</h2>
        {mine.error ? (
          <div className="p-5"><ErrorBanner message={mine.error.message} /></div>
        ) : !mine.data ? (
          <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-slate-300" aria-label="Loading" /></div>
        ) : mine.data.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">No submissions yet. Submit your first report above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead>
                <tr className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                  <th scope="col" className="px-6 py-3">Date</th>
                  <th scope="col" className="px-3 py-3">Batch</th>
                  <th scope="col" className="px-3 py-3">Subject</th>
                  <th scope="col" className="px-3 py-3">Chapter</th>
                  <th scope="col" className="px-3 py-3 text-center">Status</th>
                  <th scope="col" className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {mine.data.map((r) => {
                  const own = !!o?.active && o.batches.some((b) => b.id === r.batch.id)
                  return (
                    <tr key={r.id} className={editing?.id === r.id ? 'bg-indigo-50/50' : 'hover:bg-slate-50/60'}>
                      <td className="px-6 py-4 whitespace-nowrap text-slate-700">{shortDay(r.date)}</td>
                      <td className="px-3 py-4 font-semibold text-slate-900">{r.batch.name}</td>
                      <td className="px-3 py-4 text-slate-600">{r.subject}</td>
                      <td className="max-w-[200px] truncate px-3 py-4 text-slate-600" title={r.chapter ?? undefined}>{r.chapter || '—'}</td>
                      <td className="px-3 py-4 text-center"><StatusPill late={r.late} /></td>
                      <td className="px-6 py-4">
                        <div className="flex justify-end gap-1">
                          <button type="button" onClick={() => startEdit(r)} disabled={!own} title={own ? 'Edit report' : 'You are no longer assigned to this batch'} aria-label={`Edit ${r.subject} report for ${shortDay(r.date)}`} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">
                            <Pencil className="size-4" />
                          </button>
                          <button type="button" onClick={() => setDeleting(r)} disabled={!own} title={own ? 'Delete report' : 'You are no longer assigned to this batch'} aria-label={`Delete ${r.subject} report for ${shortDay(r.date)}`} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40">
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {deleting && (
        <ConfirmDialog
          title="Delete report?"
          message={
            <>
              Your <strong className="text-slate-900">{deleting.subject}</strong> report for <strong className="text-slate-900">{deleting.batch.name}</strong> on {shortDay(deleting.date)} will be deleted,
              and admins will no longer see it. This can’t be undone.
            </>
          }
          confirmLabel="Delete Report"
          onConfirm={async () => {
            await api(`${TEACHER_PATH}/${deleting.id}`, { method: 'DELETE' })
            if (editing?.id === deleting.id) reset()
            setSaved(null)
            await invalidate()
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

function Labelled({ id, label, required, className, children }: { id: string; label: string; required?: boolean; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-2 block text-sm font-bold text-slate-900">
        {label}
        {required && <span className="ml-0.5 text-red-500" aria-hidden> *</span>}
      </label>
      {children}
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
