import { useState } from 'react'
import { ExternalLink, Loader2, Lock } from 'lucide-react'
import { formatSize } from '@/lib/upload'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner } from '@/components/ui/form'
import type { Structure } from '@/features/academic/api'
import { formatDate } from '@/features/portal/format'
import {
  ASSIGNMENT_TYPE_LABELS,
  MATERIAL_TYPE_LABELS,
  useAssignments,
  useMaterials,
  type FileView,
} from '@/features/workspace/api'

function Preview({ file }: { file: FileView | null }) {
  if (!file) return <span className="text-xs text-slate-400">No file</span>
  if (!file.url) return <span className="text-xs text-slate-400">Storage off</span>
  return (
    <a href={file.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline">
      Preview <ExternalLink className="size-3" />
      <span className="font-normal text-slate-400">({formatSize(file.size)})</span>
    </a>
  )
}

/** Everything faculty uploaded in the school, read-only, with previews (PRD 4.7). */
export function UploadsDialog({ schoolId, structure, initialTab, onClose }: { schoolId: string; structure: Structure | undefined; initialTab: 'materials' | 'assignments'; onClose: () => void }) {
  const [tab, setTab] = useState(initialTab)
  const [batchId, setBatchId] = useState('')
  const materials = useMaterials({ batchId }, schoolId)
  const assignments = useAssignments({ batchId }, schoolId)
  const active = tab === 'materials' ? materials : assignments

  return (
    <Dialog title="Faculty Uploads" description="Study material and assignments uploaded by teachers" onClose={onClose} widthClass="max-w-4xl">
      <div className="space-y-4 px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {(['materials', 'assignments'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                aria-pressed={tab === t}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold ${tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
              >
                {t === 'materials' ? 'Study Materials' : 'Assignments'}
              </button>
            ))}
          </div>
          <select aria-label="Batch" value={batchId} onChange={(e) => setBatchId(e.target.value)} className="h-9 rounded-lg border border-slate-200 px-3 text-xs">
            <option value="">All Batches</option>
            {structure?.batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <ErrorBanner message={active.error?.message} />
        {active.isPending && <Loader2 className="mx-auto size-6 animate-spin text-slate-300" aria-label="Loading" />}
        {tab === 'materials' && materials.data && (
          materials.data.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">No study material uploaded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                  <tr className="border-b border-slate-100"><th className="py-2">Title</th><th>Batch &amp; Subject</th><th>Type</th><th>Uploaded by</th><th>Date</th><th>File</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {materials.data.map((m) => (
                    <tr key={m.id}>
                      <td className="py-2.5 pr-3">
                        <p className="flex items-center gap-1 font-semibold text-slate-900">{m.title}{!m.isPublic && <Lock className="size-3 text-slate-400" aria-label="Private" />}</p>
                        <p className="text-[11px] text-slate-500">{[m.chapter, m.provider].filter(Boolean).join(' · ')}</p>
                      </td>
                      <td className="pr-3 text-slate-700">{m.batch.name}<span className="block text-[11px] text-slate-500">{m.subject}</span></td>
                      <td className="pr-3 text-slate-700">{MATERIAL_TYPE_LABELS[m.type]}</td>
                      <td className="pr-3 text-slate-700">{m.uploadedBy ?? '—'}</td>
                      <td className="pr-3 text-slate-700">{formatDate(m.createdAt)}</td>
                      <td><Preview file={m.file} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
        {tab === 'assignments' && assignments.data && (
          assignments.data.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">No assignments yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                  <tr className="border-b border-slate-100"><th className="py-2">Title &amp; Topic</th><th>Batch &amp; Subject</th><th>Type</th><th>Due</th><th>Submissions</th><th>Question Paper</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {assignments.data.map((a) => (
                    <tr key={a.id}>
                      <td className="py-2.5 pr-3"><p className="font-semibold text-slate-900">{a.title}</p><p className="text-[11px] text-slate-500">{a.chapter} · set by {a.setBy ?? '—'}</p></td>
                      <td className="pr-3 text-slate-700">{a.batch.name}<span className="block text-[11px] text-slate-500">{a.subject}</span></td>
                      <td className="pr-3 text-slate-700">{ASSIGNMENT_TYPE_LABELS[a.type]}</td>
                      <td className="pr-3 text-slate-700">{formatDate(a.dueAt)}</td>
                      <td className="pr-3 text-slate-700">{a.handedIn}/{a.students} · {a.graded} graded</td>
                      <td><Preview file={a.questionFile} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </Dialog>
  )
}
