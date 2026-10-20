import { useCallback, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ChevronDown,
  Download,
  FileText,
  Filter,
  GraduationCap,
  Loader2,
  MessageSquare,
  Pencil,
  Trash2,
  Upload,
  UserRound,
} from 'lucide-react'
import { api } from '@/lib/api'
import { todayIst } from '@/lib/dates'
import { downloadFile, toCsv } from '@/lib/spreadsheet'
import { ConfirmDialog, ErrorBanner } from '@/components/ui/form'
import { useDismiss } from '@/components/ui/useDismiss'
import { FloatingMenu } from '@/components/ui/FloatingMenu'
import { FACULTY_STATUS_LABELS, type Faculty, type FacultyStatus } from '@/features/academic/api'
import { COUNSELING_STATUS_LABELS, COUNSELING_TYPE_LABELS, type CounselingStatus, type CounselingType } from '@/features/counseling/api'
import { useDirectory, useInvalidateFaculty, usePortalOverview, type DirectoryRow, type FacultyDetail } from '@/features/faculty/api'
import { formatDate, formatDay } from '@/features/portal/format'
import { StudentAvatar } from '@/features/students/StudentAvatar'
import { MATERIAL_TYPE_LABELS, type MaterialType } from '@/features/workspace/api'
import { ImportFacultyDialog } from '../planning/FacultyTab'
import { useAdminContext } from '../adminContext'
import { downloadCv } from './cv'
import { EditFacultyDialog } from './EditFacultyDialog'
import { FacultyProfileDialog } from './FacultyProfileDialog'
import { UploadsDialog } from './UploadsDialog'

const STATUS_BADGE: Record<FacultyStatus, string> = {
  ACTIVE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  ON_LEAVE: 'border-amber-200 bg-amber-50 text-amber-700',
  INACTIVE: 'border-slate-200 bg-slate-50 text-slate-500',
}
const toolbarBtn = 'inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-60'

function Kpi({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value: number | undefined }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <span className="flex size-11 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><Icon className="size-5" /></span>
      <div>
        <p className="text-xs text-slate-500">{label}</p>
        <p className="mt-0.5 text-2xl font-bold text-slate-900">{value ?? '—'}</p>
      </div>
    </div>
  )
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <h2 className="text-base font-bold text-slate-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

const menuItem = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50'

