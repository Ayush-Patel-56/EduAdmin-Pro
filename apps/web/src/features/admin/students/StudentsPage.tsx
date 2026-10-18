import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, FileText, Loader2, Pencil, Plus, RefreshCw, Trash2, Upload, UserRound } from 'lucide-react'
import { api } from '@/lib/api'
import { Dialog } from '@/components/ui/Dialog'
import { ConfirmDialog, ErrorBanner } from '@/components/ui/form'
import { removalLines } from '@/features/students/api'
import { ALL } from '@/features/academic/filters'
import {
  STUDENT_STATUS_LABELS,
  useAdminRoster,
  useInvalidateStudents,
  type RosterFilters,
  type StudentDetail,
  type StudentListItem,
} from '@/features/students/api'
import { useAdminContext } from '../adminContext'
import { exportRosterCsv, exportRosterPdf } from './exportRoster'
import { ImportStudentsDialog } from './ImportStudentsDialog'
import { downloadStudentSample } from './studentSheet'
import { StudentFormDialog } from './StudentFormDialog'
import { StudentAvatar } from '@/features/students/StudentAvatar'
import { StudentProfileDialog } from './StudentProfileDialog'

const headerBtn =
  'inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:opacity-60'
const filterSelect =
  'h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm font-medium text-slate-800 focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100 focus:outline-none'

