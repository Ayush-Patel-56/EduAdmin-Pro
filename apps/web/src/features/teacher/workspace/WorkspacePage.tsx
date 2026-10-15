import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { BookOpen, ClipboardList, ExternalLink, Filter, GraduationCap, Loader2, Lock, Pencil, Plus, Search, Sparkles, Trash2, TriangleAlert } from 'lucide-react'
import { api } from '@/lib/api'
import { formatSize } from '@/lib/upload'
import { ConfirmDialog, ErrorBanner } from '@/components/ui/form'
import { ALL } from '@/features/academic/filters'
import { formatDate } from '@/features/portal/format'
import {
  ASSIGNMENT_TYPE_LABELS,
  MATERIAL_TYPE_LABELS,
  useAssignments,
  useInvalidateWorkspace,
  useMaterials,
  type Assignment,
  type AssignmentType,
  type Material,
  type MaterialType,
} from '@/features/workspace/api'
import { useTeacherContext } from '../useTeacherDashboard'
import { AssignmentDialog, MaterialDialog } from './dialogs'
import { GradingTab } from './GradingTab'

type Tab = 'assignments' | 'materials' | 'grading'
const TABS: { id: Tab; label: string; icon: typeof BookOpen; active: string }[] = [
  { id: 'assignments', label: 'Assignments', icon: ClipboardList, active: 'border-indigo-600 text-indigo-700' },
  { id: 'materials', label: 'Study Materials', icon: BookOpen, active: 'border-emerald-600 text-emerald-700' },
  { id: 'grading', label: 'Grading & Submissions', icon: GraduationCap, active: 'border-amber-500 text-amber-600' },
]
const filterSelect = 'h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-800 focus:outline-none'

