import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Layers, Loader2, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { api } from '@/lib/api'
import { Dialog } from '@/components/ui/Dialog'
import { ProgramPicker } from '@/components/ui/ProgramPicker'
import { ConfirmDialog, ErrorBanner, Field } from '@/components/ui/form'
import { btnPrimary, inputClass } from '@/components/ui/formStyles'
import {
  PROGRAM_TYPE_LABELS,
  THEME_LABELS,
  useAcademicOptions,
  useInvalidateAcademic,
  type Program,
  type ProgramType,
  type ThemeColor,
} from '@/features/academic/api'
import { useAdminContext } from '../adminContext'
import { THEME_STYLES } from './theme'

type Modal = { kind: 'form'; program?: Program } | { kind: 'delete'; program: Program } | null

export function ProgramsTab() {
  const { schoolId } = useAdminContext()
  const source = { kind: 'admin', schoolId } as const
  const invalidate = useInvalidateAcademic()
  const { data: programs, error, isPending } = useQuery({
    queryKey: [schoolId, 'programs'],
    queryFn: () => api<Program[]>(`/schools/${schoolId}/programs`),
  })
  const [modal, setModal] = useState<Modal>(null)

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">Programs offered by this school. Every batch is created under a program.</p>
        <button type="button" onClick={() => setModal({ kind: 'form' })} className={btnPrimary}>
          <Plus className="size-4" /> Add Program
        </button>
      </div>

      <div className="mt-6">
        <ErrorBanner message={error?.message} />
        {isPending && <Loader2 className="mx-auto size-6 animate-spin text-slate-300" aria-label="Loading" />}
        {programs?.length === 0 && (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-14 text-center">
            <p className="text-sm font-semibold text-slate-700">No programs yet</p>
            <p className="mt-1 text-xs text-slate-500">Create a program (e.g. JEE 2-Year) before adding batches.</p>
          </div>
        )}
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {programs?.map((p) => (
            <article key={p.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className={`h-1.5 ${THEME_STYLES[p.themeColor].bar}`} />
              <div className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-bold text-slate-900">{p.name}</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {p.code ? <span className="font-mono">{p.code}</span> : 'No code'}
                      {p.durationYears ? ` · ${p.durationYears} year${p.durationYears === 1 ? '' : 's'}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${THEME_STYLES[p.themeColor].chip}`}>
                      {PROGRAM_TYPE_LABELS[p.type]}
                    </span>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                        p.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {p.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
                <div className="mt-3 flex min-h-6 flex-wrap gap-1.5">
                  {p.targetExams.length === 0 && <span className="text-xs text-slate-400">No target exams</span>}
                  {p.targetExams.map((e) => (
                    <span key={e} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
                      {e}
                    </span>
                  ))}
                </div>
                <p className="mt-4 flex gap-4 text-xs text-slate-600">
                  <span className="inline-flex items-center gap-1">
                    <Layers className="size-3.5 text-slate-400" /> {p.batchCount} batch{p.batchCount === 1 ? '' : 'es'}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Users className="size-3.5 text-slate-400" /> {p.facultyCount} faculty
                  </span>
                </p>
                <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3">
                  <button type="button" onClick={() => setModal({ kind: 'form', program: p })} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                    <Pencil className="size-3.5" /> Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setModal({ kind: 'delete', program: p })}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="size-3.5" /> Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>

      {modal?.kind === 'form' && (
        <ProgramDialog
          schoolId={schoolId}
          program={modal.program}
          onSaved={() => invalidate(source)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'delete' && (
        <ConfirmDialog
          title="Delete program?"
          message={
            modal.program.batchCount > 0 ? (
              <>
                <strong className="text-slate-900">{modal.program.name}</strong> has {modal.program.batchCount} batch
                {modal.program.batchCount === 1 ? '' : 'es'}. Batches depend on their program, so delete or move them first.
              </>
            ) : (
              <>
                <strong className="text-slate-900">{modal.program.name}</strong> will be removed from this school
                {modal.program.eventCount > 0 &&
                  `, with its ${modal.program.eventCount} calendar event${modal.program.eventCount === 1 ? '' : 's'}`}
                .
              </>
            )
          }
          confirmLabel="Delete Program"
          onConfirm={async () => {
            await api(`/schools/${schoolId}/programs/${modal.program.id}`, { method: 'DELETE' })
            await invalidate(source)
          }}
          onClose={() => setModal(null)}
        />
      )}
    </>
  )
}

type ProgramDialogProps = { schoolId: string; program?: Program; onSaved: () => Promise<unknown>; onClose: () => void }

function ProgramDialog({ schoolId, program, onSaved, onClose }: ProgramDialogProps) {
  const { data: options } = useAcademicOptions()
  const [values, setValues] = useState({
    name: program?.name ?? '',
    code: program?.code ?? '',
    type: program?.type ?? ('FOUNDATIONAL' as ProgramType),
    targetExams: program?.targetExams ?? [],
    durationYears: program?.durationYears?.toString() ?? '',
    themeColor: program?.themeColor ?? ('BLUE' as ThemeColor),
    isActive: program?.isActive ?? true,
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!values.name.trim()) return setError('Display name is required')
    setBusy(true)
    try {
      await api(program ? `/schools/${schoolId}/programs/${program.id}` : `/schools/${schoolId}/programs`, {
        method: program ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...values, durationYears: values.durationYears ? Number(values.durationYears) : null }),
      })
      await onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the program')
      setBusy(false)
    }
  }

  return (
    <Dialog title={program ? 'Edit Program' : 'Add New Program'} onClose={onClose} widthClass="max-w-md">
      <form onSubmit={submit} noValidate className="space-y-4 px-6 py-5">
        <Field id="program-name" label="Display name *">
          <input id="program-name" value={values.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. JEE 2-Year Integrated" maxLength={60} autoFocus className={inputClass()} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="program-code" label="Code">
            <input id="program-code" value={values.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="e.g. JEE-2Y" maxLength={20} className={`${inputClass()} font-mono`} />
          </Field>
          <Field id="program-type" label="Type">
            <select id="program-type" value={values.type} onChange={(e) => set('type', e.target.value as ProgramType)} className={inputClass()}>
              {(options?.programTypes ?? ['JEE', 'NEET', 'FOUNDATIONAL', 'OTHER']).map((t) => (
                <option key={t} value={t}>{PROGRAM_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field id="program-exams" label="Target exam">
          <ProgramPicker
            id="program-exams"
            standard={options?.targetExams ?? []}
            value={values.targetExams}
            onChange={(v) => set('targetExams', v)}
            placeholder="Select target exam(s)…"
            standardHeading="Exams"
            customPlaceholder="Add custom exam..."
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="program-duration" label="Duration (years)">
            <input id="program-duration" type="number" min={1} max={10} value={values.durationYears} onChange={(e) => set('durationYears', e.target.value)} placeholder="e.g. 2" className={inputClass()} />
          </Field>
          <Field id="program-theme" label="Theme color">
            <select id="program-theme" value={values.themeColor} onChange={(e) => set('themeColor', e.target.value as ThemeColor)} className={inputClass()}>
              {(options?.themeColors ?? ['BLUE', 'GREEN', 'PURPLE']).map((c) => (
                <option key={c} value={c}>{THEME_LABELS[c]}</option>
              ))}
            </select>
          </Field>
        </div>
        <label className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800">
          <input type="checkbox" checked={values.isActive} onChange={(e) => set('isActive', e.target.checked)} className="size-4 accent-indigo-600" />
          Program is active
        </label>
        <ErrorBanner message={error} />
        <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
          {program ? 'Save Changes' : (<><Plus className="size-4" /> Create Program</>)}
        </button>
      </form>
    </Dialog>
  )
}
