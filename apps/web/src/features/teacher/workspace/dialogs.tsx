import { useState, type FormEvent, type ReactNode } from 'react'
import { BookOpen, ClipboardList } from 'lucide-react'
import { api } from '@/lib/api'
import { todayIst } from '@/lib/dates'
import { Dialog } from '@/components/ui/Dialog'
import { FileField, type AttachedFile } from '@/components/ui/FileField'
import { ErrorBanner } from '@/components/ui/form'
import {
  ASSIGNMENT_TYPE_LABELS,
  MATERIAL_TYPE_LABELS,
  useWorkspaceChapters,
  useWorkspaceOptions,
  type Assignment,
  type AssignmentType,
  type Material,
  type MaterialType,
} from '@/features/workspace/api'

const label = 'mb-1.5 block text-[11px] font-bold tracking-wide text-slate-500 uppercase'
const field =
  'h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100 focus:outline-none'
const area = `${field.replace('h-11 ', '')} resize-y py-2.5`

function F({ id, text, children, className }: { id: string; text: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={id} className={label}>{text}</label>
      {children}
    </div>
  )
}

function Footer({ busy, submitLabel, onCancel, tone }: { busy: boolean; submitLabel: string; onCancel: () => void; tone: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 pt-2">
      <button type="button" onClick={onCancel} className="h-12 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
      <button type="submit" disabled={busy} className={`h-12 rounded-xl text-sm font-semibold text-white shadow-sm disabled:opacity-60 ${tone}`}>
        {busy ? 'Saving…' : submitLabel}
      </button>
    </div>
  )
}

type Batch = { id: string; name: string }

