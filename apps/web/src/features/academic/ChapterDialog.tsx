import { useState, type FormEvent } from 'react'
import { api } from '@/lib/api'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner, Field } from '@/components/ui/form'
import { btnSecondary, inputClass, textareaClass } from '@/components/ui/formStyles'
import { basePath, STATUS_LABELS, useAcademicOptions, type AcademicSource, type Structure, type SyllabusItem, type SyllabusStatus } from './api'

type ChapterDialogProps = {
  source: AcademicSource
  structure: Structure | undefined
  schoolName: string
  /** Editing this chapter; otherwise adding a new one. */
  item?: SyllabusItem
  defaults: { batchId: string | null; subject: string }
  onSaved: () => void
  onClose: () => void
}

const STATUSES: SyllabusStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED']
const smallLabel = 'mb-1 block text-[10px] font-semibold tracking-wider text-slate-500 uppercase'

export function ChapterDialog({ source, structure, schoolName, item, defaults, onSaved, onClose }: ChapterDialogProps) {
  const { data: options } = useAcademicOptions()
  const batches = structure?.batches ?? []
  const programs = structure?.programs ?? []
  const initialBatchId = item?.batchId ?? defaults.batchId ?? ''
  const [programId, setProgramId] = useState(batches.find((b) => b.id === initialBatchId)?.programId ?? '')
  const [values, setValues] = useState({
    batchId: initialBatchId,
    subject: item?.subject ?? defaults.subject,
    title: item?.title ?? '',
    estimatedHours: item?.estimatedHours?.toString() ?? '',
    targetDates: item?.targetDates ?? '',
    status: item?.status ?? ('NOT_STARTED' as SyllabusStatus),
    remarks: item?.remarks ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const batchOptions = programId ? batches.filter((b) => b.programId === programId) : batches
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!values.batchId) return setError('Select a batch')
    if (!values.title.trim()) return setError('Chapter title is required')
    const hours = values.estimatedHours.match(/\d+/)?.[0]
    setSaving(true)
    try {
      await api(item ? `${basePath(source)}/syllabus/${item.id}` : `${basePath(source)}/syllabus`, {
        method: item ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...values, estimatedHours: hours ? Number(hours) : null }),
      })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the chapter')
      setSaving(false)
    }
  }

  return (
    <Dialog title={item ? 'Edit Chapter' : 'Add New Chapter'} onClose={onClose} widthClass="max-w-lg">
      <form onSubmit={submit} noValidate>
        <div className="space-y-4 px-6 py-5">
          <fieldset className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <legend className="px-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
              Target parameters (school, program, batch, subject)
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={smallLabel} htmlFor="chapter-school">School</label>
                <select id="chapter-school" disabled className={inputClass()}>
                  <option>{schoolName}</option>
                </select>
              </div>
              <div>
                <label className={smallLabel} htmlFor="chapter-program">Program</label>
                <select
                  id="chapter-program"
                  value={programId}
                  onChange={(e) => {
                    setProgramId(e.target.value)
                    if (e.target.value && batches.find((b) => b.id === values.batchId)?.programId !== e.target.value) {
                      set('batchId', '')
                    }
                  }}
                  className={inputClass()}
                >
                  <option value="">All programs</option>
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={smallLabel} htmlFor="chapter-batch">Batch *</label>
                <select
                  id="chapter-batch"
                  value={values.batchId}
                  onChange={(e) => {
                    set('batchId', e.target.value)
                    const batch = batches.find((b) => b.id === e.target.value)
                    if (batch) setProgramId(batch.programId)
                  }}
                  className={inputClass()}
                >
                  <option value="">Select…</option>
                  {batchOptions.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={smallLabel} htmlFor="chapter-subject">Subject *</label>
                <select id="chapter-subject" value={values.subject} onChange={(e) => set('subject', e.target.value)} className={inputClass()}>
                  {(options?.subjects ?? [values.subject]).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
          </fieldset>

          <Field id="chapter-title" label="Chapter title *">
            <input
              id="chapter-title"
              value={values.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="e.g. Chapter 01: Physical World"
              maxLength={200}
              autoFocus
              className={inputClass()}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="chapter-hours" label="Estimated hours">
              <input
                id="chapter-hours"
                inputMode="numeric"
                value={values.estimatedHours}
                onChange={(e) => set('estimatedHours', e.target.value)}
                placeholder="e.g. 12 hrs est."
                maxLength={20}
                className={inputClass()}
              />
            </Field>
            <Field id="chapter-dates" label="Target dates">
              <input
                id="chapter-dates"
                value={values.targetDates}
                onChange={(e) => set('targetDates', e.target.value)}
                placeholder="e.g. Oct 15 - Nov 15"
                maxLength={60}
                className={inputClass()}
              />
            </Field>
          </div>
          <Field id="chapter-status" label="Status">
            <select id="chapter-status" value={values.status} onChange={(e) => set('status', e.target.value as SyllabusStatus)} className={inputClass()}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </Field>
          <Field id="chapter-remarks" label="Teacher remarks & notes">
            <textarea
              id="chapter-remarks"
              value={values.remarks}
              onChange={(e) => set('remarks', e.target.value)}
              placeholder="e.g. Introductory concepts clear. Ready for test."
              rows={3}
              maxLength={1000}
              className={textareaClass()}
            />
          </Field>
          <ErrorBanner message={error} />
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-10 items-center rounded-lg bg-brand-600 px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {saving ? 'Saving…' : item ? 'Save Changes' : 'Create Chapter'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
