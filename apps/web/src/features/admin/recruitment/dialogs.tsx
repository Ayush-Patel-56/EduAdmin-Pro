import { useState, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Building2, Lightbulb } from 'lucide-react'
import { api } from '@/lib/api'
import { isValidIndianMobile, EMAIL_PATTERN } from '@/lib/validators'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner } from '@/components/ui/form'
import { btnSecondary } from '@/components/ui/formStyles'
import type { Faculty } from '@/features/academic/api'
import {
  APPRAISAL_STATUS_LABELS,
  BADGE_LABELS,
  JOB_STATUS_LABELS,
  MODE_LABELS,
  PERIOD_LABELS,
  RATING_LABELS,
  RESULT_LABELS,
  STAGE_LABELS,
  useCandidates,
  useMySchools,
  useRecruitmentOptions,
  useRecruitmentWrite,
  type Appraisal,
  type AppraisalBadge,
  type Candidate,
  type Interview,
  type Requirement,
  type SchoolLite,
} from './api'

const label = 'mb-1.5 block text-[11px] font-bold tracking-wide text-slate-700 uppercase'
const field =
  'h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100 focus:outline-none'
const area = field.replace('h-11 ', '') + ' resize-y py-2.5'

function F({ id, text, children, className }: { id: string; text: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={id} className={label}>{text}</label>
      {children}
    </div>
  )
}

function Footer({ busy, submitLabel, onCancel }: { busy: boolean; submitLabel: string; onCancel: () => void }) {
  return (
    <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
      <button type="button" onClick={onCancel} className={btnSecondary}>Cancel</button>
      <button
        type="submit"
        disabled={busy}
        className="inline-flex h-10 items-center rounded-lg bg-emerald-500 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-600 disabled:opacity-60"
      >
        {busy ? 'Saving…' : submitLabel}
      </button>
    </div>
  )
}

/** Shared submit plumbing: client checks first, then the API (which re-validates everything). */
function useSubmit(onDone: () => void) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function run(check: () => string | null, save: () => Promise<unknown>) {
    const problem = check()
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    try {
      await save()
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
      setBusy(false)
    }
  }
  return { error, busy, run, clear: () => setError(null) }
}

function SchoolPicker({ schools, value, onChange, locked }: { schools: SchoolLite[] | undefined; value: string; onChange: (id: string) => void; locked: boolean }) {
  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
      <label htmlFor="target-school" className="mb-2 flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-indigo-900 uppercase">
        <Building2 className="size-4 text-emerald-600" /> Target school * (connected to {schools?.length ?? 0} school{schools?.length === 1 ? '' : 's'} you manage)
      </label>
      <select id="target-school" value={value} disabled={locked} onChange={(e) => onChange(e.target.value)} className={`${field} border-indigo-200 bg-white font-semibold`}>
        {schools?.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.board})</option>)}
      </select>
      <p className="mt-1.5 flex items-center gap-1 text-[11px] text-indigo-700">
        <Lightbulb className="size-3 text-amber-500" />
        {locked ? 'A saved record stays with its school.' : 'Admin can select from the schools connected to their account.'}
      </p>
    </div>
  )
}

// Job requirement

