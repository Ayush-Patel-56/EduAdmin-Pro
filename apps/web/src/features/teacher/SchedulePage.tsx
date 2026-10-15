import { useMemo, useState } from 'react'
import { CalendarDays, Loader2, Pencil, Plus, Repeat, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { ConfirmDialog, ErrorBanner } from '@/components/ui/form'
import { useMyProfile } from '@/features/faculty/api'
import { formatDay } from '@/features/portal/format'
import {
  SPECIAL_TYPE_LABELS,
  SPECIAL_TYPE_STYLE,
  useInvalidateSchedule,
  useTeacherSchedule,
  type Slot,
  type SpecialClass,
} from '@/features/schedule/api'
import { SlotDialog, SpecialClassDialog, type BatchOption } from '@/features/schedule/ScheduleDialogs'
import { useTeacherContext } from './useTeacherDashboard'

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

/** Schedule (PRD 5.2): the teacher's weekly slots and coming special classes. */
export function SchedulePage() {
  const { structure } = useTeacherContext()
  const schedule = useTeacherSchedule()
  const profile = useMyProfile()
  const invalidate = useInvalidateSchedule()
  const [dialog, setDialog] = useState<{ kind: 'slot'; slot?: Slot } | { kind: 'special'; special?: SpecialClass } | null>(null)
  const [deleting, setDeleting] = useState<{ kind: 'slot'; slot: Slot } | { kind: 'special'; special: SpecialClass } | null>(null)

  const batches: BatchOption[] = useMemo(() => {
    const programs = new Map((structure?.programs ?? []).map((p) => [p.id, p.name]))
    return (structure?.batches ?? []).map((b) => ({ id: b.id, name: b.name, program: programs.get(b.programId) ?? '' }))
  }, [structure])
  const defaultSubject = profile.data?.primarySubject ?? 'General'
  const slots = useMemo(
    () => [...(schedule.data?.slots ?? [])].sort((a, b) => DAY_ORDER.indexOf(a.dayOfWeek) - DAY_ORDER.indexOf(b.dayOfWeek) || a.startTime.localeCompare(b.startTime)),
    [schedule.data],
  )
  const noBatches = structure && batches.length === 0

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-[26px]">Schedule</h1>
          <p className="mt-1 text-sm text-slate-500">Your weekly class timetable and special sessions</p>
        </div>
        <button
          type="button"
          onClick={() => setDialog({ kind: 'slot' })}
          disabled={!!noBatches}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
        >
          <Repeat className="size-4" /> Add Weekly Slot
        </button>
      </div>
      {noBatches && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No batches are assigned to you yet. Ask your admin to assign one before adding classes.
        </p>
      )}
      {schedule.error && <div className="mt-4"><ErrorBanner message={schedule.error.message} /></div>}

      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <h2 className="flex items-center gap-2.5 border-b border-slate-100 px-6 py-5 text-base font-bold text-slate-900">
          <Repeat className="size-5 text-slate-700" /> My Weekly Slots
        </h2>
        {schedule.isPending ? (
          <Spinner />
        ) : slots.length === 0 ? (
          <p className="px-6 py-8 text-sm text-slate-400 italic">No recurring slots yet — add your weekly timetable.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {slots.map((s) => (
              <li key={s.id} className={`flex flex-wrap items-center gap-x-6 gap-y-1 px-6 py-4 text-sm ${s.active ? '' : 'opacity-60'}`}>
                <span className="w-24 font-semibold text-slate-900">{s.day}</span>
                <span className="w-44 text-slate-700">{s.time}</span>
                <span className="min-w-40 flex-1">
                  <span className="font-semibold text-slate-900">{s.subject}</span>
                  <span className="block text-xs text-slate-500">{[s.batch.name, s.program.name, s.room].filter(Boolean).join(' • ')}</span>
                </span>
                <span className="text-xs text-slate-500">
                  {formatDay(s.effectiveFrom)} – {s.effectiveTo ? formatDay(s.effectiveTo) : 'ongoing'}
                  {!s.active && ' • inactive'}
                </span>
                <span className="ml-auto whitespace-nowrap">
                  <IconButton label={`Edit ${s.day} ${s.subject}`} onClick={() => setDialog({ kind: 'slot', slot: s })} icon={Pencil} />
                  <IconButton label={`Delete ${s.day} ${s.subject}`} onClick={() => setDeleting({ kind: 'slot', slot: s })} icon={Trash2} danger />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
          <h2 className="flex items-center gap-2.5 text-base font-bold text-slate-900">
            <CalendarDays className="size-5 text-slate-700" /> Upcoming Special Classes
          </h2>
          <button
            type="button"
            onClick={() => setDialog({ kind: 'special' })}
            disabled={!!noBatches}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-xs font-semibold text-white hover:bg-ink-hover disabled:opacity-50"
          >
            <Plus className="size-3.5" /> Schedule Class
          </button>
        </div>
        {schedule.isPending ? (
          <Spinner />
        ) : (schedule.data?.specialClasses ?? []).length === 0 ? (
          <p className="px-6 py-8 text-sm text-slate-400 italic">No upcoming special classes.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {schedule.data!.specialClasses.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-6 py-4 text-sm">
                <span className="w-32">
                  <span className="font-semibold text-slate-900">{formatDay(c.date)}</span>
                  <span className="block text-xs text-slate-500">{c.time}</span>
                </span>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${SPECIAL_TYPE_STYLE[c.type]}`}>{SPECIAL_TYPE_LABELS[c.type]}</span>
                <span className="min-w-40 flex-1">
                  <span className="font-semibold text-slate-900">{c.title}</span>
                  <span className="block text-xs text-slate-500">{[c.batch.name, c.subject, c.room].filter(Boolean).join(' • ')}</span>
                  {c.notes && <span className="block text-xs text-slate-400">{c.notes}</span>}
                </span>
                {c.mine ? (
                  <span className="ml-auto whitespace-nowrap">
                    <IconButton label={`Edit ${c.title}`} onClick={() => setDialog({ kind: 'special', special: c })} icon={Pencil} />
                    <IconButton label={`Delete ${c.title}`} onClick={() => setDeleting({ kind: 'special', special: c })} icon={Trash2} danger />
                  </span>
                ) : (
                  <span className="ml-auto text-xs text-slate-400 italic">Scheduled by admin</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {dialog?.kind === 'slot' && (
        <SlotDialog mode="teacher" defaultSubject={defaultSubject} batches={batches} slot={dialog.slot} onSaved={invalidate} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'special' && (
        <SpecialClassDialog mode="teacher" defaultSubject={defaultSubject} batches={batches} special={dialog.special} onSaved={invalidate} onClose={() => setDialog(null)} />
      )}
      {deleting && (
        <ConfirmDialog
          title={deleting.kind === 'slot' ? 'Delete slot?' : 'Delete special class?'}
          message={
            deleting.kind === 'slot'
              ? <>Your <strong className="text-slate-900">{deleting.slot.day} {deleting.slot.time}</strong> {deleting.slot.subject} slot will be removed. A slot with recorded attendance stays; set its Effective To date instead.</>
              : <><strong className="text-slate-900">{deleting.special.title}</strong> on {formatDay(deleting.special.date)} will be deleted.</>
          }
          confirmLabel="Delete"
          onConfirm={async () => {
            const path = deleting.kind === 'slot' ? `slots/${deleting.slot.id}` : `special-classes/${deleting.special.id}`
            await api(`/teacher/schedule/${path}`, { method: 'DELETE' })
            await invalidate()
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  )
}

function IconButton({ label, onClick, icon: Icon, danger }: { label: string; onClick: () => void; icon: typeof Pencil; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className={`rounded p-1.5 text-slate-400 ${danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-slate-100 hover:text-slate-700'}`}>
      <Icon className="size-4" />
    </button>
  )
}

function Spinner() {
  return <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-slate-300" aria-label="Loading" /></div>
}
