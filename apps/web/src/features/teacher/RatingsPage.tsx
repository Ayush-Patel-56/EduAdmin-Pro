import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Award, CalendarDays, Check, CircleDot, Loader2, Save, Sparkles, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { todayIst } from '@/lib/dates'
import { ConfirmDialog, ErrorBanner } from '@/components/ui/form'
import { RATING_LABELS } from '@/features/student-reports/api'

type Options = { today: string; active: boolean; levels: string[]; batches: { id: string; name: string; program: string }[] }
type Rating = { attitude: number; behaviour: number; focus: number; interaction: number; notes: string | null; updatedAt?: string }
type Sheet = { date: string; students: { student: { id: string; fullName: string; rollNumber: string | null }; rating: Rating | null }[] }
type Draft = { attitude: number | null; behaviour: number | null; focus: number | null; interaction: number | null; notes: string }

const PATH = '/teacher/daily-ratings'
const DIMENSIONS = [
  ['attitude', 'Attitude'],
  ['behaviour', 'Behaviour'],
  ['focus', 'Focus'],
  ['interaction', 'Interaction'],
] as const
const LEVEL_STYLE = ['text-rose-700', 'text-amber-700', 'text-sky-700', 'text-indigo-700', 'text-emerald-700']

const draftOf = (r: Rating | null): Draft => (r ? { attitude: r.attitude, behaviour: r.behaviour, focus: r.focus, interaction: r.interaction, notes: r.notes ?? '' } : { attitude: null, behaviour: null, focus: null, interaction: null, notes: '' })
const complete = (d: Draft) => DIMENSIONS.every(([k]) => d[k] !== null)
const same = (d: Draft, r: Rating | null) => !!r && DIMENSIONS.every(([k]) => d[k] === r[k]) && d.notes.trim() === (r.notes ?? '')

/**
 * Student Ratings (PRD 5.7): rate each student of a batch for a day on
 * Attitude, Behaviour, Focus and Interaction. Each teacher's ratings are
 * their own; the 5-in-1 report averages every teacher's into the behaviour score.
 */
export function RatingsPage() {
  const options = useQuery({ queryKey: [PATH, 'options'], queryFn: () => api<Options>(`${PATH}/options`) })
  const o = options.data
  const [date, setDate] = useState(todayIst())
  const [picked, setBatchId] = useState('')
  // The first of the teacher's batches until they pick one.
  const batchId = picked && o?.batches.some((b) => b.id === picked) ? picked : (o?.batches[0]?.id ?? '')
  const sheet = useQuery({
    queryKey: [PATH, 'sheet', date, batchId],
    queryFn: () => api<Sheet>(`${PATH}?date=${date}&batchId=${batchId}`),
    enabled: !!batchId && !!o?.active,
  })

  return (
    <>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 sm:text-[26px]">Student Ratings</h1>
          <p className="mt-1 text-sm text-slate-500">Rate your students’ attitude, behaviour, focus and interaction for the day.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="relative inline-flex h-10 items-center rounded-lg border border-slate-200 bg-white pr-2 pl-9 shadow-sm focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100">
            <CalendarDays className="pointer-events-none absolute left-3 size-4 text-slate-400" />
            <span className="sr-only">Date</span>
            <input type="date" value={date} max={o?.today ?? todayIst()} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-full bg-transparent text-sm font-semibold text-slate-800 focus:outline-none" />
          </label>
          <label className="sr-only" htmlFor="rt-batch">Batch</label>
          <select id="rt-batch" value={batchId} onChange={(e) => setBatchId(e.target.value)} disabled={!o?.batches.length} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 shadow-sm focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 focus:outline-none">
            {!o?.batches.length && <option value="">No batches assigned</option>}
            {o?.batches.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.program}</option>)}
          </select>
        </div>
      </div>

      <ErrorBanner message={options.error?.message ?? sheet.error?.message} />
      {o && !o.active ? (
        <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">Your faculty profile is inactive, so you can’t rate students.</p>
      ) : o && !o.batches.length ? (
        <div className="mt-6 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white py-14 text-center"><Award className="size-8 text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-600">No batches are assigned to you yet</p></div>
      ) : !sheet.data ? (
        !sheet.error && <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-slate-300" aria-label="Loading" /></div>
      ) : (
        <Grid key={`${date}|${batchId}`} sheet={sheet.data} batchId={batchId} />
      )}
    </>
  )
}

