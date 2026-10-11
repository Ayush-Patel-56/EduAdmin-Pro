import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type Stage =
  | 'APPLIED'
  | 'SHORTLISTED'
  | 'INTERVIEW_SCHEDULED'
  | 'UNDER_REVIEW'
  | 'OFFER_EXTENDED'
  | 'HIRED'
  | 'REJECTED'
export type JobStatus = 'OPEN' | 'CLOSED' | 'DRAFT'
export type InterviewMode = 'IN_PERSON' | 'ONLINE'
export type InterviewResult = 'PENDING' | 'PASS_SHORTLISTED' | 'OFFER_RECOMMENDED' | 'ON_HOLD' | 'FAIL_REJECTED'
export type AppraisalPeriod = 'ANNUAL' | 'MID_TERM' | 'PROBATION_REVIEW'
export type AppraisalStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED'
export type AppraisalBadge = 'EXCELLENT' | 'GOOD' | 'SATISFACTORY' | 'NEEDS_IMPROVEMENT'

export type RecruitmentOptions = {
  departments: string[]
  jobStatuses: JobStatus[]
  pipelineStages: Stage[]
  candidateStages: Stage[]
  interviewModes: InterviewMode[]
  interviewResults: InterviewResult[]
  appraisalPeriods: AppraisalPeriod[]
  appraisalStatuses: AppraisalStatus[]
  appraisalBadges: AppraisalBadge[]
}

type Kpi = { value: number; newThisWeek: number }
export type Overview = {
  kpis: {
    openVacancies: Kpi & { roles: number }
    activeCandidates: Kpi
    interviewsScheduled: Kpi
    pendingAppraisals: Kpi
    hiredThisYear: Kpi
  }
  pipeline: {
    id: string
    fullName: string
    roleApplied: string
    department: string | null
    stage: Stage
    schoolId: string
    schoolName: string
    stageChangedAt: string
  }[]
  counts: { requirements: number; candidates: number; interviews: number; appraisals: number; auditEvents: number }
}

export type Requirement = {
  id: string
  schoolId: string
  schoolName: string
  title: string
  subject: string
  department: string
  vacancies: number
  status: JobStatus
  experience: string | null
  qualification: string | null
  postingDate: string | null
  closingDate: string | null
}

export type Candidate = {
  id: string
  schoolId: string
  schoolName: string
  fullName: string
  roleApplied: string
  email: string | null
  phone: string | null
  department: string | null
  experienceYears: number | null
  stage: Stage
  qualification: string | null
  currentOrganization: string | null
  expectedSalary: number | null
  resumeUrl: string | null
  interviewCount: number
  createdAt: string
}

export type Interview = {
  id: string
  schoolId: string
  schoolName: string
  candidate: { id: string; fullName: string; roleApplied: string; stage: Stage }
  scheduledAt: string
  mode: InterviewMode
  location: string | null
  panel: string | null
  rating: number | null
  result: InterviewResult
  feedback: string | null
}

export type Appraisal = {
  id: string
  schoolId: string
  schoolName: string
  faculty: { id: string; name: string; subjects: string[] }
  department: string | null
  period: AppraisalPeriod
  academicYear: string
  status: AppraisalStatus
  teachingScore: number | null
  punctualityScore: number | null
  studentAvg: number | null
  overallBadge: AppraisalBadge | null
  remarks: string | null
  improvementAreas: string | null
  appraiserName: string | null
  updatedAt: string
}

export type AuditEvent = {
  id: string
  schoolName: string | null
  action: 'CREATE' | 'UPDATE' | 'DELETE'
  entity: string
  recordId: string
  summary: string
  changes: Record<string, unknown> | null
  actorName: string
  ip: string | null
  userAgent: string | null
  createdAt: string
}

export type SchoolLite = { id: string; name: string; board: string; academicYearStartMonth: number }

