import { useState } from 'react'
import { Check, ExternalLink, GraduationCap, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { todayIst } from '@/lib/dates'
import { FileField, type AttachedFile } from '@/components/ui/FileField'
import { ErrorBanner } from '@/components/ui/form'
import { formatDate } from '@/features/portal/format'
import {
  SUBMISSION_STATUS_LABELS,
  useGradingSheet,
  useInvalidateWorkspace,
  type Assignment,
  type GradingSheet,
  type SubmissionStatus,
} from '@/features/workspace/api'

const STATUS_STYLE: Record<SubmissionStatus, string> = {
  PENDING: 'bg-slate-100 text-slate-600',
  SUBMITTED: 'bg-blue-50 text-blue-700',
  LATE: 'bg-amber-50 text-amber-700',
  GRADED: 'bg-emerald-50 text-emerald-700',
}

type Row = GradingSheet['students'][number]

/** Grading & Submissions (PRD 5.9): per student, what they handed in and their grade. Staff record it (no student portal). */
export function GradingTab({ schoolId, assignments, selectedId, onSelect }: { schoolId: string; assignments: Assignment[]; selectedId: string; onSelect: (id: string) => void }) {
  const sheet = useGradingSheet(selectedId || null)
  return (
    <>
      <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <label htmlFor="grade-assignment" className="text-[11px] font-bold tracking-[0.12em] text-slate-600 uppercase">Select Assignment:</label>
        <select id="grade-assignment" value={selectedId} onChange={(e) => onSelect(e.target.value)} className="h-9 min-w-64 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold">
          <option value="">-- Choose an Assignment --</option>
          {assignments.map((a) => <option key={a.id} value={a.id}>{a.title} · {a.batch.name} (due {formatDate(a.dueAt)})</option>)}
        </select>
      </div>
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
        {!selectedId ? (
          <div className="flex flex-col items-center px-6 py-20 text-center">
            <GraduationCap className="size-10 text-slate-300" strokeWidth={1.5} />
            <p className="mt-3 text-sm text-slate-500">Select an assignment from the dropdown above to view and grade student submissions.</p>
          </div>
        ) : sheet.isPending ? (
          <Loader2 className="mx-auto my-16 size-6 animate-spin text-slate-300" aria-label="Loading" />
        ) : sheet.error ? (
          <div className="p-4"><ErrorBanner message={sheet.error.message} /></div>
        ) : sheet.data && sheet.data.students.length === 0 ? (
          <p className="px-6 py-16 text-center text-sm text-slate-400">No active students in {sheet.data.assignment.batch} yet. Students appear here once an admin adds them to the batch.</p>
        ) : (
          sheet.data && (
            <div className="divide-y divide-slate-100">
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-xs text-slate-500">
                <span><span className="font-semibold text-slate-800">{sheet.data.assignment.title}</span> · {sheet.data.assignment.batch} · out of {sheet.data.assignment.totalMarks}</span>
                <span>{sheet.data.students.filter((s) => s.submission?.status === 'GRADED').length} of {sheet.data.students.length} graded</span>
              </div>
              {sheet.data.students.map((row) => (
                <GradeRow key={row.student.id} schoolId={schoolId} assignmentId={selectedId} totalMarks={sheet.data!.assignment.totalMarks} row={row} />
              ))}
            </div>
          )
        )}
      </div>
    </>
  )
}

function GradeRow({ schoolId, assignmentId, totalMarks, row }: { schoolId: string; assignmentId: string; totalMarks: number; row: Row }) {
  const invalidate = useInvalidateWorkspace()
  const s = row.submission
  const [status, setStatus] = useState<SubmissionStatus>(s?.status ?? 'PENDING')
  const [score, setScore] = useState(s?.score === null || s?.score === undefined ? '' : String(s.score))
  const [feedback, setFeedback] = useState(s?.feedback ?? '')
  const [submittedOn, setSubmittedOn] = useState(s?.submittedOn ?? '')
  const [file, setFile] = useState<AttachedFile | null>(s?.file && s.fileId ? { id: s.fileId, name: s.file.name, size: s.file.size, url: s.file.url } : null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [uploading, setUploading] = useState(false)

  async function save() {
    setError(null)
    setSaved(false)
    const marks = score.trim() === '' ? null : Number(score)
    if (marks !== null && (Number.isNaN(marks) || marks < 0 || marks > totalMarks)) return setError(`Score must be between 0 and ${totalMarks}`)
    if (submittedOn && submittedOn > todayIst()) return setError("Submitted on can't be in the future")
    setBusy(true)
    try {
      const result = await api<{ status: SubmissionStatus }>(`/teacher/workspace/assignments/${assignmentId}/submissions/${row.student.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: marks !== null ? 'GRADED' : status, score: marks, feedback, submittedOn, fileId: file?.id ?? null }),
      })
      setStatus(result.status)
      setSaved(true)
      await invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the grade')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3 px-5 py-4 lg:grid-cols-[200px_130px_110px_1fr_auto] lg:items-start">
      <div>
        <p className="text-sm font-semibold text-slate-900">{row.student.fullName}</p>
        <p className="text-[11px] text-slate-500">{row.student.rollNumber ? `Roll ${row.student.rollNumber}` : 'No roll number'}</p>
        <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[status]}`}>{SUBMISSION_STATUS_LABELS[status]}</span>
      </div>
      <div className="space-y-1.5">
        <select aria-label="Submission status" value={status} disabled={score.trim() !== ''} onChange={(e) => { setStatus(e.target.value as SubmissionStatus); setSaved(false) }} className="h-9 w-full rounded-lg border border-slate-200 px-2 text-xs disabled:bg-slate-50">
          {(['PENDING', 'SUBMITTED', 'LATE'] as SubmissionStatus[]).map((st) => <option key={st} value={st}>{SUBMISSION_STATUS_LABELS[st]}</option>)}
          {status === 'GRADED' && <option value="GRADED">Graded</option>}
        </select>
        <input aria-label="Submitted on" type="date" value={submittedOn} onChange={(e) => { setSubmittedOn(e.target.value); setSaved(false) }} className="h-9 w-full rounded-lg border border-slate-200 px-2 text-xs" />
      </div>
      <div>
        <div className="flex items-center gap-1">
          <input aria-label="Score" inputMode="decimal" value={score} onChange={(e) => { setScore(e.target.value); setSaved(false) }} placeholder="Score" className="h-9 w-16 rounded-lg border border-slate-200 px-2 text-sm" />
          <span className="text-xs text-slate-500">/ {totalMarks}</span>
        </div>
      </div>
      <div className="space-y-1.5">
        <textarea aria-label="Teacher feedback" rows={1} value={feedback} maxLength={2000} onChange={(e) => { setFeedback(e.target.value); setSaved(false) }} placeholder="Teacher feedback" className="w-full resize-y rounded-lg border border-slate-200 px-2.5 py-2 text-xs" />
        <FileField schoolId={schoolId} purpose="SUBMISSION" value={file} onChange={(f) => { setFile(f); setSaved(false) }} onError={setError} onBusy={setUploading} title="Attach submitted work (PDF, DOCX, image)" hint="" compact />
        {s?.file?.url && file?.id === s.fileId && (
          <a href={s.file.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:underline">Open submitted work <ExternalLink className="size-3" /></a>
        )}
        <ErrorBanner message={error} />
      </div>
      <button type="button" onClick={() => void save()} disabled={busy || uploading} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-ink px-4 text-xs font-semibold text-white hover:bg-ink-hover disabled:opacity-60">
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : saved ? <Check className="size-3.5" /> : null}
        {saved ? 'Saved' : 'Save Grade'}
      </button>
    </div>
  )
}