/** Upload Study Material (PRD 5.9). */
export function MaterialDialog({ schoolId, batches, material, defaultBatchId, onSaved, onClose }: { schoolId: string; batches: Batch[]; material?: Material; defaultBatchId: string; onSaved: () => Promise<unknown>; onClose: () => void }) {
  const { data: options } = useWorkspaceOptions()
  const [v, setV] = useState({
    title: material?.title ?? '',
    description: material?.description ?? '',
    provider: material?.provider ?? '',
    chapter: material?.chapter ?? '',
    batchId: material?.batch.id ?? defaultBatchId,
    subject: material?.subject ?? 'Mathematics',
    type: (material?.type ?? 'PDF') as MaterialType,
    isPublic: material?.isPublic ?? true,
  })
  const [file, setFile] = useState<AttachedFile | null>(material ? { id: material.fileId, name: material.file.name, size: material.file.size, url: material.file.url } : null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const set = (key: keyof typeof v, value: string | boolean) => {
    setV((prev) => ({ ...prev, [key]: value }))
    setError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!v.title.trim()) return setError('Title is required')
    if (!v.provider.trim()) return setError('Provider is required')
    if (!v.batchId) return setError('Select a batch')
    if (!file) return setError('Upload the study material file')
    setBusy(true)
    try {
      const body = JSON.stringify({ ...v, fileId: file.id })
      await (material
        ? api(`/teacher/workspace/materials/${material.id}`, { method: 'PATCH', body })
        : api('/teacher/workspace/materials', { method: 'POST', body }))
      await onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
      setBusy(false)
    }
  }

  return (
    <Dialog title={material ? 'Edit Study Material' : 'Upload Study Material'} onClose={onClose} widthClass="max-w-xl">
      <form onSubmit={submit} noValidate className="space-y-4 px-6 py-5">
        <p className="-mt-1 flex items-center gap-2 text-xs text-slate-500"><BookOpen className="size-4 text-emerald-600" /> Shared with your batch; untick "public" to keep it to yourself.</p>
        <F id="m-title" text="Title *"><input id="m-title" value={v.title} maxLength={150} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Definite Integrals Notes" className={field} /></F>
        <F id="m-desc" text="Description"><textarea id="m-desc" rows={2} value={v.description} maxLength={2000} onChange={(e) => set('description', e.target.value)} placeholder="e.g. Formulas, proofs, and practice problems for calculus..." className={area} /></F>
        <div className="grid gap-4 sm:grid-cols-2">
          <F id="m-provider" text="Provider *"><input id="m-provider" value={v.provider} maxLength={120} onChange={(e) => set('provider', e.target.value)} placeholder="e.g. Faculty Study Team / Allen" className={field} /></F>
          <F id="m-chapter" text="Chapter / Topic"><input id="m-chapter" value={v.chapter} maxLength={150} onChange={(e) => set('chapter', e.target.value)} placeholder="e.g. Chapter 5: Integrals" className={field} /></F>
          <F id="m-batch" text="Batch *">
            <select id="m-batch" value={v.batchId} onChange={(e) => set('batchId', e.target.value)} className={field}>
              <option value="">{batches.length ? 'Select a batch' : 'No batches assigned to you'}</option>
              {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </F>
          <F id="m-subject" text="Subject *">
            <select id="m-subject" value={v.subject} onChange={(e) => set('subject', e.target.value)} className={field}>
              {options?.subjects.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </F>
          <F id="m-type" text="Material Type *">
            <select id="m-type" value={v.type} onChange={(e) => set('type', e.target.value)} className={field}>
              {(Object.keys(MATERIAL_TYPE_LABELS) as MaterialType[]).map((t) => <option key={t} value={t}>{MATERIAL_TYPE_LABELS[t]}</option>)}
            </select>
          </F>
          <label className="flex items-center gap-2 self-end pb-3 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={v.isPublic} onChange={(e) => set('isPublic', e.target.checked)} className="size-4 accent-indigo-600" /> Is Public / Visible to all
          </label>
        </div>
        <div>
          <p className={label}>Upload File *</p>
          <FileField schoolId={schoolId} purpose="STUDY_MATERIAL" value={file} onChange={setFile} onError={setError} onBusy={setUploading} title="Select Study Material Document" hint="Supports PDF, DOCX, ZIP, MP4 (Max 50MB)" />
        </div>
        <ErrorBanner message={error} />
        <Footer busy={busy || uploading} submitLabel={material ? 'Save Changes' : 'Upload Resource'} onCancel={onClose} tone="bg-emerald-600 hover:bg-emerald-700" />
      </form>
    </Dialog>
  )
}

/** New Assignment / DPP (PRD 5.9). */
export function AssignmentDialog({ schoolId, batches, assignment, defaultBatchId, onSaved, onClose }: { schoolId: string; batches: Batch[]; assignment?: Assignment; defaultBatchId: string; onSaved: () => Promise<unknown>; onClose: () => void }) {
  const { data: options } = useWorkspaceOptions()
  const { data: curriculum } = useWorkspaceChapters()
  const [v, setV] = useState({
    title: assignment?.title ?? '',
    description: assignment?.description ?? '',
    chapter: assignment?.chapter ?? '',
    chapterId: assignment?.chapterId ?? '',
    topic: assignment?.topic ?? '',
    batchId: assignment?.batch.id ?? defaultBatchId,
    subject: assignment?.subject ?? 'Mathematics',
    type: (assignment?.type ?? 'HOMEWORK') as AssignmentType,
    dueDate: assignment?.dueDate ?? '',
    dueTime: assignment?.dueTime ?? '23:59',
    totalMarks: String(assignment?.totalMarks ?? 100),
  })
  const [file, setFile] = useState<AttachedFile | null>(
    assignment?.questionFile && assignment.questionFileId ? { id: assignment.questionFileId, name: assignment.questionFile.name, size: assignment.questionFile.size, url: assignment.questionFile.url } : null,
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const set = (key: keyof typeof v, value: string) => {
    setV((prev) => ({ ...prev, [key]: value }))
    setError(null)
  }
  // Chapters of the assignment's subject; the picked chapter's concepts are suggested first as topics.
  const chapters = (curriculum ?? []).filter((c) => c.subject === v.subject)
  const concepts = [...new Set([...(chapters.find((c) => c.id === v.chapterId)?.concepts ?? []), ...chapters.flatMap((c) => c.concepts)])]

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!v.title.trim()) return setError('Title is required')
    if (!v.chapter.trim()) return setError('Chapter / topic is required')
    if (!v.batchId) return setError('Select a batch')
    if (!v.dueDate) return setError('Due date is required')
    if (!assignment && v.dueDate < todayIst()) return setError('The due date has already passed')
    const marks = Number(v.totalMarks)
    if (!Number.isInteger(marks) || marks < 1 || marks > 1000) return setError('Total marks must be a whole number from 1 to 1,000')
    setBusy(true)
    try {
      const body = JSON.stringify({ ...v, chapterId: v.chapterId || null, topic: v.topic.trim() || null, dueTime: v.dueTime || '23:59', totalMarks: marks, questionFileId: file?.id ?? null })
      await (assignment
        ? api(`/teacher/workspace/assignments/${assignment.id}`, { method: 'PATCH', body })
        : api('/teacher/workspace/assignments', { method: 'POST', body }))
      await onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
      setBusy(false)
    }
  }

  return (
    <Dialog title={assignment ? 'Edit Assignment' : 'New Assignment / DPP'} onClose={onClose} widthClass="max-w-xl">
      <form onSubmit={submit} noValidate className="space-y-4 px-6 py-5">
        <p className="-mt-1 flex items-center gap-2 text-xs text-slate-500"><ClipboardList className="size-4 text-slate-500" /> Due date and time are in Indian time.</p>
        <F id="a-title" text="Title *"><input id="a-title" value={v.title} maxLength={150} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Electromagnetism Practice Set" className={field} /></F>
        <F id="a-desc" text="Description"><textarea id="a-desc" rows={2} value={v.description} maxLength={4000} onChange={(e) => set('description', e.target.value)} placeholder="Enter description, instructions or guidelines for students..." className={area} /></F>
        <div className="grid gap-4 sm:grid-cols-2">
          <F id="a-curriculum" text="Curriculum Chapter">
            <select
              id="a-curriculum"
              value={v.chapterId}
              onChange={(e) => {
                const picked = chapters.find((c) => c.id === e.target.value)
                setV((prev) => ({ ...prev, chapterId: e.target.value, chapter: picked ? picked.name : prev.chapterId ? '' : prev.chapter }))
                setError(null)
              }}
              disabled={!chapters.length}
              className={field}
            >
              <option value="">{chapters.length ? 'Not linked (optional)' : `No ${v.subject} chapters in the curriculum`}</option>
              {chapters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </F>
          <F id="a-topic" text="Concept / Topic">
            <input id="a-topic" list="a-topic-concepts" value={v.topic} maxLength={120} onChange={(e) => set('topic', e.target.value)} placeholder="e.g. Gauss's Law applications" className={field} />
            <datalist id="a-topic-concepts">{concepts.map((c) => <option key={c} value={c} />)}</datalist>
          </F>
          <F id="a-chapter" text="Chapter / Topic *" className="sm:col-span-2"><input id="a-chapter" value={v.chapter} maxLength={150} onChange={(e) => set('chapter', e.target.value)} readOnly={!!v.chapterId} placeholder="e.g. Chapter 4: Gauss's Law" className={`${field} ${v.chapterId ? 'text-slate-500' : ''}`} /></F>
          <F id="a-batch" text="Batch *">
            <select id="a-batch" value={v.batchId} onChange={(e) => set('batchId', e.target.value)} className={field}>
              <option value="">{batches.length ? 'Select a batch' : 'No batches assigned to you'}</option>
              {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </F>
          <F id="a-subject" text="Subject *">
            <select id="a-subject" value={v.subject} onChange={(e) => setV((prev) => ({ ...prev, subject: e.target.value, ...(prev.chapterId ? { chapterId: '', chapter: '' } : {}) }))} className={field}>
              {options?.subjects.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </F>
          <F id="a-type" text="Assignment Type *">
            <select id="a-type" value={v.type} onChange={(e) => set('type', e.target.value)} className={field}>
              {(Object.keys(ASSIGNMENT_TYPE_LABELS) as AssignmentType[]).map((t) => <option key={t} value={t}>{ASSIGNMENT_TYPE_LABELS[t]}</option>)}
            </select>
          </F>
          <F id="a-date" text="Due Date *"><input id="a-date" type="date" value={v.dueDate} onChange={(e) => set('dueDate', e.target.value)} className={field} /></F>
          <F id="a-time" text="Due Time"><input id="a-time" type="time" value={v.dueTime} onChange={(e) => set('dueTime', e.target.value)} className={field} /></F>
        </div>
        <F id="a-marks" text="Total Marks *"><input id="a-marks" inputMode="numeric" value={v.totalMarks} onChange={(e) => set('totalMarks', e.target.value)} className={field} /></F>
        <div>
          <p className={label}>Upload Question Sheet (Optional)</p>
          <FileField schoolId={schoolId} purpose="ASSIGNMENT_SHEET" value={file} onChange={setFile} onError={setError} onBusy={setUploading} title="Choose PDF, DOCX, or Image" hint="" compact />
        </div>
        <ErrorBanner message={error} />
        <Footer busy={busy || uploading} submitLabel={assignment ? 'Save Changes' : 'Create Assignment'} onCancel={onClose} tone="bg-ink hover:bg-ink-hover" />
      </form>
    </Dialog>
  )
}