/** The faculty Academic Workspace (PRD 5.9): /teacher/courses, and /teacher/assignments opens on Assignments. */
export function WorkspacePage() {
  const { dashboard, structure, filters } = useTeacherContext()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const fallback: Tab = location.pathname.endsWith('/assignments') ? 'assignments' : 'materials'
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : fallback) as Tab
  const go = (next: Tab, extra: Record<string, string> = {}) => setParams({ tab: next, ...extra }, { replace: true })
  const schoolId = dashboard?.school?.id ?? ''
  const batches = (structure?.batches ?? []).filter((b) => filters.programId === ALL || b.programId === filters.programId)
  const sidebarBatch = filters.batchId !== ALL ? filters.batchId : ''
  const [batchId, setBatchId] = useState(sidebarBatch)
  const [type, setType] = useState('')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])
  const listFilters = { batchId, type, q }
  const materials = useMaterials(listFilters)
  const assignments = useAssignments(tab === 'grading' ? {} : listFilters)
  const invalidate = useInvalidateWorkspace()
  const [dialog, setDialog] = useState<{ kind: 'material'; item?: Material } | { kind: 'assignment'; item?: Assignment } | null>(null)
  const [deleting, setDeleting] = useState<{ kind: 'material' | 'assignment'; id: string; title: string } | null>(null)
  const noSchool = dashboard && !dashboard.school

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-bold tracking-[0.14em] text-slate-700 uppercase"><Sparkles className="size-4" /> Academic Workspace</p>
          <h1 className="mt-2 text-3xl font-black text-slate-900">Study Materials &amp; Assignments</h1>
          <p className="mt-1 text-sm text-slate-500">Build and assign repository resources, assign tasks, and grade submissions in real-time.</p>
        </div>
        {tab === 'materials' && (
          <button type="button" disabled={!schoolId} onClick={() => setDialog({ kind: 'material' })} className="inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60">
            <Plus className="size-4" /> Upload Material
          </button>
        )}
        {tab === 'assignments' && (
          <button type="button" disabled={!schoolId} onClick={() => setDialog({ kind: 'assignment' })} className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink px-5 text-sm font-semibold text-white shadow-sm hover:bg-ink-hover disabled:opacity-60">
            <Plus className="size-4" /> New Assignment
          </button>
        )}
      </div>

      <div className="mt-6 flex gap-2 overflow-x-auto border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => go(t.id)} aria-current={tab === t.id} className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-5 py-3 text-sm font-semibold transition ${tab === t.id ? t.active : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            <t.icon className="size-4" /> {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {noSchool && <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">Join a school to use the academic workspace.</p>}
        {tab !== 'grading' && (
          <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <Filter className="size-4" /> Filter by:
              <select aria-label="Batch" value={batchId} onChange={(e) => setBatchId(e.target.value)} className={filterSelect}>
                <option value="">All Batches</option>
                {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} className={filterSelect}>
                <option value="">All Types</option>
                {tab === 'materials'
                  ? (Object.keys(MATERIAL_TYPE_LABELS) as MaterialType[]).map((t) => <option key={t} value={t}>{MATERIAL_TYPE_LABELS[t]}</option>)
                  : (Object.keys(ASSIGNMENT_TYPE_LABELS) as AssignmentType[]).map((t) => <option key={t} value={t}>{ASSIGNMENT_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tab === 'materials' ? 'Search materials...' : 'Search assignments...'} aria-label="Search" className="h-9 w-64 rounded-lg border border-slate-200 pr-3 pl-9 text-xs focus:outline-none" />
            </div>
          </div>
        )}

        {tab === 'materials' && (
          <ListShell loading={materials.isPending} error={materials.error?.message} empty={materials.data?.length === 0} emptyText="No study materials found. Upload resource notes or answer keys.">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {materials.data?.map((m) => (
                <article key={m.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold tracking-wide text-emerald-700 uppercase">{MATERIAL_TYPE_LABELS[m.type]}</span>
                    {!m.isPublic && <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400"><Lock className="size-3" /> Only you</span>}
                  </div>
                  <h3 className="mt-3 font-bold text-slate-900">{m.title}</h3>
                  <p className="mt-0.5 text-xs text-slate-500">{[m.subject, m.chapter, m.batch.name].filter(Boolean).join(' · ')}</p>
                  {m.description && <p className="mt-2 line-clamp-2 text-xs text-slate-600">{m.description}</p>}
                  <p className="mt-3 text-[11px] text-slate-400">{m.provider} · {m.mine ? 'You' : (m.uploadedBy ?? 'A former teacher')} · {formatDate(m.createdAt)}</p>
                  <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                    {m.file.url ? (
                      <a href={m.file.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline">
                        Open {formatSize(m.file.size)} <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      <span className="text-xs text-slate-400">File storage is off</span>
                    )}
                    {m.mine && (
                      <span className="flex gap-1">
                        <button type="button" aria-label={`Edit ${m.title}`} onClick={() => setDialog({ kind: 'material', item: m })} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600"><Pencil className="size-4" /></button>
                        <button type="button" aria-label={`Delete ${m.title}`} onClick={() => setDeleting({ kind: 'material', id: m.id, title: m.title })} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" /></button>
                      </span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </ListShell>
        )}

        {tab === 'assignments' && (
          <ListShell loading={assignments.isPending} error={assignments.error?.message} empty={assignments.data?.length === 0} emptyText="No assignments yet. Create one for your batch.">
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                  <tr className="border-b border-slate-100">
                    <th className="px-5 py-3.5">Title &amp; Topic</th><th className="px-3 py-3.5">Batch &amp; Subject</th><th className="px-3 py-3.5">Type</th><th className="px-3 py-3.5">Due Date</th><th className="px-3 py-3.5">Total Marks</th><th className="px-3 py-3.5">Submissions</th><th className="px-5 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {assignments.data?.map((a) => {
                    const rate = a.students ? Math.round((a.handedIn / a.students) * 100) : 0
                    return (
                      <tr key={a.id} className="hover:bg-slate-50/60">
                        <td className="px-5 py-3.5"><p className="font-semibold text-slate-900">{a.title}</p><p className="text-[11px] text-slate-500">{a.chapter}{!a.mine && a.setBy && ` · by ${a.setBy}`}</p></td>
                        <td className="px-3 py-3.5 text-slate-700">{a.batch.name}<span className="block text-[11px] text-slate-500">{a.subject}</span></td>
                        <td className="px-3 py-3.5"><span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700">{ASSIGNMENT_TYPE_LABELS[a.type]}</span></td>
                        <td className="px-3 py-3.5 text-slate-700">{formatDate(a.dueAt)}<span className="block text-[11px] text-slate-500">{a.dueTime}</span></td>
                        <td className="px-3 py-3.5 text-slate-700">{a.totalMarks}</td>
                        <td className="px-3 py-3.5">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-emerald-500" style={{ width: `${rate}%` }} /></div>
                            <span className="text-xs text-slate-600">{a.students ? `${rate}%` : '—'}</span>
                          </div>
                          <span className="text-[11px] text-slate-400">{a.handedIn}/{a.students} in · {a.graded} graded</span>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex justify-end gap-1">
                            <button type="button" onClick={() => go('grading', { assignment: a.id })} className="rounded-md px-2 py-1 text-xs font-semibold text-amber-600 hover:bg-amber-50">Grade</button>
                            {a.questionFile?.url && <a href={a.questionFile.url} target="_blank" rel="noreferrer" className="rounded-md px-2 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50">View paper</a>}
                            {a.mine && (
                              <>
                                <button type="button" aria-label={`Edit ${a.title}`} onClick={() => setDialog({ kind: 'assignment', item: a })} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600"><Pencil className="size-4" /></button>
                                <button type="button" aria-label={`Delete ${a.title}`} onClick={() => setDeleting({ kind: 'assignment', id: a.id, title: a.title })} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" /></button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </ListShell>
        )}

        {tab === 'grading' && (
          <GradingTab schoolId={schoolId} assignments={assignments.data ?? []} selectedId={params.get('assignment') ?? ''} onSelect={(id) => go('grading', id ? { assignment: id } : {})} />
        )}
      </div>

      {dialog?.kind === 'material' && (
        <MaterialDialog schoolId={schoolId} batches={structure?.batches ?? []} material={dialog.item} defaultBatchId={batchId || sidebarBatch} onSaved={invalidate} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'assignment' && (
        <AssignmentDialog schoolId={schoolId} batches={structure?.batches ?? []} assignment={dialog.item} defaultBatchId={batchId || sidebarBatch} onSaved={invalidate} onClose={() => setDialog(null)} />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.title}?`}
          message={deleting.kind === 'material' ? <p>The material and its file are deleted for everyone.</p> : <p>The assignment, its question sheet, and every grade and submitted file recorded for it are deleted.</p>}
          confirmLabel="Delete"
          onConfirm={async () => {
            await api(`/teacher/workspace/${deleting.kind === 'material' ? 'materials' : 'assignments'}/${deleting.id}`, { method: 'DELETE' })
            await invalidate()
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  )
}

function ListShell({ loading, error, empty, emptyText, children }: { loading: boolean; error?: string; empty: boolean | undefined; emptyText: string; children: ReactNode }) {
  if (error) return <ErrorBanner message={error} />
  if (loading) return <Loader2 className="mx-auto my-16 size-6 animate-spin text-slate-300" aria-label="Loading" />
  if (empty) {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-slate-200 bg-white px-6 py-20 text-center shadow-sm">
        <TriangleAlert className="size-9 text-slate-400" strokeWidth={1.5} />
        <p className="mt-3 text-sm text-slate-500 italic">{emptyText}</p>
      </div>
    )
  }
  return <>{children}</>
}