export function RequirementDialog({ item, defaultSchoolId, onClose }: { item?: Requirement; defaultSchoolId: string; onClose: () => void }) {
  const { data: options } = useRecruitmentOptions()
  const { data: schools } = useMySchools()
  const write = useRecruitmentWrite()
  const { error, busy, run, clear } = useSubmit(onClose)
  const [v, setV] = useState(() => ({
    schoolId: item?.schoolId ?? defaultSchoolId,
    title: item?.title ?? '',
    subject: item?.subject ?? '',
    department: item?.department ?? 'Science',
    vacancies: String(item?.vacancies ?? 1),
    status: item?.status ?? 'OPEN',
    experience: item?.experience ?? '',
    qualification: item?.qualification ?? '',
    postingDate: item?.postingDate ?? new Date().toISOString().slice(0, 10),
    closingDate: item?.closingDate ?? '',
  }))
  const set = (k: keyof typeof v, value: string) => {
    setV((p) => ({ ...p, [k]: value }))
    clear()
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void run(
      () =>
        !v.title.trim()
          ? 'Job title is required'
          : !v.subject.trim()
            ? 'Subject / program is required'
            : !/^\d+$/.test(v.vacancies) || Number(v.vacancies) < 1
              ? 'Vacancies must be at least 1'
              : v.postingDate && v.closingDate && v.closingDate < v.postingDate
                ? 'Closing date must be on or after the posting date'
                : null,
      () => write(item ? `/requirements/${item.id}` : '/requirements', item ? 'PATCH' : 'POST', { ...v, vacancies: Number(v.vacancies) }),
    )
  }

  return (
    <Dialog title={item ? 'Edit Job Requirement' : 'Add Job Requirement'} onClose={onClose} widthClass="max-w-2xl">
      <form onSubmit={submit} noValidate className="space-y-4 px-6 py-5">
        <SchoolPicker schools={schools} value={v.schoolId} onChange={(id) => set('schoolId', id)} locked={!!item} />
        <div className="grid gap-4 sm:grid-cols-2">
          <F id="req-title" text="Job title *"><input id="req-title" value={v.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Senior Physics Faculty" maxLength={120} autoFocus className={field} /></F>
          <F id="req-subject" text="Subject / program *"><input id="req-subject" value={v.subject} onChange={(e) => set('subject', e.target.value)} placeholder="e.g. Physics — JEE" maxLength={120} className={field} /></F>
          <F id="req-dept" text="Department">
            <select id="req-dept" value={v.department} onChange={(e) => set('department', e.target.value)} className={field}>
              {options?.departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </F>
          <div className="grid grid-cols-2 gap-3">
            <F id="req-vacancies" text="Vacancies"><input id="req-vacancies" type="number" min={1} max={500} value={v.vacancies} onChange={(e) => set('vacancies', e.target.value)} className={field} /></F>
            <F id="req-status" text="Status">
              <select id="req-status" value={v.status} onChange={(e) => set('status', e.target.value)} className={field}>
                {options?.jobStatuses.map((s) => <option key={s} value={s}>{JOB_STATUS_LABELS[s]}</option>)}
              </select>
            </F>
          </div>
          <F id="req-exp" text="Experience"><input id="req-exp" value={v.experience} onChange={(e) => set('experience', e.target.value)} placeholder="e.g. 3+ years" maxLength={60} className={field} /></F>
          <F id="req-qual" text="Qualification"><input id="req-qual" value={v.qualification} onChange={(e) => set('qualification', e.target.value)} placeholder="e.g. M.Sc. Physics, B.Ed." maxLength={200} className={field} /></F>
          <F id="req-post" text="Posting date"><input id="req-post" type="date" value={v.postingDate} onChange={(e) => set('postingDate', e.target.value)} className={field} /></F>
          <F id="req-close" text="Closing date"><input id="req-close" type="date" min={v.postingDate || undefined} value={v.closingDate} onChange={(e) => set('closingDate', e.target.value)} className={field} /></F>
        </div>
        <ErrorBanner message={error} />
        <Footer busy={busy} submitLabel={item ? 'Save Changes' : 'Save Requirement'} onCancel={onClose} />
      </form>
    </Dialog>
  )
}

// Candidate

export function CandidateDialog({ item, defaultSchoolId, onClose }: { item?: Candidate; defaultSchoolId: string; onClose: () => void }) {
  const { data: options } = useRecruitmentOptions()
  const { data: schools } = useMySchools()
  const write = useRecruitmentWrite()
  const [hiredNote, setHiredNote] = useState<string | null>(null)
  const { error, busy, run, clear } = useSubmit(() => (hiredNote ? undefined : onClose()))
  const [v, setV] = useState({
    schoolId: item?.schoolId ?? defaultSchoolId,
    fullName: item?.fullName ?? '',
    roleApplied: item?.roleApplied ?? '',
    email: item?.email ?? '',
    phone: item?.phone ?? '',
    department: item?.department ?? 'Science',
    experienceYears: item?.experienceYears?.toString() ?? '',
    stage: item?.stage ?? 'APPLIED',
    qualification: item?.qualification ?? '',
    currentOrganization: item?.currentOrganization ?? '',
    expectedSalary: item?.expectedSalary?.toString() ?? '',
    resumeUrl: item?.resumeUrl ?? '',
  })
  const set = (k: keyof typeof v, value: string) => {
    setV((p) => ({ ...p, [k]: value }))
    clear()
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void run(
      () =>
        !v.fullName.trim()
          ? 'Full name is required'
          : !v.roleApplied.trim()
            ? 'Role applied is required'
            : v.email.trim() && !EMAIL_PATTERN.test(v.email.trim())
              ? 'Please enter a valid email address'
              : v.phone.trim() && !isValidIndianMobile(v.phone)
                ? 'Please enter a valid 10-digit mobile number'
                : v.resumeUrl.trim() && !/^https?:\/\/\S+$/i.test(v.resumeUrl.trim())
                  ? 'Resume link must start with http(s)://'
                  : null,
      async () => {
        const result = await write<{ facultyCreated: { name: string } | null }>(item ? `/candidates/${item.id}` : '/candidates', item ? 'PATCH' : 'POST', {
          ...v,
          experienceYears: v.experienceYears === '' ? null : Number(v.experienceYears),
          expectedSalary: v.expectedSalary === '' ? null : Number(v.expectedSalary.replace(/[^\d]/g, '')),
        })
        if (result.facultyCreated) {
          setHiredNote(`${result.facultyCreated.name} was hired and added to the school’s faculty (Academic Planning → Faculty).`)
        }
      },
    )
  }

  if (hiredNote) {
    return (
      <Dialog title="Candidate hired" onClose={onClose} widthClass="max-w-md">
        <div className="space-y-4 px-6 py-5 text-sm text-slate-700">
          <p>{hiredNote}</p>
          <div className="flex justify-end"><button type="button" onClick={onClose} className={btnSecondary}>Done</button></div>
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog title={item ? 'Edit Candidate Profile' : 'Add New Candidate Profile'} onClose={onClose} widthClass="max-w-2xl">
      <form onSubmit={submit} noValidate className="space-y-4 px-6 py-5">
        <SchoolPicker schools={schools} value={v.schoolId} onChange={(id) => set('schoolId', id)} locked={!!item} />
        <div className="grid gap-4 sm:grid-cols-2">
          <F id="cand-name" text="Full name *"><input id="cand-name" value={v.fullName} onChange={(e) => set('fullName', e.target.value)} placeholder="e.g. Dr. Sarah Jenkins" maxLength={120} autoFocus className={field} /></F>
          <F id="cand-role" text="Role applied *"><input id="cand-role" value={v.roleApplied} onChange={(e) => set('roleApplied', e.target.value)} placeholder="e.g. Physics Faculty" maxLength={120} className={field} /></F>
          <F id="cand-email" text="Email address"><input id="cand-email" type="email" value={v.email} onChange={(e) => set('email', e.target.value)} placeholder="sarah.j@example.com" maxLength={254} className={field} /></F>
          <F id="cand-phone" text="Phone number"><input id="cand-phone" type="tel" value={v.phone} onChange={(e) => set('phone', e.target.value)} placeholder="9876543210" maxLength={16} className={field} /></F>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <F id="cand-dept" text="Department">
            <select id="cand-dept" value={v.department} onChange={(e) => set('department', e.target.value)} className={field}>
              {options?.departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </F>
          <F id="cand-exp" text="Experience (years)"><input id="cand-exp" type="number" min={0} max={60} value={v.experienceYears} onChange={(e) => set('experienceYears', e.target.value)} placeholder="3" className={field} /></F>
          <F id="cand-stage" text="Workflow status">
            <select id="cand-stage" value={v.stage} onChange={(e) => set('stage', e.target.value)} className={`${field} font-semibold`}>
              {options?.candidateStages.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
            </select>
          </F>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <F id="cand-qual" text="Qualification"><input id="cand-qual" value={v.qualification} onChange={(e) => set('qualification', e.target.value)} placeholder="Ph.D in Applied Physics" maxLength={200} className={field} /></F>
          <F id="cand-org" text="Current organization"><input id="cand-org" value={v.currentOrganization} onChange={(e) => set('currentOrganization', e.target.value)} placeholder="St. Jude International School" maxLength={200} className={field} /></F>
          <F id="cand-salary" text="Expected salary (₹ / yr)"><input id="cand-salary" inputMode="numeric" value={v.expectedSalary} onChange={(e) => set('expectedSalary', e.target.value.replace(/[^\d]/g, ''))} placeholder="₹75,000 / yr" maxLength={10} className={field} /></F>
          <F id="cand-resume" text="Resume / CV link (URL)"><input id="cand-resume" type="url" value={v.resumeUrl} onChange={(e) => set('resumeUrl', e.target.value)} placeholder="https://drive.google.com/..." maxLength={500} className={field} /></F>
        </div>
        {v.stage === 'HIRED' && item?.stage !== 'HIRED' && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Saving as Hired also adds this person to the school’s faculty.</p>
        )}
        <ErrorBanner message={error} />
        <Footer busy={busy} submitLabel={item ? 'Save Changes' : 'Save Candidate'} onCancel={onClose} />
      </form>
    </Dialog>
  )
}

// Interview

const toLocalInput = (iso: string) => {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function InterviewDialog({ item, candidateId, onClose }: { item?: Interview; candidateId?: string; onClose: () => void }) {
  const { data: options } = useRecruitmentOptions()
  const { data: candidates } = useCandidates({})
  const write = useRecruitmentWrite()
  const { error, busy, run, clear } = useSubmit(onClose)
  const [v, setV] = useState({
    candidateId: item?.candidate.id ?? candidateId ?? '',
    scheduledAt: item ? toLocalInput(item.scheduledAt) : '',
    mode: item?.mode ?? 'IN_PERSON',
    location: item?.location ?? '',
    panel: item?.panel ?? '',
    rating: item?.rating?.toString() ?? '',
    result: item?.result ?? 'PENDING',
    feedback: item?.feedback ?? '',
  })
  const set = (k: keyof typeof v, value: string) => {
    setV((p) => ({ ...p, [k]: value }))
    clear()
  }
  const selectable = candidates?.filter((c) => c.stage !== 'REJECTED' || c.id === v.candidateId) ?? []

  function submit(e: FormEvent) {
    e.preventDefault()
    void run(
      () => (!v.candidateId ? 'Select a candidate' : !v.scheduledAt || Number.isNaN(new Date(v.scheduledAt).getTime()) ? 'Date & time is required' : null),
      () =>
        write(item ? `/interviews/${item.id}` : '/interviews', item ? 'PATCH' : 'POST', {
          ...v,
          // The picker gives local time; send an exact instant.
          scheduledAt: new Date(v.scheduledAt).toISOString(),
          rating: v.rating === '' ? null : Number(v.rating),
        }),
    )
  }

  return (
    <Dialog title={item ? 'Edit Interview' : 'Schedule / Log Interview'} onClose={onClose} widthClass="max-w-2xl">
      <form onSubmit={submit} noValidate className="space-y-4 px-6 py-5">
        <F id="int-cand" text="Candidate *">
          <select id="int-cand" value={v.candidateId} disabled={!!item} onChange={(e) => set('candidateId', e.target.value)} className={field}>
            <option value="">{candidates?.length === 0 ? 'No candidates yet — add one first' : 'Select candidate…'}</option>
            {selectable.map((c) => (
              <option key={c.id} value={c.id}>{c.fullName} — {c.roleApplied} ({c.schoolName}, {STAGE_LABELS[c.stage]})</option>
            ))}
          </select>
        </F>
        <div className="grid gap-4 sm:grid-cols-2">
          <F id="int-when" text="Date & time *"><input id="int-when" type="datetime-local" value={v.scheduledAt} onChange={(e) => set('scheduledAt', e.target.value)} className={field} /></F>
          <F id="int-mode" text="Mode">
            <select id="int-mode" value={v.mode} onChange={(e) => set('mode', e.target.value)} className={field}>
              {options?.interviewModes.map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
            </select>
          </F>
          <F id="int-loc" text={v.mode === 'ONLINE' ? 'Meeting link' : 'Location'}>
            <input id="int-loc" value={v.location} onChange={(e) => set('location', e.target.value)} placeholder={v.mode === 'ONLINE' ? 'https://meet.google.com/...' : 'e.g. Principal’s office, Block A'} maxLength={300} className={field} />
          </F>
          <F id="int-panel" text="Interviewer panel"><input id="int-panel" value={v.panel} onChange={(e) => set('panel', e.target.value)} placeholder="e.g. Dr. Rao, Ms. Mehta" maxLength={300} className={field} /></F>
          <F id="int-rating" text="Rating">
            <select id="int-rating" value={v.rating} onChange={(e) => set('rating', e.target.value)} className={field}>
              <option value="">Not rated yet</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} — {RATING_LABELS[n]}</option>)}
            </select>
          </F>
          <F id="int-result" text="Final result">
            <select id="int-result" value={v.result} onChange={(e) => set('result', e.target.value)} className={field}>
              {options?.interviewResults.map((r) => <option key={r} value={r}>{RESULT_LABELS[r]}</option>)}
            </select>
          </F>
        </div>
        <F id="int-feedback" text="Feedback"><textarea id="int-feedback" value={v.feedback} onChange={(e) => set('feedback', e.target.value)} rows={3} maxLength={2000} placeholder="Subject knowledge, demo class, communication…" className={area} /></F>
        {!item && <p className="text-[11px] text-slate-500">Booking an interview moves an Applied or Shortlisted candidate to Interview Scheduled.</p>}
        <ErrorBanner message={error} />
        <Footer busy={busy} submitLabel={item ? 'Save Changes' : 'Save Interview'} onCancel={onClose} />
      </form>
    </Dialog>
  )
}

// Appraisal

function currentAcademicYear(startMonth: number) {
  const now = new Date()
  const start = now.getMonth() + 1 >= startMonth ? now.getFullYear() : now.getFullYear() - 1
  return `${start}-${start + 1}`
}

function suggestBadge(teaching: string, punctuality: string): AppraisalBadge | null {
  const scores = [teaching, punctuality].filter(Boolean).map(Number)
  if (scores.length === 0) return null
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length
  return avg >= 4.5 ? 'EXCELLENT' : avg >= 3.5 ? 'GOOD' : avg >= 2.5 ? 'SATISFACTORY' : 'NEEDS_IMPROVEMENT'
}

export function AppraisalDialog({ item, defaultSchoolId, onClose }: { item?: Appraisal; defaultSchoolId: string; onClose: () => void }) {
  const { data: options } = useRecruitmentOptions()
  const { data: schools } = useMySchools()
  const write = useRecruitmentWrite()
  const { error, busy, run, clear } = useSubmit(onClose)
  const [v, setV] = useState({
    schoolId: item?.schoolId ?? defaultSchoolId,
    facultyId: item?.faculty.id ?? '',
    department: item?.department ?? '',
    period: item?.period ?? 'ANNUAL',
    academicYear: item?.academicYear ?? '',
    status: item?.status ?? 'PENDING',
    teachingScore: item?.teachingScore?.toString() ?? '',
    punctualityScore: item?.punctualityScore?.toString() ?? '',
    overallBadge: item?.overallBadge ?? '',
    remarks: item?.remarks ?? '',
    improvementAreas: item?.improvementAreas ?? '',
  })
  const { data: faculty, isPending: facultyLoading } = useQuery({
    queryKey: [v.schoolId, 'faculty'],
    queryFn: () => api<Faculty[]>(`/schools/${v.schoolId}/faculty`),
    enabled: !!v.schoolId,
  })
  const school = schools?.find((s) => s.id === v.schoolId)
  const academicYear = v.academicYear || currentAcademicYear(school?.academicYearStartMonth ?? 4)
  const suggested = suggestBadge(v.teachingScore, v.punctualityScore)
  const set = (k: keyof typeof v, value: string) => {
    setV((p) => ({ ...p, [k]: value, ...(k === 'schoolId' && { facultyId: '' }) }))
    clear()
  }
  const score = (id: string, text: string, key: 'teachingScore' | 'punctualityScore') => (
    <F id={id} text={text}>
      <select id={id} value={v[key]} onChange={(e) => set(key, e.target.value)} className={field}>
        <option value="">Not scored</option>
        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} / 5</option>)}
      </select>
    </F>
  )

  function submit(e: FormEvent) {
    e.preventDefault()
    void run(
      () => (!v.facultyId ? 'Select the teacher' : !/^\d{4}-\d{4}$/.test(academicYear) ? 'Academic year must look like 2026-2027' : null),
      () =>
        write(item ? `/appraisals/${item.id}` : '/appraisals', item ? 'PATCH' : 'POST', {
          ...v,
          academicYear,
          teachingScore: v.teachingScore === '' ? null : Number(v.teachingScore),
          punctualityScore: v.punctualityScore === '' ? null : Number(v.punctualityScore),
          overallBadge: v.overallBadge || null,
        }),
    )
  }

  return (
    <Dialog title={item ? 'Edit Teacher Appraisal' : 'New Teacher Appraisal'} onClose={onClose} widthClass="max-w-2xl">
      <form onSubmit={submit} noValidate className="space-y-4 px-6 py-5">
        <SchoolPicker schools={schools} value={v.schoolId} onChange={(id) => set('schoolId', id)} locked={!!item} />
        <div className="grid gap-4 sm:grid-cols-2">
          <F id="apr-teacher" text="Teacher name *">
            <select id="apr-teacher" value={v.facultyId} onChange={(e) => set('facultyId', e.target.value)} className={field}>
              <option value="">{facultyLoading ? 'Loading faculty…' : faculty?.length === 0 ? 'No faculty in this school yet' : 'Select teacher…'}</option>
              {faculty?.map((f) => <option key={f.id} value={f.id}>{f.name}{f.subjects.length ? ` — ${f.subjects.join(', ')}` : ''}</option>)}
            </select>
          </F>
          <F id="apr-dept" text="Department">
            <select id="apr-dept" value={v.department} onChange={(e) => set('department', e.target.value)} className={field}>
              <option value="">—</option>
              {options?.departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </F>
          <F id="apr-period" text="Period">
            <select id="apr-period" value={v.period} onChange={(e) => set('period', e.target.value)} className={field}>
              {options?.appraisalPeriods.map((p) => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}
            </select>
          </F>
          <F id="apr-year" text="Academic year"><input id="apr-year" value={academicYear} onChange={(e) => set('academicYear', e.target.value)} placeholder="2026-2027" maxLength={9} className={field} /></F>
          <F id="apr-status" text="Review status">
            <select id="apr-status" value={v.status} onChange={(e) => set('status', e.target.value)} className={field}>
              {options?.appraisalStatuses.map((s) => <option key={s} value={s}>{APPRAISAL_STATUS_LABELS[s]}</option>)}
            </select>
          </F>
          <F id="apr-avg" text="Student avg (auto)">
            <input id="apr-avg" disabled value={item?.studentAvg !== null && item?.studentAvg !== undefined ? `${item.studentAvg}%` : 'Filled automatically from test results'} className={`${field} text-slate-500`} />
          </F>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {score('apr-teaching', 'Teaching (1–5)', 'teachingScore')}
          {score('apr-punctuality', 'Punctuality (1–5)', 'punctualityScore')}
          <F id="apr-badge" text="Overall badge">
            <select id="apr-badge" value={v.overallBadge} onChange={(e) => set('overallBadge', e.target.value)} className={field}>
              <option value="">{suggested ? `Suggested: ${BADGE_LABELS[suggested]}` : 'Not set'}</option>
              {options?.appraisalBadges.map((b) => <option key={b} value={b}>{BADGE_LABELS[b]}</option>)}
            </select>
          </F>
        </div>
        {suggested && !v.overallBadge && (
          <button type="button" onClick={() => set('overallBadge', suggested)} className="text-xs font-semibold text-indigo-600 hover:underline">
            Use suggested badge ({BADGE_LABELS[suggested]}, from the scores)
          </button>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <F id="apr-remarks" text="Remarks & goals"><textarea id="apr-remarks" value={v.remarks} onChange={(e) => set('remarks', e.target.value)} rows={3} maxLength={2000} className={area} /></F>
          <F id="apr-improve" text="Improvement areas"><textarea id="apr-improve" value={v.improvementAreas} onChange={(e) => set('improvementAreas', e.target.value)} rows={3} maxLength={2000} className={area} /></F>
        </div>
        <ErrorBanner message={error} />
        <Footer busy={busy} submitLabel={item ? 'Save Changes' : 'Save Appraisal'} onCancel={onClose} />
      </form>
    </Dialog>
  )
}
