import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CircleCheck, CircleX, Clock, FileText, Loader2, RefreshCw, Search } from 'lucide-react'
import { api } from '@/lib/api'
import { todayIst } from '@/lib/dates'
import { ErrorBanner } from '@/components/ui/form'
import { StudentAvatar } from '@/features/students/StudentAvatar'
import { SPECIAL_TYPE_LABELS } from '@/features/schedule/api'
import { formatDate } from '@/features/portal/format'
import {
  STATUS_LABELS,
  STATUSES,
  useSheet,
  useTeacherClasses,
  type AttendanceStatus,
  type DayClass,
} from '@/features/attendance/api'

type Mark = { status: AttendanceStatus | null; note: string }

const STATUS_ON: Record<AttendanceStatus, string> = {
  PRESENT: 'bg-emerald-600 text-white',
  ABSENT: 'bg-red-600 text-white',
  LATE: 'bg-amber-500 text-white',
  EXCUSED: 'bg-sky-600 text-white',
}
const DOT: Record<AttendanceStatus, string> = {
  PRESENT: 'bg-emerald-600',
  ABSENT: 'bg-red-600',
  LATE: 'bg-amber-500',
  EXCUSED: 'bg-sky-500',
}

const classLabel = (c: Pick<DayClass, 'time' | 'subject' | 'title' | 'batch' | 'type'>) =>
  `${c.time} • ${c.subject ?? c.title} • ${c.batch.name}${c.type ? ` (${SPECIAL_TYPE_LABELS[c.type]})` : ''}`

