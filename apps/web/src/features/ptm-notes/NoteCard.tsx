import { Fragment, useState, type ReactNode } from 'react'
import { CircleCheck, CircleX, Loader2, Pencil, Printer, Trash2 } from 'lucide-react'
import { ErrorBanner } from '@/components/ui/form'
import { shortDay, type PtmNote } from './api'
import { printPtmReport } from './ptmReport'

type NoteCardProps = {
  note: PtmNote
  /** The note being edited in the form beside the list. */
  editing?: boolean
  /** The teacher who logged it may edit and delete it; admins only read and print. */
  canChange?: boolean
  /** Admins' list: who logged the note. */
  showTeacher?: boolean
  onEdit?: () => void
  onDelete?: () => void
}

/** One parent meeting: the student, attendance, notes and action items, with Print. */
export function NoteCard({ note: n, editing = false, canChange = false, showTeacher = false, onEdit, onDelete }: NoteCardProps) {
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
        {(n.parentName || n.followUpDate || showTeacher) && (
          <p className="text-[11px] text-slate-500">
            {[
              showTeacher && <>Logged by <span className="font-semibold text-slate-700">{n.teacherName}</span></>,
              n.parentName && <>Parent: <span className="font-semibold text-slate-700">{n.parentName}</span></>,
              n.followUpDate && <>Follow-up: <span className="font-semibold text-slate-700">{shortDay(n.followUpDate)}</span></>,
            ]
              .filter(Boolean)
              .map((part, i) => (
                <Fragment key={i}>
                  {i > 0 && ' · '}
                  {part}
                </Fragment>
              ))}
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
