// Fixed choices for recruitment and appraisals (PRD §4.4), served by
// GET /recruitment/options so forms and validation share one list.

export const DEPARTMENTS = [
  'Science',
  'Mathematics',
  'English',
  'Humanities',
  'Commerce',
] as const;

export const JOB_STATUSES = ['OPEN', 'CLOSED', 'DRAFT'] as const;

/** Board columns, in workflow order. REJECTED is a stage but not a column. */
export const PIPELINE_STAGES = [
  'APPLIED',
  'SHORTLISTED',
  'INTERVIEW_SCHEDULED',
  'UNDER_REVIEW',
  'OFFER_EXTENDED',
  'HIRED',
] as const;

export const CANDIDATE_STAGES = [...PIPELINE_STAGES, 'REJECTED'] as const;

export const INTERVIEW_MODES = ['IN_PERSON', 'ONLINE'] as const;

export const INTERVIEW_RESULTS = [
  'PENDING',
  'PASS_SHORTLISTED',
  'OFFER_RECOMMENDED',
  'ON_HOLD',
  'FAIL_REJECTED',
] as const;

export const APPRAISAL_PERIODS = [
  'ANNUAL',
  'MID_TERM',
  'PROBATION_REVIEW',
] as const;

export const APPRAISAL_STATUSES = [
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
] as const;

export const APPRAISAL_BADGES = [
  'EXCELLENT',
  'GOOD',
  'SATISFACTORY',
  'NEEDS_IMPROVEMENT',
] as const;

/** Stages that count as "in the hiring pipeline". */
export const ACTIVE_STAGES = [
  'APPLIED',
  'SHORTLISTED',
  'INTERVIEW_SCHEDULED',
  'UNDER_REVIEW',
  'OFFER_EXTENDED',
] as const;
