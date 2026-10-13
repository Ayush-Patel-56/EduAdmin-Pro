import { useState, type ReactNode } from 'react'
import { BookOpen, Download, GraduationCap, Layers, Loader2, Mail, Plus, Star, Users, X } from 'lucide-react'
import { api } from '@/lib/api'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner } from '@/components/ui/form'
import type { Structure } from '@/features/academic/api'
import { FACULTY_STATUS_LABELS } from '@/features/academic/api'
import {
  BATCH_ROLE_LABELS,
  DESIGNATION_LABELS,
  facultyApi,
  useFacultyDetail,
  type BatchRole,
  type Designation,
  type FacultyDetail,
} from '@/features/faculty/api'
import { formatDay } from '@/features/portal/format'
import { StudentAvatar } from '@/features/students/StudentAvatar'
import { downloadCv } from './cv'

const dash = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '—' : String(v))
const STATUS_STYLE = {
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  ON_LEAVE: 'bg-amber-50 text-amber-700',
  INACTIVE: 'bg-slate-100 text-slate-500',
} as const

function Section({ icon: Icon, title, children }: { icon: typeof Mail; title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 border-b border-slate-100 pb-2 text-xs font-extrabold tracking-[0.12em] text-slate-900 uppercase">
        <Icon className="size-4 text-slate-400" /> {title}
      </h3>
      {children}
    </section>
  )
}

export function Item({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">{label}</p>
      <p className="mt-1 text-sm break-words text-slate-800">{value}</p>
    </div>
  )
}

/** Personal & Contact and Professional Profile blocks, shared with the teacher's own My Profile. */
export function ProfileFacts({ f }: { f: FacultyDetail }) {
  return (
    <>
      <Section icon={Mail} title="Personal & Contact">
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
          <Item label="Email" value={dash(f.email)} />
          <Item label="Phone" value={dash(f.phone)} />
          <Item label="Alt Phone" value={dash(f.altPhone)} />
          <Item label="Date of Birth" value={f.dateOfBirth ? formatDay(f.dateOfBirth) : '—'} />
          <Item label="Gender" value={dash(f.gender)} />
          <Item label="Address" value={[f.address, f.city, f.state, f.pincode].filter(Boolean).join(', ') || '—'} />
        </div>
      </Section>
      <Section icon={GraduationCap} title="Professional Profile">
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
          <Item label="Qualification" value={dash(f.qualification)} />
          <Item label="Experience" value={f.experienceYears === null ? '—' : `${f.experienceYears} yr${f.experienceYears === 1 ? '' : 's'}`} />
          <Item label="Primary Stream" value={dash(f.primaryStream)} />
          <Item label="Joining Date" value={f.joiningDate ? formatDay(f.joiningDate) : '—'} />
          <Item label="Specialization" value={dash(f.specialization)} />
          <Item label="Linked User Account" value={f.linked ? 'Linked ✓' : 'Not linked (imported profile)'} />
        </div>
      </Section>
    </>
  )
}

type Props = {
  schoolId: string
  facultyId: string
  schoolName: string
  structure: Structure | undefined
  onChanged: () => Promise<unknown>
  onClose: () => void
}

