import { useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarCheck, Filter, Loader2, Search, UserRound } from 'lucide-react'
import { ErrorBanner } from '@/components/ui/form'
import { ALL } from '@/features/academic/filters'
import { StudentAvatar } from '@/features/students/StudentAvatar'
import { formatDay } from '@/features/portal/format'
import {
  STUDENT_STATUS_LABELS,
  useTeacherRoster,
  useTeacherStudent,
  type StudentStatus,
  type TeacherStudentDetail,
} from '@/features/students/api'
import { useTeacherContext } from './useTeacherDashboard'

const pill =
  'h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 focus:outline-none'

/** Faculty roster (PRD 5.5): read-only, limited to the teacher's programs and batches. */
export function TeacherStudentsPage() {
  const { dashboard, structure, filters } = useTeacherContext()
  const [params, setParams] = useSearchParams()
  const sidebarProgram = filters.programId !== ALL ? filters.programId : ''
  const sidebarBatch = filters.batchId !== ALL ? filters.batchId : ''
  const [classLevel, setClassLevel] = useState('')
  const [batchId, setBatchId] = useState(sidebarBatch)
  const [status, setStatus] = useState<StudentStatus | ''>('')
  const [showFilter, setShowFilter] = useState(false)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  // A change in the sidebar's Program → Batch filters resets the page's batch.
  const sidebarKey = `${sidebarProgram}|${sidebarBatch}`
  const [syncedKey, setSyncedKey] = useState(sidebarKey)
  if (syncedKey !== sidebarKey) {
    setSyncedKey(sidebarKey)
    setBatchId(sidebarBatch)
  }
  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])

  const roster = useTeacherRoster({ q, classLevel, programId: sidebarProgram, batchId, status })
  const selected = params.get('student')
  const select = (id: string) => setParams({ student: id }, { replace: true })
  const detail = useTeacherStudent(selected)
  const classes = dashboard?.school?.classes ?? []
  const batches = (structure?.batches ?? []).filter((b) => !sidebarProgram || b.programId === sidebarProgram)

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-[26px]">Student Roster</h1>
          <p className="mt-1 text-sm text-slate-500">View and track students in your assigned programs &amp; batches</p>
        </div>
        <div className="flex gap-2">
          <select aria-label="Class" value={classLevel} onChange={(e) => setClassLevel(e.target.value)} className={pill}>
            <option value="">All Classes</option>
            {classes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select aria-label="Batch" value={batchId} onChange={(e) => setBatchId(e.target.value)} className={pill}>
            <option value="">All Batches</option>
            {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="flex max-h-[calc(100dvh-12rem)] min-h-[420px] flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4">
            <p className="text-sm font-bold text-slate-900">Students ({roster.data?.total ?? 0})</p>
            <button
              type="button"
              aria-label="Filter by status"
              aria-expanded={showFilter}
              onClick={() => setShowFilter((s) => !s)}
              className={`rounded p-1 ${status ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-700'}`}
            >
              <Filter className="size-4" />
            </button>
          </div>
          <div className="space-y-2 border-b border-slate-100 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search students..."
                aria-label="Search students"
                className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pr-3 pl-9 text-xs focus:bg-white focus:outline-none"
              />
            </div>
            {showFilter && (
              <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as StudentStatus | '')} className="h-9 w-full rounded-lg border border-slate-200 px-2 text-xs">
                <option value="">All statuses</option>
                {(Object.keys(STUDENT_STATUS_LABELS) as StudentStatus[]).map((s) => <option key={s} value={s}>{STUDENT_STATUS_LABELS[s]}</option>)}
              </select>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {roster.error && <div className="p-3"><ErrorBanner message={roster.error.message} /></div>}
            {roster.isPending ? (
              <Loader2 className="mx-auto my-10 size-5 animate-spin text-slate-300" aria-label="Loading" />
            ) : roster.data?.items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">No students found.</p>
            ) : (
              <ul>
                {roster.data?.items.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => select(s.id)}
                      aria-current={selected === s.id}
                      className={`flex w-full items-center gap-3 border-l-2 px-4 py-3 text-left transition ${
                        selected === s.id ? 'border-indigo-500 bg-indigo-50/60' : 'border-transparent hover:bg-slate-50'
                      }`}
                    >
                      <StudentAvatar name={s.fullName} photoUrl={s.photoUrl} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-slate-900">{s.fullName}</span>
                        <span className="block truncate text-[11px] text-slate-500">
                          {[s.classLevel && `Class ${s.classLevel}`, s.batch?.name ?? 'Unassigned', s.rollNumber && `Roll ${s.rollNumber}`].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <section>
          {!selected ? (
            <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white text-center shadow-sm">
              <UserRound className="size-14 text-slate-300" strokeWidth={1.5} />
              <p className="mt-4 text-lg font-bold text-slate-800">No Student Selected</p>
              <p className="mt-1 text-sm text-slate-500">Select a student from the roster to view their details.</p>
            </div>
          ) : detail.isPending ? (
            <Loader2 className="mx-auto my-24 size-6 animate-spin text-slate-300" aria-label="Loading" />
          ) : detail.error ? (
            <ErrorBanner message={detail.error.message} />
          ) : (
            detail.data && <StudentDetailView student={detail.data} />
          )}
        </section>
      </div>
    </>
  )
}

function Card({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-6 shadow-sm ${className ?? ''}`}>
      {title && <h2 className="mb-4 text-sm font-bold text-slate-900">{title}</h2>}
      {children}
    </div>
  )
}

const dash = (v: string | number | null) => (v === null || v === '' ? '—' : String(v))

function StudentDetailView({ student }: { student: TeacherStudentDetail }) {
  return (
    <div className="space-y-6">
      <Card>
        <div className="flex items-center gap-5">
          <StudentAvatar name={student.fullName} photoUrl={student.photoUrl} size="size-20 text-2xl" />
          <div>
            <p className="text-xl font-bold text-slate-900">{student.fullName}</p>
            <p className="mt-1 text-sm text-slate-600">
              Class {student.classLevel ?? 'N/A'} • {student.batch?.name ?? 'Unassigned Batch'} • Roll No. {student.rollNumber ?? 'N/A'}
            </p>
          </div>
        </div>
      </Card>

      <Card title="Student Information">
        <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-4">
          {[
            ['Gender', dash(student.gender)],
            ['Previous School', dash(student.previousSchool)],
            ['Previous %', student.previousPercentage === null ? '—' : `${student.previousPercentage}%`],
            ['Admission Date', student.admissionDate ? formatDay(student.admissionDate) : '—'],
            ['Status', STUDENT_STATUS_LABELS[student.status]],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-slate-500">{label}</dt>
              <dd className="mt-1 text-sm font-medium text-slate-800">{value}</dd>
            </div>
          ))}
          {student.notes && (
            <div className="sm:col-span-4">
              <dt className="text-xs text-slate-500">Notes</dt>
              <dd className="mt-1 text-sm font-medium whitespace-pre-line text-slate-800">{student.notes}</dd>
            </div>
          )}
        </dl>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Current Performance Average">
          {/* Filled from test results and attendance once those modules record data for this student. */}
          <p className="text-sm text-slate-500 italic">No performance data uploaded yet.</p>
          <div className="mt-5 flex items-center gap-4 rounded-xl border border-emerald-100 bg-emerald-50/40 p-4">
            <span className="flex size-14 items-center justify-center rounded-full border-4 border-emerald-100 text-slate-400">
              <CalendarCheck className="size-5" />
            </span>
            <div>
              <p className="text-sm font-bold text-slate-900">Attendance</p>
              <p className="text-xs text-slate-500">No attendance recorded yet.</p>
            </div>
          </div>
        </Card>
        <div className="space-y-6">
          <Card title="Recent Tests">
            <p className="text-center text-sm text-slate-500">No tests logged.</p>
          </Card>
          <Card title="Batch Enrollments">
            {student.enrollments.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No batch enrollments recorded.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {student.enrollments.map((e) => (
                  <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-medium text-slate-800">
                      {e.batch} <span className="text-xs text-slate-400">({e.program})</span>
                      {!e.batchExists && <span className="ml-1 text-xs text-slate-400 italic">· batch deleted</span>}
                    </span>
                    <span className="text-xs text-slate-500">
                      {e.rollNumber && `Roll ${e.rollNumber} · `}
                      {e.enrolledOn ? formatDay(e.enrolledOn) : '—'}
                      {e.endedOn ? ` – ${formatDay(e.endedOn)}` : ' – now'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Counseling Notes">
            <p className="text-center text-sm text-slate-500 italic">No counseling notes found.</p>
          </Card>
        </div>
      </div>
    </div>
  )
}