function Grid({ sheet, batchId }: { sheet: Sheet; batchId: string }) {
  const client = useQueryClient()
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(sheet.students.map((s) => [s.student.id, draftOf(s.rating)])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [clearing, setClearing] = useState<Sheet['students'][number] | null>(null)
  const savedOf = useMemo(() => new Map(sheet.students.map((s) => [s.student.id, s.rating])), [sheet])
  const pending = sheet.students.filter((s) => complete(drafts[s.student.id]) && !same(drafts[s.student.id], s.rating))
  const incomplete = sheet.students.filter((s) => { const d = drafts[s.student.id]; return !complete(d) && DIMENSIONS.some(([k]) => d[k] !== null) })
  const set = (id: string, patch: Partial<Draft>) => {
    setDrafts((ds) => ({ ...ds, [id]: { ...ds[id], ...patch } }))
    setMessage(null)
    setError(null)
  }
  const preset = (level: number) => {
    setDrafts((ds) => Object.fromEntries(Object.entries(ds).map(([id, d]) => [id, { ...d, attitude: level, behaviour: level, focus: level, interaction: level }])))
    setMessage(null)
  }

  async function saveAll() {
    if (incomplete.length) return setError(`Rate all four for ${incomplete.map((s) => s.student.fullName).slice(0, 3).join(', ')}${incomplete.length > 3 ? ` and ${incomplete.length - 3} more` : ''}, or clear them`)
    if (!pending.length) return setMessage('Nothing new to save')
    setBusy(true)
    setError(null)
    try {
      const ratings = pending.map((s) => {
        const d = drafts[s.student.id]
        return { studentId: s.student.id, attitude: d.attitude, behaviour: d.behaviour, focus: d.focus, interaction: d.interaction, notes: d.notes.trim() || null }
      })
      await api(PATH, { method: 'PUT', body: JSON.stringify({ date: sheet.date, batchId, ratings }) })
      await client.invalidateQueries({ queryKey: [PATH, 'sheet', sheet.date, batchId] })
      setMessage(`Saved ${ratings.length} rating${ratings.length === 1 ? '' : 's'}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  const rated = sheet.students.filter((s) => s.rating).length
  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900">{sheet.students.length} student{sheet.students.length === 1 ? '' : 's'}</h2>
          <p className="mt-0.5 text-xs text-slate-500">{rated} rated for this day · {pending.length} change{pending.length === 1 ? '' : 's'} to save</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold tracking-wider text-slate-500 uppercase"><Sparkles className="mr-1 inline size-3.5" />Quick presets</span>
          {[[3, 'Set Good'], [4, 'Set Very Good'], [5, 'Set Excellent']].map(([level, label]) => (
            <button key={level} type="button" onClick={() => preset(level as number)} disabled={!sheet.students.length} className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{label}</button>
          ))}
          <button type="button" onClick={() => void saveAll()} disabled={busy || !sheet.students.length} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-xs font-semibold text-white hover:bg-ink-hover disabled:opacity-60">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save All Ratings
          </button>
        </div>
      </div>
      {(error || message) && <div className="border-b border-slate-100 px-5 py-3">{error ? <ErrorBanner message={error} /> : <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700"><Check className="size-4" /> {message}</p>}</div>}
      {sheet.students.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-14 text-center"><Award className="size-8 text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-600">No active students in this batch</p></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="bg-slate-50 text-[10px] tracking-wider text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2.5">Student</th>
                {DIMENSIONS.map(([k, label]) => <th key={k} className="px-2 py-2.5">{label}</th>)}
                <th className="px-2 py-2.5">Notes</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sheet.students.map((s) => {
                const d = drafts[s.student.id]
                const saved = savedOf.get(s.student.id) ?? null
                const status = saved && same(d, saved) ? 'Saved' : 'Pending'
                return (
                  <tr key={s.student.id} className="align-middle">
                    <td className="px-4 py-2.5"><p className="font-semibold text-slate-800">{s.student.fullName}</p><p className="text-[11px] text-slate-500">Roll {s.student.rollNumber ?? '—'}</p></td>
                    {DIMENSIONS.map(([k, label]) => (
                      <td key={k} className="px-2 py-2.5">
                        <select aria-label={`${label} for ${s.student.fullName}`} value={d[k] ?? ''} onChange={(e) => set(s.student.id, { [k]: e.target.value ? Number(e.target.value) : null })} className={`h-9 w-full min-w-[128px] rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 focus:outline-none ${d[k] ? LEVEL_STYLE[d[k]! - 1] : 'text-slate-400'}`}>
                          <option value="">Select</option>
                          {RATING_LABELS.map((l, i) => <option key={l} value={i + 1}>{l}</option>)}
                        </select>
                      </td>
                    ))}
                    <td className="px-2 py-2.5"><input aria-label={`Notes for ${s.student.fullName}`} value={d.notes} maxLength={500} onChange={(e) => set(s.student.id, { notes: e.target.value })} placeholder="Optional" className="h-9 w-full min-w-[160px] rounded-lg border border-slate-200 px-2.5 text-xs focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 focus:outline-none" /></td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase ${status === 'Saved' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{status === 'Saved' ? <Check className="size-3" /> : <CircleDot className="size-3" />}{status}</span>
                        {saved && <button type="button" onClick={() => setClearing(s)} aria-label={`Clear rating for ${s.student.fullName}`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600"><Trash2 className="size-3.5" /></button>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {clearing && (
        <ConfirmDialog
          title="Clear this rating?"
          message={<p>Your rating of {clearing.student.fullName} for this day is removed.</p>}
          confirmLabel="Clear rating"
          onConfirm={async () => {
            await api(`${PATH}/${clearing.student.id}?date=${sheet.date}`, { method: 'DELETE' })
            setDrafts((ds) => ({ ...ds, [clearing.student.id]: draftOf(null) }))
            await client.invalidateQueries({ queryKey: [PATH, 'sheet', sheet.date, batchId] })
          }}
          onClose={() => setClearing(null)}
        />
      )}
    </section>
  )
}