export const STAGE_LABELS: Record<Stage, string> = {
  APPLIED: 'Applied',
  SHORTLISTED: 'Shortlisted',
  INTERVIEW_SCHEDULED: 'Interview Scheduled',
  UNDER_REVIEW: 'Under Review',
  OFFER_EXTENDED: 'Offer Extended',
  HIRED: 'Hired',
  REJECTED: 'Rejected',
}
export const STAGE_STYLES: Record<Stage, string> = {
  APPLIED: 'bg-slate-100 text-slate-700',
  SHORTLISTED: 'bg-sky-50 text-sky-700',
  INTERVIEW_SCHEDULED: 'bg-indigo-50 text-indigo-700',
  UNDER_REVIEW: 'bg-amber-50 text-amber-700',
  OFFER_EXTENDED: 'bg-violet-50 text-violet-700',
  HIRED: 'bg-emerald-50 text-emerald-700',
  REJECTED: 'bg-red-50 text-red-700',
}
export const JOB_STATUS_LABELS: Record<JobStatus, string> = { OPEN: 'Open', CLOSED: 'Closed', DRAFT: 'Draft' }
export const JOB_STATUS_STYLES: Record<JobStatus, string> = {
  OPEN: 'bg-emerald-50 text-emerald-700',
  CLOSED: 'bg-slate-100 text-slate-600',
  DRAFT: 'bg-amber-50 text-amber-700',
}
export const MODE_LABELS: Record<InterviewMode, string> = { IN_PERSON: 'In-person', ONLINE: 'Online' }
export const RESULT_LABELS: Record<InterviewResult, string> = {
  PENDING: 'Pending',
  PASS_SHORTLISTED: 'Pass / Shortlisted',
  OFFER_RECOMMENDED: 'Offer Recommended',
  ON_HOLD: 'On Hold',
  FAIL_REJECTED: 'Fail / Rejected',
}
export const RESULT_STYLES: Record<InterviewResult, string> = {
  PENDING: 'bg-slate-100 text-slate-700',
  PASS_SHORTLISTED: 'bg-sky-50 text-sky-700',
  OFFER_RECOMMENDED: 'bg-emerald-50 text-emerald-700',
  ON_HOLD: 'bg-amber-50 text-amber-700',
  FAIL_REJECTED: 'bg-red-50 text-red-700',
}
export const RATING_LABELS = ['', 'Poor', 'Fair', 'Good', 'Very Good', 'Exceptional']
export const PERIOD_LABELS: Record<AppraisalPeriod, string> = {
  ANNUAL: 'Annual',
  MID_TERM: 'Mid-Term',
  PROBATION_REVIEW: 'Probation Review',
}
export const APPRAISAL_STATUS_LABELS: Record<AppraisalStatus, string> = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
}
export const APPRAISAL_STATUS_STYLES: Record<AppraisalStatus, string> = {
  PENDING: 'bg-slate-100 text-slate-700',
  IN_PROGRESS: 'bg-sky-50 text-sky-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700',
}
export const BADGE_LABELS: Record<AppraisalBadge, string> = {
  EXCELLENT: 'Excellent',
  GOOD: 'Good',
  SATISFACTORY: 'Satisfactory',
  NEEDS_IMPROVEMENT: 'Needs Improvement',
}
export const BADGE_STYLES: Record<AppraisalBadge, string> = {
  EXCELLENT: 'bg-emerald-50 text-emerald-700',
  GOOD: 'bg-sky-50 text-sky-700',
  SATISFACTORY: 'bg-amber-50 text-amber-700',
  NEEDS_IMPROVEMENT: 'bg-red-50 text-red-700',
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
export const formatInr = (n: number) => inr.format(n)

export type Filters = { schoolId?: string; q?: string; department?: string; stage?: string }
const qs = (f: Filters) => {
  const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][])
  return p.size ? `?${p}` : ''
}

/** Every recruitment query starts with this key, so one invalidation refreshes them all. */
export const RECRUITMENT = 'recruitment'

export const useRecruitmentOptions = () =>
  useQuery({ queryKey: [RECRUITMENT, 'options'], queryFn: () => api<RecruitmentOptions>('/recruitment/options'), staleTime: Infinity })

export const useOverview = (schoolId: string) =>
  useQuery({
    queryKey: [RECRUITMENT, 'overview', schoolId],
    queryFn: () => api<Overview>(`/recruitment/overview${qs({ schoolId })}`),
  })

export const useRequirements = (f: Filters) =>
  useQuery({ queryKey: [RECRUITMENT, 'requirements', f], queryFn: () => api<Requirement[]>(`/recruitment/requirements${qs(f)}`) })

export const useCandidates = (f: Filters) =>
  useQuery({ queryKey: [RECRUITMENT, 'candidates', f], queryFn: () => api<Candidate[]>(`/recruitment/candidates${qs(f)}`) })

export const useInterviews = (f: Filters) =>
  useQuery({ queryKey: [RECRUITMENT, 'interviews', f], queryFn: () => api<Interview[]>(`/recruitment/interviews${qs(f)}`) })

export const useAppraisals = (f: Filters) =>
  useQuery({ queryKey: [RECRUITMENT, 'appraisals', f], queryFn: () => api<Appraisal[]>(`/recruitment/appraisals${qs(f)}`) })

export const useAuditLog = () =>
  useQuery({ queryKey: [RECRUITMENT, 'audit'], queryFn: () => api<{ total: number; events: AuditEvent[] }>('/recruitment/audit') })

/** The schools this admin manages (Target School pickers, school filters). */
export const useMySchools = () =>
  useQuery({ queryKey: ['my-schools'], queryFn: () => api<SchoolLite[]>('/schools') })

export function useRefreshRecruitment() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: [RECRUITMENT] })
}

/** Sends a write and refreshes every recruitment view (lists, counts, KPIs, audit). */
export function useRecruitmentWrite() {
  const refresh = useRefreshRecruitment()
  const queryClient = useQueryClient()
  return async <T,>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) => {
    const result = await api<T>(`/recruitment${path}`, { method, ...(body !== undefined && { body: JSON.stringify(body) }) })
    // Hiring a candidate can add a faculty profile, so faculty lists refresh too.
    await Promise.all([refresh(), queryClient.invalidateQueries({ predicate: (q) => q.queryKey[1] === 'faculty' })])
    return result
  }
}