/** The admin's view of one teacher (PRD 4.7): details, role, subjects and batch assignments. */
export function FacultyProfileDialog({ schoolId, facultyId, schoolName, structure, onChanged, onClose }: Props) {
  const { data: f, error, isPending, refetch } = useFacultyDetail(schoolId, facultyId)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [subject, setSubject] = useState('')
  const [makePrimary, setMakePrimary] = useState(true)
  const [batchId, setBatchId] = useState('')
  const [role, setRole] = useState<BatchRole>('PRIMARY')
  const [cvBusy, setCvBusy] = useState(false)
  const url = facultyApi(schoolId, facultyId)

  async function act(run: () => Promise<unknown>) {
    setBusy(true)
    setActionError(null)
    try {
      await run()
      await Promise.all([refetch(), onChanged()])
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }
  const saveSubjects = (subjects: string[], primarySubject: string | null) =>
    act(() => api(`${url}/subjects`, { method: 'PUT', body: JSON.stringify({ subjects, primarySubject }) }))

  const assigned = new Set(f?.batches.map((b) => b.id))
  const freeBatches = (structure?.batches ?? []).filter((b) => !assigned.has(b.id))
  const programName = (programId: string) => structure?.programs.find((p) => p.id === programId)?.name ?? ''

  return (
    <Dialog title="Faculty Profile" onClose={onClose} widthClass="max-w-3xl">
      <div className="space-y-7 px-6 py-5">
        <ErrorBanner message={error?.message} />
        {isPending && <Loader2 className="mx-auto size-6 animate-spin text-slate-300" aria-label="Loading" />}
        {f && (
          <>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-4">
                <StudentAvatar name={f.name} photoUrl={f.photoUrl} size="size-16 text-xl" tone="bg-ink text-white" />
                <div>
                  <p className="text-xl font-bold text-slate-900">{f.name}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                    {f.primarySubject ?? 'No subject yet'}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[f.status]}`}>{FACULTY_STATUS_LABELS[f.status]}</span>
                  </p>
                  <select
                    aria-label="Role"
                    value={f.designation}
                    disabled={busy}
                    onChange={(e) =>
                      void act(() => api(`${url}/designation`, { method: 'PUT', body: JSON.stringify({ designation: e.target.value as Designation }) }))
                    }
                    className="mt-1.5 h-7 rounded-md border border-violet-200 bg-violet-50 px-2 text-[11px] font-bold text-violet-700"
                  >
                    {(Object.keys(DESIGNATION_LABELS) as Designation[]).map((d) => <option key={d} value={d}>{DESIGNATION_LABELS[d]}</option>)}
                  </select>
                </div>
              </div>
              <button
                type="button"
                disabled={cvBusy}
                onClick={async () => {
                  setCvBusy(true)
                  try {
                    await downloadCv(f, schoolName)
                  } catch (err) {
                    setActionError(err instanceof Error ? err.message : 'Could not create the CV')
                  } finally {
                    setCvBusy(false)
                  }
                }}
                className="inline-flex h-9 items-center gap-1.5 self-start rounded-lg bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
              >
                {cvBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />} Export CV
              </button>
            </div>
            <ErrorBanner message={actionError} />

            <ProfileFacts f={f} />

            <Section icon={Layers} title="Programs Assigned">
              {f.programs.length === 0 ? (
                <p className="text-xs text-slate-400 italic">
                  No programs assigned — this teacher can see students across every program. Assigning a batch below will auto-assign its program.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {f.programs.map((p) => <span key={p.id} className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">{p.name}</span>)}
                </div>
              )}
            </Section>

            <Section icon={BookOpen} title="Subjects Taught">
              <div className="flex flex-wrap gap-2">
                {f.subjects.length === 0 && <p className="text-xs text-slate-400 italic">No subjects yet.</p>}
                {f.subjects.map((s) => {
                  const primary = s === f.primarySubject
                  return (
                    <span key={s} className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${primary ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-700'}`}>
                      <button
                        type="button"
                        title={primary ? 'Primary subject' : 'Make primary'}
                        disabled={busy || primary}
                        onClick={() => void saveSubjects(f.subjects, s)}
                        className="inline-flex items-center gap-1"
                      >
                        {s} <Star className={`size-3 ${primary ? 'fill-current' : 'text-slate-300'}`} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${s}`}
                        disabled={busy}
                        onClick={() => void saveSubjects(f.subjects.filter((x) => x !== s), primary ? null : f.primarySubject)}
                        className="text-slate-400 hover:text-red-600"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  )
                })}
              </div>
              <form
                className="mt-3 flex flex-wrap items-center gap-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  const name = subject.trim()
                  if (!name) return setActionError('Type a subject to add')
                  void saveSubjects([...f.subjects, name], makePrimary ? name : f.primarySubject).then(() => setSubject(''))
                }}
              >
                <input
                  aria-label="Subject"
                  value={subject}
                  maxLength={40}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Physics"
                  className="h-10 w-44 rounded-lg border border-slate-200 px-3 text-sm focus:border-indigo-300 focus:outline-none"
                />
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  <input type="checkbox" checked={makePrimary} onChange={(e) => setMakePrimary(e.target.checked)} className="size-4 accent-indigo-600" /> Primary
                </label>
                <button type="submit" disabled={busy} className="inline-flex h-9 items-center gap-1 rounded-lg bg-ink px-3 text-xs font-semibold text-white disabled:opacity-60">
                  <Plus className="size-3.5" /> Add
                </button>
              </form>
            </Section>

            <Section icon={Users} title="Batch Assignments">
              {f.batches.length === 0 ? (
                <p className="text-xs text-slate-400 italic">No batches assigned.</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {f.batches.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span>
                        <span className="font-semibold text-slate-800">{b.name}</span> <span className="text-xs text-slate-400">({b.program})</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <select
                          aria-label={`Role in ${b.name}`}
                          value={b.role}
                          disabled={busy}
                          onChange={(e) => void act(() => api(`${url}/batches`, { method: 'POST', body: JSON.stringify({ batchId: b.id, role: e.target.value }) }))}
                          className="h-8 rounded-md border border-slate-200 px-2 text-xs"
                        >
                          {(Object.keys(BATCH_ROLE_LABELS) as BatchRole[]).map((r) => <option key={r} value={r}>{BATCH_ROLE_LABELS[r]}</option>)}
                        </select>
                        <button
                          type="button"
                          aria-label={`Remove from ${b.name}`}
                          disabled={busy}
                          onClick={() => void act(() => api(`${url}/batches/${b.id}`, { method: 'DELETE' }))}
                          className="rounded p-1 text-slate-400 hover:text-red-600"
                        >
                          <X className="size-4" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <form
                className="mt-3 flex flex-wrap items-center gap-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!batchId) return setActionError('Select a batch to assign')
                  void act(() => api(`${url}/batches`, { method: 'POST', body: JSON.stringify({ batchId, role }) })).then(() => setBatchId(''))
                }}
              >
                <select aria-label="Batch" value={batchId} onChange={(e) => setBatchId(e.target.value)} className="h-10 min-w-48 rounded-lg border border-slate-200 px-3 text-sm">
                  <option value="">Select a batch...</option>
                  {freeBatches.map((b) => <option key={b.id} value={b.id}>{b.name} ({programName(b.programId)})</option>)}
                </select>
                <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as BatchRole)} className="h-10 rounded-lg border border-slate-200 px-3 text-sm">
                  {(Object.keys(BATCH_ROLE_LABELS) as BatchRole[]).map((r) => <option key={r} value={r}>{BATCH_ROLE_LABELS[r]}</option>)}
                </select>
                <button type="submit" disabled={busy} className="inline-flex h-9 items-center gap-1 rounded-lg bg-ink px-3 text-xs font-semibold text-white disabled:opacity-60">
                  <Plus className="size-3.5" /> Assign
                </button>
              </form>
            </Section>
          </>
        )}
      </div>
    </Dialog>
  )
}