export function StudentsPage() {
  const { me, schoolId, dashboard, structure, filters } = useAdminContext()
  const [params, setParams] = useSearchParams()
  const invalidate = useInvalidateStudents(schoolId)
  const classes = dashboard?.school.classes ?? []
  const sidebarProgram = filters.programId !== ALL ? filters.programId : ''
  const sidebarBatch = filters.batchId !== ALL ? filters.batchId : ''
  const [classLevel, setClassLevel] = useState('')
  const [batchId, setBatchId] = useState(sidebarBatch)
  const [page, setPage] = useState(1)
  // The sidebar's Program → Batch filters narrow the roster too: a change there resets the page's batch.
  const sidebarKey = `${sidebarProgram}|${sidebarBatch}`
  const [syncedKey, setSyncedKey] = useState(sidebarKey)
  if (syncedKey !== sidebarKey) {
    setSyncedKey(sidebarKey)
    setBatchId(sidebarBatch)
    setPage(1)
  }

  const rosterFilters: RosterFilters = { q: '', classLevel, programId: sidebarProgram, batchId, page }
  const roster = useAdminRoster(schoolId, rosterFilters)
  const batchChoices = (structure?.batches ?? []).filter((b) => !sidebarProgram || b.programId === sidebarProgram)

  const [modal, setModal] = useState<'add' | 'import' | 'export' | null>(null)
  const [editing, setEditing] = useState<StudentDetail | null>(null)
  const [deleting, setDeleting] = useState<{ id: string; fullName: string } | null>(null)
  const profileId = params.get('student')
  const openProfile = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('student', id)
    else next.delete('student')
    setParams(next, { replace: true })
  }
  const schoolName = me.memberships.find((m) => m.schoolId === schoolId)?.schoolName ?? 'School'

  const [rowError, setRowError] = useState<string | null>(null)
  async function editFromRow(row: StudentListItem) {
    setRowError(null)
    try {
      setEditing(await api<StudentDetail>(`/schools/${schoolId}/students/${row.id}`))
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Could not open the student')
    }
  }

  const data = roster.data
  const from = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0
  const to = data ? Math.min(data.page * data.pageSize, data.total) : 0
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900 sm:text-[26px]">Student Roster</h1>
            <span
              title="Refreshes automatically every 30 seconds"
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700"
            >
              <span className="size-1.5 rounded-full bg-emerald-500" /> Live Sync
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">Manage student records, batches, and parent/guardian details</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setModal('add')}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-ink px-4 text-sm font-semibold text-white shadow-sm hover:bg-ink-hover"
          >
            <Plus className="size-4" /> Add Student
          </button>
          <button type="button" onClick={() => setModal('import')} className={headerBtn}>
            <Upload className="size-4" /> Upload CSV
          </button>
          <button type="button" onClick={downloadStudentSample} className={headerBtn}>
            <Download className="size-4" /> Export Sample CSV
          </button>
          <button type="button" onClick={() => setModal('export')} className={headerBtn}>
            <Download className="size-4" /> Export
          </button>
          <button type="button" onClick={() => void roster.refetch()} disabled={roster.isFetching} className={headerBtn}>
            <RefreshCw className={`size-4 ${roster.isFetching ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2">
        <div>
          <label htmlFor="roster-class" className="mb-1.5 block text-[10px] font-bold tracking-[0.12em] text-slate-500 uppercase">Class</label>
          <select
            id="roster-class"
            value={classLevel}
            onChange={(e) => {
              setClassLevel(e.target.value)
              setPage(1)
            }}
            className={filterSelect}
          >
            <option value="">All Classes</option>
            {classes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="roster-batch" className="mb-1.5 block text-[10px] font-bold tracking-[0.12em] text-slate-500 uppercase">Batch</label>
          <select
            id="roster-batch"
            value={batchId}
            onChange={(e) => {
              setBatchId(e.target.value)
              setPage(1)
            }}
            className={filterSelect}
          >
            <option value="">All Batches</option>
            <option value="unassigned">Unassigned</option>
            {batchChoices.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-6">
        <ErrorBanner message={roster.error?.message ?? rowError} />
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {roster.isPending ? (
            <Loader2 className="mx-auto my-24 size-6 animate-spin text-slate-300" aria-label="Loading" />
          ) : !data || data.total === 0 ? (
            <div className="flex flex-col items-center px-4 py-28 text-center">
              <UserRound className="size-12 text-slate-300" strokeWidth={1.5} />
              <p className="mt-4 text-base font-bold text-slate-800">No Students Found</p>
              <p className="mt-1 text-sm text-slate-500">Try adjusting your filters or add students to the database.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-left text-sm">
                  <thead className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                    <tr className="border-b border-slate-100">
                      <th className="px-6 py-4">Roll No</th>
                      <th className="px-3 py-4">Student Name</th>
                      <th className="px-3 py-4">Class</th>
                      <th className="px-3 py-4">Program</th>
                      <th className="px-3 py-4">Batch</th>
                      <th className="px-3 py-4">Contact</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.items.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50/70">
                        <td className="px-6 py-4 text-slate-700">{s.rollNumber ?? 'N/A'}</td>
                        <td className="px-3 py-4">
                          <button type="button" onClick={() => openProfile(s.id)} className="flex items-center gap-3 text-left">
                            <StudentAvatar name={s.fullName} photoUrl={s.photoUrl} />
                            <span>
                              <span className="block font-semibold text-violet-700 hover:underline">{s.fullName}</span>
                              {s.status !== 'ACTIVE' && (
                                <span className="text-[10px] font-semibold text-slate-400 uppercase">{STUDENT_STATUS_LABELS[s.status]}</span>
                              )}
                            </span>
                          </button>
                        </td>
                        <td className="px-3 py-4 text-slate-700">{s.classLevel ?? 'N/A'}</td>
                        <td className="px-3 py-4 text-slate-700">{s.program?.name ?? 'Unassigned'}</td>
                        <td className="px-3 py-4">
                          {s.batch ? (
                            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">{s.batch.name}</span>
                          ) : (
                            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold tracking-wide text-blue-700 uppercase">Unassigned</span>
                          )}
                        </td>
                        <td className="px-3 py-4 text-slate-700">{s.phone ?? s.parentContact ?? 'N/A'}</td>
                        <td className="px-6 py-4">
                          <div className="flex justify-end gap-1">
                            <button type="button" aria-label={`Edit ${s.fullName}`} onClick={() => void editFromRow(s)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600">
                              <Pencil className="size-4" />
                            </button>
                            <button type="button" aria-label={`Delete ${s.fullName}`} onClick={() => setDeleting(s)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 px-4 py-3 text-xs text-slate-600">
                <p className="font-medium">
                  Showing {from} to {to} of {data.total} entries
                </p>
                {pages > 1 && (
                  <div className="flex items-center gap-1">
                    <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-1 disabled:opacity-40">
                      <ChevronLeft className="size-3.5" /> Prev
                    </button>
                    <span className="px-2">{page} / {pages}</span>
                    <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-1 disabled:opacity-40">
                      Next <ChevronRight className="size-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {(modal === 'add' || editing) && (
        <StudentFormDialog
          schoolId={schoolId}
          classes={classes}
          structure={structure}
          student={editing ?? undefined}
          onSaved={invalidate}
          onClose={() => {
            setModal(null)
            setEditing(null)
          }}
        />
      )}
      {modal === 'import' && (
        <ImportStudentsDialog schoolId={schoolId} structure={structure} onImported={invalidate} onClose={() => setModal(null)} />
      )}
      {modal === 'export' && (
        <ExportDialog
          onExport={(format) => {
            const scope = { q: '', classLevel, programId: sidebarProgram, batchId }
            const label = [
              classLevel ? `Class ${classLevel}` : 'All classes',
              batchId === 'unassigned' ? 'Unassigned' : (structure?.batches.find((b) => b.id === batchId)?.name ?? 'All batches'),
            ].join(' · ')
            return format === 'pdf' ? exportRosterPdf(schoolId, schoolName, scope, label) : exportRosterCsv(schoolId, schoolName, scope)
          }}
          onClose={() => setModal(null)}
        />
      )}
      {profileId && !editing && (
        <StudentProfileDialog
          schoolId={schoolId}
          studentId={profileId}
          onEdit={setEditing}
          onDelete={(s) => setDeleting(s)}
          onChanged={invalidate}
          onClose={() => openProfile(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Remove ${deleting.fullName}?`}
          message={<RemovalMessage schoolId={schoolId} studentId={deleting.id} />}
          confirmLabel="Remove Student"
          onConfirm={async () => {
            await api(`/schools/${schoolId}/students/${deleting.id}`, { method: 'DELETE' })
            if (profileId === deleting.id) openProfile(null)
            await invalidate()
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  )
}

