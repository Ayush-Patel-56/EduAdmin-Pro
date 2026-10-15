import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { api } from '@/lib/api'
import { Dialog } from '@/components/ui/Dialog'
import { ConfirmDialog, ErrorBanner, Field } from '@/components/ui/form'
import { btnPrimary, btnSecondary, inputClass } from '@/components/ui/formStyles'
import { useAcademicOptions, useInvalidateAcademic, type Batch, type Faculty } from '@/features/academic/api'
import { ALL } from '@/features/academic/filters'
import { formatDate } from '@/features/portal/format'
import { useAdminContext } from '../adminContext'
import { deleteBlockers } from './batchDelete'
import { THEME_STYLES } from './theme'

type Modal = { kind: 'form'; batch?: Batch } | { kind: 'delete'; batch: Batch } | null

export function BatchesTab() {
  const { schoolId, structure, filters } = useAdminContext()
  const source = { kind: 'admin', schoolId } as const
  const invalidate = useInvalidateAcademic()
  const { data: batches, error, isPending } = useQuery({
    queryKey: [schoolId, 'batches'],
    queryFn: () => api<Batch[]>(`/schools/${schoolId}/batches`),
  })
  const [modal, setModal] = useState<Modal>(null)
  const programs = structure?.programs ?? []
  const noPrograms = structure && programs.length === 0
  const programFilter = filters.programId !== ALL ? programs.find((p) => p.id === filters.programId) : undefined
  const shown = programFilter ? batches?.filter((b) => b.program.id === programFilter.id) : batches

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">Student groups per year. Each batch belongs to one program.</p>
        <button
          type="button"
          onClick={() => setModal({ kind: 'form' })}
          disabled={noPrograms}
          title={noPrograms ? 'Create a program first' : undefined}
          className={btnPrimary}
        >
          <Plus className="size-4" /> Create Batch
        </button>
      </div>

      {noPrograms && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No programs yet. Batches are created under a program, so add one in the Programs tab first.
        </p>
      )}
      {programFilter && (
        <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-fuchsia-50 px-3 py-1 text-xs text-fuchsia-800">
          Showing batches in <strong>{programFilter.name}</strong>
          <button type="button" onClick={() => filters.setProgramId(ALL)} aria-label="Show all programs" className="rounded-full p-0.5 hover:bg-fuchsia-100">
            <X className="size-3" />
          </button>
        </p>
      )}

      <div className="mt-4">
        <ErrorBanner message={error?.message} />
        {isPending && <Loader2 className="mx-auto size-6 animate-spin text-slate-300" aria-label="Loading" />}
        {shown && (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                <tr>
                  <th className="px-5 py-3">Batch</th>
                  <th className="px-5 py-3">Program</th>
                  <th className="px-5 py-3">Class</th>
                  <th className="px-5 py-3">Capacity</th>
                  <th className="px-5 py-3">Duration</th>
                  <th className="px-5 py-3">Coordinator</th>
                  <th className="px-5 py-3">Faculty</th>
                  <th className="px-5 py-3">Chapters</th>
                  <th className="px-5 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-5 py-12 text-center text-sm text-slate-400">
                      No batches yet{programFilter ? ` in ${programFilter.name}` : ''}.
                    </td>
                  </tr>
                )}
                {shown.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50/60">
                    <td className="px-5 py-3 font-semibold text-slate-900">{b.name}</td>
                    <td className="px-5 py-3">
                      <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${THEME_STYLES[b.program.themeColor].chip}`}>
                        {b.program.name}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-700">{b.classLevel ? `Class ${b.classLevel}` : '—'}</td>
                    <td className="px-5 py-3 text-slate-700">{b.capacity}</td>
                    <td className="px-5 py-3 text-xs text-slate-600">
                      {formatDate(b.startDate)} – {b.endDate ? formatDate(b.endDate) : 'ongoing'}
                    </td>
                    <td className="px-5 py-3 text-slate-700">{b.coordinator?.name ?? '—'}</td>
                    <td className="px-5 py-3 text-slate-700">{b.facultyCount}</td>
                    <td className="px-5 py-3 text-slate-700">{b.chapterCount}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        <button type="button" onClick={() => setModal({ kind: 'form', batch: b })} aria-label={`Edit ${b.name}`} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                          <Pencil className="size-4" />
                        </button>
                        <button type="button" onClick={() => setModal({ kind: 'delete', batch: b })} aria-label={`Delete ${b.name}`} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal?.kind === 'form' && (
        <BatchDialog
          schoolId={schoolId}
          batch={modal.batch}
          programs={programs}
          defaultProgramId={programFilter?.id}
          onSaved={() => invalidate(source)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'delete' && (
        <ConfirmDialog
          title="Delete batch?"
          message={
            <>
              <strong className="text-slate-900">{modal.batch.name}</strong> will be deleted with its{' '}
              {deletedWith(modal.batch)}, and its teachers unassigned.
              {modal.batch.studentCount > 0 &&
                ` Its ${plural(modal.batch.studentCount, 'student')} stay in the program, unassigned, and keep this batch in their history.`}{' '}
              {deleteBlockers(modal.batch)}
              This can’t be undone.
            </>
          }
          confirmLabel="Delete Batch"
          onConfirm={async () => {
            await api(`/schools/${schoolId}/batches/${modal.batch.id}`, { method: 'DELETE' })
            await invalidate(source)
          }}
          onClose={() => setModal(null)}
        />
      )}
    </>
  )
}

type BatchDialogProps = {
  schoolId: string
  batch?: Batch
  programs: { id: string; name: string; isActive: boolean }[]
  defaultProgramId?: string
  onSaved: () => Promise<unknown>
  onClose: () => void
}

function BatchDialog({ schoolId, batch, programs, defaultProgramId, onSaved, onClose }: BatchDialogProps) {
  const { data: options } = useAcademicOptions()
  const { data: faculty } = useQuery({
    queryKey: [schoolId, 'faculty'],
    queryFn: () => api<Faculty[]>(`/schools/${schoolId}/faculty`),
  })
  const [values, setValues] = useState({
    name: batch?.name ?? '',
    classLevel: batch?.classLevel?.toString() ?? '',
    capacity: String(batch?.capacity ?? 60),
    startDate: batch?.startDate ?? '',
    endDate: batch?.endDate ?? '',
    programId: batch?.program.id ?? defaultProgramId ?? (programs.length === 1 ? programs[0].id : ''),
    coordinatorId: batch?.coordinator?.id ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof values>(key: K, value: string) => {
    setValues((v) => ({ ...v, [key]: value }))
    setError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!values.name.trim()) return setError('Batch name is required')
    if (!values.programId) return setError('Select the program this batch belongs to')
    if (!values.startDate) return setError('Start date is required')
    if (values.endDate && values.endDate < values.startDate) return setError('End date must be on or after the start date')
    setBusy(true)
    try {
      await api(batch ? `/schools/${schoolId}/batches/${batch.id}` : `/schools/${schoolId}/batches`, {
        method: batch ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...values,
          classLevel: values.classLevel ? Number(values.classLevel) : null,
          capacity: Number(values.capacity) || 60,
          endDate: values.endDate || null,
          coordinatorId: values.coordinatorId || null,
        }),
      })
      await onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the batch')
      setBusy(false)
    }
  }

  const activeFaculty = faculty?.filter((f) => f.status === 'ACTIVE' || f.id === values.coordinatorId) ?? []

  return (
    <Dialog title={batch ? 'Edit Batch' : 'Create New Batch'} onClose={onClose} widthClass="max-w-lg">
      <form onSubmit={submit} noValidate>
        <div className="space-y-4 px-6 py-5">
          <Field id="batch-program" label="Program *" hint={programs.length === 0 ? 'No programs yet — create one in the Programs tab first.' : 'Batches are always created under a program.'}>
            <select id="batch-program" value={values.programId} onChange={(e) => set('programId', e.target.value)} className={inputClass()}>
              <option value="">Select program…</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.isActive ? '' : ' (inactive)'}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="batch-name" label="Batch name *">
              <input id="batch-name" value={values.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Batch A / Grade 11-A" maxLength={60} autoFocus className={inputClass()} />
            </Field>
            <Field id="batch-class" label="Class level">
              <select id="batch-class" value={values.classLevel} onChange={(e) => set('classLevel', e.target.value)} className={inputClass()}>
                <option value="">Select…</option>
                {(options?.classLevels ?? [6, 7, 8, 9, 10, 11, 12]).map((c) => (
                  <option key={c} value={c}>Class {c}</option>
                ))}
              </select>
            </Field>
            <Field id="batch-capacity" label="Capacity">
              <input id="batch-capacity" type="number" min={1} max={1000} value={values.capacity} onChange={(e) => set('capacity', e.target.value)} className={inputClass()} />
            </Field>
            <Field id="batch-start" label="Start date *">
              <input id="batch-start" type="date" value={values.startDate} onChange={(e) => set('startDate', e.target.value)} className={inputClass()} />
            </Field>
            <Field id="batch-end" label="End date">
              <input id="batch-end" type="date" min={values.startDate || undefined} value={values.endDate} onChange={(e) => set('endDate', e.target.value)} className={inputClass()} />
            </Field>
          </div>
          <Field id="batch-coordinator" label="Coordinator (faculty)" hint="Assigning a coordinator also adds this batch to the teacher’s own assignments.">
            <select id="batch-coordinator" value={values.coordinatorId} onChange={(e) => set('coordinatorId', e.target.value)} className={inputClass()}>
              <option value="">Unassigned</option>
              {activeFaculty.map((f) => (
                <option key={f.id} value={f.id}>{f.name}{f.subjects[0] ? ` — ${f.subjects[0]}` : ''}</option>
              ))}
            </select>
          </Field>
          <ErrorBanner message={error} />
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button type="submit" disabled={busy || programs.length === 0} className={btnPrimary}>
            {busy ? 'Saving…' : batch ? 'Save Changes' : 'Create Batch'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** What goes with a deleted batch, e.g. "3 syllabus chapters, 2 study materials and 1 assignment". */
function deletedWith(b: Batch) {
  const parts = [
    plural(b.chapterCount, 'syllabus chapter'),
    ...(b.materialCount > 0 ? [plural(b.materialCount, 'study material')] : []),
    ...(b.assignmentCount > 0 ? [plural(b.assignmentCount, 'assignment')] : []),
    ...(b.eventCount > 0 ? [plural(b.eventCount, 'calendar event')] : []),
  ]
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}