/** Attendance Marking (PRD 5.10): one of the teacher's classes on a date, every student of its batch. */
export function AttendancePage() {
  const [params, setParams] = useSearchParams()
  const date = params.get('date') || todayIst()
  const classes = useTeacherClasses(date)
  const picked = params.get('class') ?? ''
  // Default to the first class not marked yet (or the first one).
  const classKey = classes.data?.some((c) => c.key === picked)
    ? picked
    : (classes.data?.find((c) => !c.attendance) ?? classes.data?.[0])?.key ?? ''
  const sheet = useSheet(date, classKey)
  const client = useQueryClient()

  // Unsaved marks belong to one sheet as loaded: another class, day or a fresh
  // submission starts again from what is saved.
  const sheetKey = `${date}|${classKey}|${sheet.data?.submittedAt ?? ''}`
  const [edits, setEdits] = useState<{ key: string; marks: Record<string, Mark>; notes: Record<string, boolean> }>({ key: '', marks: {}, notes: {} })
  const changed = edits.key === sheetKey ? edits : { key: sheetKey, marks: {}, notes: {} }
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const students = useMemo(() => sheet.data?.students ?? [], [sheet.data])
  const marks = useMemo(
    () => Object.fromEntries(students.map((s) => [s.id, changed.marks[s.id] ?? { status: s.status, note: s.note ?? '' }])) as Record<string, Mark>,
    [students, changed.marks],
  )
  const noteOpen = (id: string) => changed.notes[id] || !!marks[id]?.note

  const setParam = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    setParams(next, { replace: true })
    setSaved(null)
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? students.filter((s) => s.fullName.toLowerCase().includes(q) || (s.rollNumber ?? '').toLowerCase().includes(q)) : students
  }, [students, search])
  const counts = useMemo(() => {
    const c: Record<AttendanceStatus, number> = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 }
    for (const s of students) {
      const status = marks[s.id]?.status
      if (status) c[status] += 1
    }
    return c
  }, [students, marks])
  const left = students.filter((s) => !marks[s.id]?.status).length

  const mark = (id: string, patch: Partial<Mark>) => {
    setEdits({ ...changed, marks: { ...changed.marks, [id]: { ...marks[id], ...patch } } })
    setSaved(null)
    setError(null)
  }
  const markAll = (status: AttendanceStatus) => {
    setEdits({ ...changed, marks: Object.fromEntries(students.map((s) => [s.id, { status, note: marks[s.id]?.note ?? '' }])) })
    setSaved(null)
    setError(null)
  }
  const openNote = (id: string) => setEdits({ ...changed, notes: { ...changed.notes, [id]: true } })

  async function submit() {
    if (!sheet.data) return
    if (left > 0) return setError(`Mark every student first (${left} left)`)
    setBusy(true)
    setError(null)
    try {
      await api('/teacher/attendance/sheet', {
        method: 'PUT',
        body: JSON.stringify({
          date,
          class: classKey,
          records: students.map((s) => ({ studentId: s.id, status: marks[s.id].status, note: marks[s.id].note })),
        }),
      })
      await client.invalidateQueries({ queryKey: ['teacher-attendance'] })
      setSaved(sheet.data.submittedAt ? 'Attendance updated' : 'Attendance submitted')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save attendance')
    } finally {
      setBusy(false)
    }
  }

  const selected = classes.data?.find((c) => c.key === classKey)
  const refreshing = classes.isFetching || sheet.isFetching
  return (
    <div className="pb-28">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-[26px]">Attendance Marking</h1>
          <p className="mt-1 text-sm text-slate-500">{date === todayIst() ? 'Mark attendance for today’s class' : 'Mark or review attendance for the chosen day'}</p>
        </div>
        <button
          type="button"
          onClick={() => void Promise.all([classes.refetch(), classKey ? sheet.refetch() : null])}
          disabled={refreshing}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <section className="mt-6 grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-3">
        <div>
          <label htmlFor="att-date" className="mb-1.5 block text-[11px] font-bold tracking-wider text-slate-500 uppercase">Date</label>
          <input id="att-date" type="date" value={date} onChange={(e) => setParam({ date: e.target.value, class: '' })} className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 focus:outline-none" />
        </div>
        <div>
          <label htmlFor="att-class" className="mb-1.5 block text-[11px] font-bold tracking-wider text-slate-500 uppercase">Class</label>
          <select
            id="att-class"
            value={classKey}
            onChange={(e) => setParam({ class: e.target.value })}
            disabled={!classes.data?.length}
            className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 focus:outline-none disabled:text-slate-400"
          >
            {classes.isPending ? <option>Loading…</option> : classes.data?.length ? null : <option>No classes on this day</option>}
            {classes.data?.map((c) => (
              <option key={c.key} value={c.key}>{classLabel(c)}{c.attendance ? ' ✓' : ''}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-2 md:mt-[22px]">
          <Clock className="size-5 text-slate-500" />
          <div>
            <p className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">Class Time</p>
            <p className="text-sm font-semibold text-slate-900">{selected ? `${selected.time}${selected.room ? ` • ${selected.room}` : ''}` : '—'}</p>
          </div>
        </div>
      </section>

      {classes.error && <div className="mt-4"><ErrorBanner message={classes.error.message} /></div>}
      {classes.data?.length === 0 && (
        <p className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-500">
          You have no classes on {date === todayIst() ? 'today' : 'this day'}. Classes come from your weekly slots and special classes on the Schedule page.
        </p>
      )}

      {classKey && (
        <>
          <div className="mt-8 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
              Student List <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">({students.length} Students)</span>
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search students..." aria-label="Search students" className="h-9 w-52 rounded-lg border border-slate-200 pr-3 pl-9 text-sm focus:outline-none" />
              </div>
              <button type="button" onClick={() => markAll('PRESENT')} disabled={!students.length} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50">
                <CircleCheck className="size-4 text-emerald-600" /> Mark All Present
              </button>
              <button type="button" onClick={() => markAll('ABSENT')} disabled={!students.length} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50">
                <CircleX className="size-4 text-red-600" /> Mark All Absent
              </button>
            </div>
          </div>

          {sheet.data?.submittedAt && (
            <p className="mt-3 text-xs text-slate-500">Submitted {formatDate(sheet.data.submittedAt)}. Changes replace the saved attendance.</p>
          )}
          {sheet.data && !sheet.data.canSubmit && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">This class is in the future; attendance can be marked on the day.</p>
          )}

          <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {sheet.error ? (
              <div className="p-6"><ErrorBanner message={sheet.error.message} /></div>
            ) : sheet.isPending ? (
              <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-slate-300" aria-label="Loading" /></div>
            ) : students.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-slate-400 italic">No active students in {selected?.batch.name ?? 'this batch'}.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="px-6 py-3.5 text-[11px] font-bold tracking-wider text-slate-500 uppercase">Student</th>
                      <th className="px-6 py-3.5 text-center text-[11px] font-bold tracking-wider text-slate-500 uppercase">Attendance Status</th>
                      <th className="px-6 py-3.5 text-right text-[11px] font-bold tracking-wider text-slate-500 uppercase">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((s) => {
                      const m = marks[s.id] ?? { status: null, note: '' }
                      return (
                        <tr key={s.id} className="border-b border-slate-50 align-top last:border-0">
                          <td className="px-6 py-3.5">
                            <div className="flex items-center gap-3">
                              <StudentAvatar name={s.fullName} photoUrl={s.photoUrl} />
                              <div>
                                <p className="text-sm font-semibold text-slate-900">{s.fullName}</p>
                                {s.rollNumber && <p className="text-xs text-slate-500">Roll {s.rollNumber}</p>}
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-3.5 text-center">
                            <div role="radiogroup" aria-label={`Attendance for ${s.fullName}`} className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                              {STATUSES.map((status) => (
                                <button
                                  key={status}
                                  type="button"
                                  role="radio"
                                  aria-checked={m.status === status}
                                  onClick={() => mark(s.id, { status })}
                                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${m.status === status ? STATUS_ON[status] : 'text-slate-700 hover:bg-white'}`}
                                >
                                  {STATUS_LABELS[status]}
                                </button>
                              ))}
                            </div>
                          </td>
                          <td className="px-6 py-3.5 text-right">
                            {noteOpen(s.id) ? (
                              <input
                                value={m.note}
                                maxLength={300}
                                onChange={(e) => mark(s.id, { note: e.target.value })}
                                placeholder="Add a note..."
                                aria-label={`Note for ${s.fullName}`}
                                className="h-9 w-52 rounded-lg border border-slate-200 px-3 text-xs focus:outline-none"
                              />
                            ) : (
                              <button type="button" onClick={() => openNote(s.id)} aria-label={`Add a note for ${s.fullName}`} className="rounded-lg border border-slate-200 p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-700">
                                <FileText className="size-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                    {shown.length === 0 && (
                      <tr><td colSpan={3} className="px-6 py-8 text-center text-sm text-slate-400 italic">No student matches “{search}”.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="fixed right-4 bottom-4 left-4 z-20 rounded-2xl border border-slate-200 bg-white px-6 py-4 shadow-lg lg:left-[calc(16rem+1.5rem)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                {STATUSES.map((status) => (
                  <span key={status} className="flex items-center gap-1.5 text-xs font-bold tracking-wider text-slate-600 uppercase">
                    <span className={`size-2.5 rounded-full ${DOT[status]}`} /> {STATUS_LABELS[status]}: <span className="text-slate-900">{counts[status]}</span>
                  </span>
                ))}
                {left > 0 && students.length > 0 && <span className="text-xs text-slate-500">{left} left</span>}
              </div>
              <div className="flex items-center gap-3">
                {saved && <span role="status" className="text-sm font-medium text-emerald-600">{saved}</span>}
                {error && <span role="alert" className="max-w-xs text-sm text-red-600">{error}</span>}
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={busy || !sheet.data?.canSubmit || students.length === 0}
                  className="h-11 rounded-lg bg-ink px-6 text-sm font-bold text-white hover:bg-ink-hover disabled:opacity-50"
                >
                  {busy ? 'Saving…' : sheet.data?.submittedAt ? 'Update Attendance' : 'Submit Attendance'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