/** The delete confirmation, naming the faculty records that go with the student. */
function RemovalMessage({ schoolId, studentId }: { schoolId: string; studentId: string }) {
  const removal = useQuery({
    queryKey: [schoolId, 'student-removal', studentId],
    queryFn: () => api<{ ptmNotes: number; counselingSessions: number }>(`/schools/${schoolId}/students/${studentId}/removal`),
  })
  const gone = removal.data ? removalLines(removal.data) : []
  return (
    <div className="space-y-2">
      <p>The student, their parents/guardians and batch history are deleted. This can’t be undone; to keep the record, set the status to Inactive, Transferred or Completed instead. A student with recorded attendance, fees or test results can’t be deleted.</p>
      {removal.isLoading && <p className="text-xs text-slate-400">Checking their records…</p>}
      {gone.length > 0 && (
        <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Also deleted: {gone.join(' and ')} written by faculty about this student.
        </p>
      )}
    </div>
  )
}

function ExportDialog({ onExport, onClose }: { onExport: (format: 'pdf' | 'csv') => Promise<number>; onClose: () => void }) {
  const [format, setFormat] = useState<'pdf' | 'csv'>('pdf')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const option = (value: 'pdf' | 'csv', Icon: typeof FileText, text: string) => (
    <button
      type="button"
      onClick={() => setFormat(value)}
      aria-pressed={format === value}
      className={`flex flex-col items-center gap-2 rounded-xl border px-4 py-5 text-sm font-semibold transition ${
        format === value ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
      }`}
    >
      <Icon className="size-5" /> {text}
    </button>
  )
  async function run() {
    setBusy(true)
    setError(null)
    try {
      await onExport(format)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
      setBusy(false)
    }
  }
  return (
    <Dialog title="Export Student Roster" onClose={onClose} widthClass="max-w-sm">
      <div className="space-y-4 px-6 py-5">
        <p className="text-[11px] font-bold tracking-wide text-slate-500 uppercase">Export format</p>
        <div className="grid grid-cols-2 gap-3">
          {option('pdf', FileText, 'PDF')}
          {option('csv', FileSpreadsheet, 'CSV')}
        </div>
        <p className="text-[11px] text-slate-400">Exports the students matching the current filters. Aadhaar numbers are masked.</p>
        <ErrorBanner message={error} />
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="h-10 px-3 text-sm font-semibold text-slate-600 hover:text-slate-900">Cancel</button>
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            Generate & Export {format.toUpperCase()}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
