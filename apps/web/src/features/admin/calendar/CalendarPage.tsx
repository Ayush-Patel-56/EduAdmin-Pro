import { useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Construction, Filter, GraduationCap, Loader2, Pencil, Plus, Repeat, Sparkles, Trash2, Users } from 'lucide-react'
import { api } from '@/lib/api'
import { ConfirmDialog, ErrorBanner } from '@/components/ui/form'
import { ALL } from '@/features/academic/filters'
import { formatDay } from '@/features/portal/format'
import {
  SPECIAL_TYPE_LABELS,
  SPECIAL_TYPE_STYLE,
  useAdminSlots,
  useAdminSpecialClasses,
  useInvalidateSchedule,
  useScheduleFaculty,
  type Slot,
  type SpecialClass,
} from '@/features/schedule/api'
import { SlotDialog, SpecialClassDialog, type BatchOption } from '@/features/schedule/ScheduleDialogs'
import { useAdminContext } from '../adminContext'

type Tab = 'calendar' | 'schedules'

/** Calendar (PRD 4.15): Academic Calendar and Class Schedules. */
export function CalendarPage() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'calendar' ? 'calendar' : 'schedules'
  const select = (next: Tab) => setParams(next === 'schedules' ? {} : { tab: next }, { replace: true })
  return (
    <>
      <div role="tablist" aria-label="Calendar" className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1">
        {(
          [
            ['calendar', 'Academic Calendar'],
            ['schedules', 'Class Schedules'],
          ] as const
        ).map(([key, text]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => select(key)}
            className={`rounded-lg px-5 py-2 text-sm font-semibold transition ${tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {text}
          </button>
        ))}
      </div>
      {tab === 'schedules' ? <ClassSchedules /> : <AcademicCalendarSoon />}
    </>
  )
}

function AcademicCalendarSoon() {
  return (
    <div className="mt-6 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
      <Construction className="size-8 text-slate-400" />
      <p className="mt-3 text-sm font-medium text-slate-700">The academic calendar (holidays, exams, events) is coming soon</p>
      <p className="mt-1 text-xs text-slate-500">Class schedules are ready under Class Schedules.</p>
    </div>
  )
}

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

function ClassSchedules() {
  const { schoolId, structure, filters } = useAdminContext()
  const scheduleFilters = { programId: filters.programId === ALL ? '' : filters.programId, batchId: filters.batchId === ALL ? '' : filters.batchId }
  const [past, setPast] = useState(false)
  const slots = useAdminSlots(schoolId, scheduleFilters)
  const specials = useAdminSpecialClasses(schoolId, { ...scheduleFilters, past })
  const faculty = useScheduleFaculty(schoolId)
  const invalidate = useInvalidateSchedule(schoolId)
  const [dialog, setDialog] = useState<{ kind: 'slot'; slot?: Slot } | { kind: 'special'; special?: SpecialClass } | null>(null)
  const [deleting, setDeleting] = useState<{ kind: 'slot'; slot: Slot } | { kind: 'special'; special: SpecialClass } | null>(null)

  const batches: BatchOption[] = useMemo(() => {
    const programs = new Map((structure?.programs ?? []).map((p) => [p.id, p.name]))
    return (structure?.batches ?? []).map((b) => ({ id: b.id, name: b.name, program: programs.get(b.programId) ?? '' }))
  }, [structure])
  const sortedSlots = useMemo(
    () => [...(slots.data ?? [])].sort((a, b) => DAY_ORDER.indexOf(a.dayOfWeek) - DAY_ORDER.indexOf(b.dayOfWeek) || a.startTime.localeCompare(b.startTime)),
    [slots.data],
  )

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <span className="flex items-center gap-1.5 text-xs font-bold tracking-wider text-slate-500 uppercase"><Filter className="size-4" /> Filter</span>
        <label className="flex items-center gap-2">
          <GraduationCap className="size-4 text-purple-500" />
          <select aria-label="Program" value={filters.programId} onChange={(e) => filters.setProgramId(e.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800">
            <option value={ALL}>All Programs</option>
            {(structure?.programs ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <Users className="size-4 text-emerald-500" />
          <select aria-label="Batch" value={filters.batchId} onChange={(e) => filters.setBatchId(e.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800">
            <option value={ALL}>All Batches</option>
            {filters.batchOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      </div>

      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <Header icon={<Repeat className="size-5 text-emerald-500" />} title="Class Schedules" subtitle="Weekly recurring timetable across all faculty" action="Add Slot" onAction={() => setDialog({ kind: 'slot' })} />
        {slots.error ? (
          <div className="p-6"><ErrorBanner message={slots.error.message} /></div>
        ) : slots.isPending ? (
          <Spinner />
        ) : sortedSlots.length === 0 ? (
          <p className="px-6 py-8 text-sm text-slate-400 italic">No timetable slots yet.</p>
        ) : (
          <Table headers={['Day', 'Time', 'Subject', 'Batch', 'Teacher', 'Room', 'Effective', 'Status', '']}>
            {sortedSlots.map((s) => (
              <tr key={s.id} className={`border-t border-slate-100 text-sm ${s.active ? 'text-slate-700' : 'text-slate-400'}`}>
                <td className="px-5 py-3 font-semibold text-slate-900">{s.day}</td>
                <td className="px-5 py-3 whitespace-nowrap">{s.time}</td>
                <td className="px-5 py-3">{s.subject}</td>
                <td className="px-5 py-3">{s.batch.name}<span className="block text-xs text-slate-400">{s.program.name}</span></td>
                <td className="px-5 py-3">{s.faculty.name}{s.faculty.email && <span className="block text-xs text-slate-400">{s.faculty.email}</span>}</td>
                <td className="px-5 py-3">{s.room ?? '—'}</td>
                <td className="px-5 py-3 text-xs whitespace-nowrap">{formatDay(s.effectiveFrom)} – {s.effectiveTo ? formatDay(s.effectiveTo) : 'ongoing'}</td>
                <td className="px-5 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{s.active ? 'Active' : 'Inactive'}</span>
                </td>
                <Actions label={`${s.day} ${s.subject}`} onEdit={() => setDialog({ kind: 'slot', slot: s })} onDelete={() => setDeleting({ kind: 'slot', slot: s })} />
              </tr>
            ))}
          </Table>
        )}
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <Header
          icon={<Sparkles className="size-5 text-amber-500" />}
          title="Special Classes"
          subtitle="One-off sessions scheduled by faculty (Extra, Doubt, Revision, Makeup, Orientation)"
          action="Add Special Class"
          onAction={() => setDialog({ kind: 'special' })}
          extra={
            <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
              <input type="checkbox" checked={past} onChange={(e) => setPast(e.target.checked)} className="size-3.5 accent-indigo-600" /> Past 60 days
            </label>
          }
        />
        {specials.error ? (
          <div className="p-6"><ErrorBanner message={specials.error.message} /></div>
        ) : specials.isPending ? (
          <Spinner />
        ) : (specials.data ?? []).length === 0 ? (
          <p className="px-6 py-8 text-sm text-slate-400 italic">{past ? 'No special classes in the last 60 days.' : 'No upcoming special classes.'}</p>
        ) : (
          <Table headers={['Date & Time', 'Type', 'Title / Batch', 'Teacher', 'Notes', '']}>
            {specials.data!.map((c) => (
              <tr key={c.id} className="border-t border-slate-100 text-sm text-slate-700">
                <td className="px-5 py-3 whitespace-nowrap">
                  <span className="font-semibold text-slate-900">{formatDay(c.date)}</span>
                  <span className="block text-xs text-slate-500">{c.time}{c.room ? ` • ${c.room}` : ''}</span>
                </td>
                <td className="px-5 py-3"><span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${SPECIAL_TYPE_STYLE[c.type]}`}>{SPECIAL_TYPE_LABELS[c.type]}</span></td>
                <td className="px-5 py-3">
                  <span className="font-semibold text-slate-900">{c.title}</span>
                  <span className="block text-xs text-slate-500">{[c.batch.name, c.subject].filter(Boolean).join(' • ')}</span>
                </td>
                <td className="px-5 py-3">
                  {c.faculty ? <>{c.faculty.name}{c.faculty.email && <span className="block text-xs text-slate-400">{c.faculty.email}</span>}</> : <span className="text-slate-400 italic">Not set</span>}
                </td>
                <td className="max-w-56 truncate px-5 py-3 text-xs text-slate-500" title={c.notes ?? undefined}>{c.notes ?? '—'}</td>
                <Actions label={c.title} onEdit={() => setDialog({ kind: 'special', special: c })} onDelete={() => setDeleting({ kind: 'special', special: c })} />
              </tr>
            ))}
          </Table>
        )}
      </section>

      {dialog?.kind === 'slot' && (
        <SlotDialog mode="admin" schoolId={schoolId} faculty={faculty.data ?? []} batches={batches} slot={dialog.slot} onSaved={invalidate} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'special' && (
        <SpecialClassDialog mode="admin" schoolId={schoolId} faculty={faculty.data ?? []} batches={batches} special={dialog.special} onSaved={invalidate} onClose={() => setDialog(null)} />
      )}
      {deleting && (
        <ConfirmDialog
          title={deleting.kind === 'slot' ? 'Delete slot?' : 'Delete special class?'}
          message={
            deleting.kind === 'slot'
              ? <><strong className="text-slate-900">{deleting.slot.day} {deleting.slot.time}</strong> ({deleting.slot.subject}, {deleting.slot.batch.name}) will be removed from the timetable. A slot with recorded attendance can’t be deleted; mark it inactive instead.</>
              : <><strong className="text-slate-900">{deleting.special.title}</strong> on {formatDay(deleting.special.date)} will be deleted.</>
          }
          confirmLabel="Delete"
          onConfirm={async () => {
            const path = deleting.kind === 'slot' ? `slots/${deleting.slot.id}` : `special-classes/${deleting.special.id}`
            await api(`/schools/${schoolId}/schedule/${path}`, { method: 'DELETE' })
            await invalidate()
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  )
}

function Header({ icon, title, subtitle, action, onAction, extra }: { icon: ReactNode; title: string; subtitle: string; action: string; onAction: () => void; extra?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="mt-0.5">{icon}</span>
        <div>
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        {extra}
        <button type="button" onClick={onAction} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-semibold text-white hover:bg-ink-hover">
          <Plus className="size-4" /> {action}
        </button>
      </div>
    </div>
  )
}

function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-left">
        <thead>
          <tr className="bg-slate-50/60">
            {headers.map((h, i) => <th key={`${h}-${i}`} className="px-5 py-3 text-[11px] font-bold tracking-wider text-slate-500 uppercase">{h}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function Actions({ label, onEdit, onDelete }: { label: string; onEdit: () => void; onDelete: () => void }) {
  return (
    <td className="px-5 py-3 text-right whitespace-nowrap">
      <button type="button" onClick={onEdit} aria-label={`Edit ${label}`} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="size-4" /></button>
      <button type="button" onClick={onDelete} aria-label={`Delete ${label}`} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" /></button>
    </td>
  )
}

function Spinner() {
  return (
    <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-slate-300" aria-label="Loading" /></div>
  )
}