export function TeacherPortalPage() {
  const { me, schoolId, structure } = useAdminContext()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const overview = usePortalOverview(schoolId)
  const directory = useDirectory(schoolId)
  const invalidate = useInvalidateFaculty(schoolId)
  const [statusFilter, setStatusFilter] = useState<FacultyStatus | ''>('')
  const [filterOpen, setFilterOpen] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)
  const closeFilter = useCallback(() => setFilterOpen(false), [])
  useDismiss(filterRef, filterOpen, closeFilter)
  const [importing, setImporting] = useState(false)
  const [uploads, setUploads] = useState<'materials' | 'assignments' | null>(null)
  const [editing, setEditing] = useState<FacultyDetail | null>(null)
  const [deleting, setDeleting] = useState<DirectoryRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const profileId = params.get('faculty')
  const openProfile = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('faculty', id)
    else next.delete('faculty')
    setParams(next, { replace: true })
  }
  const schoolName = me.memberships.find((m) => m.schoolId === schoolId)?.schoolName ?? 'School'
  const rows = (directory.data ?? []).filter((f) => !statusFilter || f.status === statusFilter)
  const refresh = () => Promise.all([invalidate(), overview.refetch()])

  async function withDetail(row: DirectoryRow, run: (f: FacultyDetail) => Promise<void> | void) {
    setError(null)
    setBusy(row.id)
    try {
      await run(await api<FacultyDetail>(`/schools/${schoolId}/teacher-portal/faculty/${row.id}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(null)
    }
  }

  async function exportDirectory() {
    setError(null)
    try {
      const all = await api<Faculty[]>(`/schools/${schoolId}/faculty`)
      const header = ['Name', 'Employee ID', 'Email', 'Phone', 'Subject', 'Specialization', 'Qualification', 'Experience (Years)', 'Joining Date (YYYY-MM-DD)', 'Status', 'Batches']
      const body = all
        .filter((f) => !statusFilter || f.status === statusFilter)
        .map((f) => [f.name, f.employeeId, f.email, f.phone, f.subjects.join(', '), f.specialization, f.qualification, f.experienceYears, f.joiningDate, f.status, f.batches.map((b) => b.name).join(', ')])
      if (body.length === 0) throw new Error('No faculty to export')
      downloadFile(`faculty-${todayIst()}.csv`, toCsv([header, ...body]))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    }
  }

  const k = overview.data?.kpis
  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-[26px]">Teacher Portal</h1>
        <p className="mt-1 text-sm text-slate-500">Monitor faculty schedules, materials, and counseling activity</p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={UserRound} label="Total Faculty" value={k?.totalFaculty} />
        <Kpi icon={GraduationCap} label="Active Batches Covered" value={k?.activeBatchesCovered} />
        <Kpi icon={FileText} label="Materials Uploaded" value={k?.materialsUploaded} />
        <Kpi icon={MessageSquare} label="Counseling Sessions Logged" value={k?.counselingSessions} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card
          title="Faculty Directory"
          action={
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => void exportDirectory()} className={toolbarBtn}><Download className="size-4" /> Export</button>
              <button type="button" onClick={() => setImporting(true)} className={toolbarBtn}><Upload className="size-4" /> Import CSV</button>
              <div ref={filterRef} className="relative">
                <button type="button" aria-label="Filter by status" aria-expanded={filterOpen} onClick={() => setFilterOpen((o) => !o)} className={`${toolbarBtn} ${statusFilter ? 'text-indigo-600' : ''}`}>
                  <Filter className="size-4" /> <ChevronDown className="size-3" />
                </button>
                {filterOpen && (
                  <div role="menu" className="absolute right-0 z-20 mt-1 w-40 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                    {(['', 'ACTIVE', 'ON_LEAVE', 'INACTIVE'] as const).map((s) => (
                      <button key={s || 'all'} type="button" onClick={() => { setStatusFilter(s); setFilterOpen(false) }} className={`${menuItem} ${statusFilter === s ? 'font-semibold text-indigo-600' : 'text-slate-700'}`}>
                        {s ? FACULTY_STATUS_LABELS[s] : 'All statuses'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          }
        >
          <ErrorBanner message={directory.error?.message ?? error} />
          {directory.isPending ? (
            <Loader2 className="mx-auto my-16 size-6 animate-spin text-slate-300" aria-label="Loading" />
          ) : rows.length === 0 ? (
            <p className="px-6 py-16 text-center text-sm text-slate-400">
              {statusFilter ? 'No faculty with this status.' : 'No faculty yet. Teachers appear here when they join with the school’s invite code, or import them from a sheet.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-slate-50/60 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                  <tr className="border-b border-slate-100">
                    <th className="px-6 py-3.5">Faculty Name</th>
                    <th className="px-3 py-3.5">Date of Joining</th>
                    <th className="px-3 py-3.5 text-center">Batches</th>
                    <th className="px-3 py-3.5">Phone</th>
                    <th className="px-3 py-3.5">Status</th>
                    <th className="px-6 py-3.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((f) => (
                    <tr key={f.id} className="hover:bg-slate-50/60">
                      <td className="px-6 py-3.5">
                        <button type="button" onClick={() => openProfile(f.id)} className="flex items-center gap-3 text-left">
                          <StudentAvatar name={f.name} photoUrl={f.photoUrl} size="size-10 text-sm" tone="bg-emerald-600 text-white" />
                          <span>
                            <span className="block font-semibold text-slate-900 hover:underline">{f.name}</span>
                            <span className="block text-[11px] text-slate-500">{f.primarySubject ?? 'No subject yet'}</span>
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-3.5 text-slate-700">{f.joiningDate ? formatDay(f.joiningDate) : '—'}</td>
                      <td className="px-3 py-3.5 text-center"><span className="inline-flex size-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">{f.batchCount}</span></td>
                      <td className="px-3 py-3.5 text-slate-700">{f.phone ?? 'N/A'}</td>
                      <td className="px-3 py-3.5">
                        <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold tracking-wide uppercase ${STATUS_BADGE[f.status]}`}>{FACULTY_STATUS_LABELS[f.status]}</span>
                      </td>
                      <td className="px-6 py-3.5 text-right">
                        {busy === f.id ? (
                          <Loader2 className="ml-auto size-4 animate-spin text-slate-400" />
                        ) : (
                          <FloatingMenu label={`Actions for ${f.name}`}>
                            {(close) => (
                              <>
                                <button type="button" className={`${menuItem} text-slate-700`} onClick={() => { close(); openProfile(f.id) }}><UserRound className="size-4" /> Profile</button>
                                <button type="button" className={`${menuItem} text-emerald-600`} onClick={() => { close(); void withDetail(f, (d) => downloadCv(d, schoolName)) }}><Download className="size-4" /> Download CV</button>
                                <button type="button" className={`${menuItem} text-slate-700`} onClick={() => { close(); void withDetail(f, setEditing) }}><Pencil className="size-4" /> Edit</button>
                                <button type="button" className={`${menuItem} text-red-600`} onClick={() => { close(); setDeleting(f) }}><Trash2 className="size-4" /> Delete</button>
                              </>
                            )}
                          </FloatingMenu>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card
            title="Recent Study Material Uploads"
            action={overview.data?.recentMaterials.length ? <button type="button" onClick={() => setUploads('materials')} className="text-xs font-semibold text-indigo-600 hover:underline">View all</button> : undefined}
          >
            {!overview.data ? (
              <Loader2 className="mx-auto my-10 size-5 animate-spin text-slate-300" aria-label="Loading" />
            ) : overview.data.recentMaterials.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-10 text-center">
                <FileText className="size-8 text-slate-300" strokeWidth={1.5} />
                <p className="mt-3 text-sm text-slate-400">No materials uploaded yet.</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {overview.data.recentMaterials.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-6 py-3">
                    <FileText className="size-5 shrink-0 text-emerald-600" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{m.title}</p>
                      <p className="truncate text-[11px] text-slate-500">{MATERIAL_TYPE_LABELS[m.type as MaterialType]} · {m.batch} · {m.uploadedBy ?? 'Former teacher'} · {formatDate(m.createdAt)}</p>
                    </div>
                    {m.file.url && <a href={m.file.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-indigo-600 hover:underline">Preview</a>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Recent Counseling Logs"
            action={
              <FloatingMenu label="Counseling options">
                {(close) => (
                  <>
                    <button type="button" className={`${menuItem} text-slate-700`} onClick={() => { close(); navigate('/management/counseling') }}>Open Counseling</button>
                    <button type="button" className={`${menuItem} text-slate-700`} onClick={() => { close(); setUploads('assignments') }}>View assignments</button>
                  </>
                )}
              </FloatingMenu>
            }
          >
            {!overview.data ? (
              <Loader2 className="mx-auto my-10 size-5 animate-spin text-slate-300" aria-label="Loading" />
            ) : overview.data.recentCounseling.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-10 text-center">
                <MessageSquare className="size-8 text-slate-300" strokeWidth={1.5} />
                <p className="mt-3 text-sm text-slate-400">No counseling logs found.</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {overview.data.recentCounseling.map((c) => (
                  <li key={c.id} className="px-6 py-3">
                    <p className="text-sm font-semibold text-slate-900">{c.student}</p>
                    <p className="text-[11px] text-slate-500">
                      {COUNSELING_TYPE_LABELS[c.type as CounselingType]} · {c.counselor} · {formatDate(c.scheduledAt)} · {COUNSELING_STATUS_LABELS[c.status as CounselingStatus]}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {importing && <ImportFacultyDialog schoolId={schoolId} onImported={refresh} onClose={() => setImporting(false)} />}
      {uploads && <UploadsDialog schoolId={schoolId} structure={structure} initialTab={uploads} onClose={() => setUploads(null)} />}
      {profileId && !editing && (
        <FacultyProfileDialog schoolId={schoolId} facultyId={profileId} schoolName={schoolName} structure={structure} onChanged={refresh} onClose={() => openProfile(null)} />
      )}
      {editing && <EditFacultyDialog schoolId={schoolId} faculty={editing} structure={structure} onSaved={refresh} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          message={
            deleting.linked ? (
              <p>{deleting.name} signs in to this school, so their profile can’t be deleted here. Set their status to Inactive instead (Edit → Status).</p>
            ) : (
              <p>The imported profile, its batch assignments and appraisals are deleted. Material and assignments they uploaded stay, without their name.</p>
            )
          }
          confirmLabel={deleting.linked ? 'OK' : 'Delete'}
          onConfirm={async () => {
            if (deleting.linked) return
            await api(`/schools/${schoolId}/faculty/delete`, { method: 'POST', body: JSON.stringify({ ids: [deleting.id] }) })
            await refresh()
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  )
}
