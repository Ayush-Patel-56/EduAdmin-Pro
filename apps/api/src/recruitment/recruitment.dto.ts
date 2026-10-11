import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { IsIndianMobile } from '../common/validators.js';
import {
  APPRAISAL_BADGES,
  APPRAISAL_PERIODS,
  APPRAISAL_STATUSES,
  CANDIDATE_STAGES,
  DEPARTMENTS,
  INTERVIEW_MODES,
  INTERVIEW_RESULTS,
  JOB_STATUSES,
} from './recruitment-options.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
// Blank optional fields arrive as "" from forms; store them as null.
const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const present = (_: object, v: unknown) =>
  v !== null && v !== undefined && v !== '';

export class JobRequirementDto {
  @IsUUID('4', { message: 'Select a school' })
  schoolId: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Job title is required' })
  @MaxLength(120)
  title: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Subject / program is required' })
  @MaxLength(120)
  subject: string;

  @IsIn(DEPARTMENTS, { message: 'Select a department' })
  department: string;

  @Type(() => Number)
  @IsInt({ message: 'Vacancies must be a whole number' })
  @Min(1, { message: 'Vacancies must be 1 to 500' })
  @Max(500, { message: 'Vacancies must be 1 to 500' })
  vacancies: number;

  @IsIn(JOB_STATUSES, { message: 'Unknown status' })
  status: (typeof JOB_STATUSES)[number];

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  experience?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  qualification?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @Matches(ISO_DATE, { message: 'Posting date is invalid' })
  postingDate?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @Matches(ISO_DATE, { message: 'Closing date is invalid' })
  closingDate?: string | null;
}

export class CandidateDto {
  @IsUUID('4', { message: 'Select the target school' })
  schoolId: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Full name is required' })
  @MaxLength(120)
  fullName: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Role applied is required' })
  @MaxLength(120)
  roleApplied: string;

  @Transform(blankToNull)
  @IsOptional()
  @IsEmail({}, { message: 'Please enter a valid email address' })
  @MaxLength(254)
  email?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsIndianMobile()
  phone?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsIn(DEPARTMENTS, { message: 'Unknown department' })
  department?: string | null;

  @ValidateIf(present)
  @Type(() => Number)
  @IsInt({ message: 'Experience must be a whole number of years' })
  @Min(0, { message: 'Experience must be 0 to 60 years' })
  @Max(60, { message: 'Experience must be 0 to 60 years' })
  experienceYears?: number | null;

  @IsIn(CANDIDATE_STAGES, { message: 'Unknown workflow status' })
  stage: (typeof CANDIDATE_STAGES)[number];

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  qualification?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  currentOrganization?: string | null;

  @ValidateIf(present)
  @Type(() => Number)
  @IsInt({ message: 'Expected salary must be a whole number of rupees' })
  @Min(0, { message: 'Expected salary must be positive' })
  @Max(100_000_000, { message: 'Expected salary looks too large' })
  expectedSalary?: number | null;

  @Transform(blankToNull)
  @IsOptional()
  @Matches(/^https?:\/\/\S+$/i, {
    message: 'Resume link must start with http(s)://',
  })
  @MaxLength(500)
  resumeUrl?: string | null;
}

export class CandidateStageDto {
  @IsIn(CANDIDATE_STAGES, { message: 'Unknown workflow status' })
  stage: (typeof CANDIDATE_STAGES)[number];
}

export class InterviewDto {
  @IsUUID('4', { message: 'Select a candidate' })
  candidateId: string;

  @IsISO8601({ strict: true }, { message: 'Date & time is required' })
  scheduledAt: string;

  @IsIn(INTERVIEW_MODES, { message: 'Unknown mode' })
  mode: (typeof INTERVIEW_MODES)[number];

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(300)
  panel?: string | null;

  @ValidateIf(present)
  @Type(() => Number)
  @IsInt({ message: 'Rating must be 1 to 5' })
  @Min(1, { message: 'Rating must be 1 to 5' })
  @Max(5, { message: 'Rating must be 1 to 5' })
  rating?: number | null;

  @IsIn(INTERVIEW_RESULTS, { message: 'Unknown result' })
  result: (typeof INTERVIEW_RESULTS)[number];

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  feedback?: string | null;
}

export class AppraisalDto {
  @IsUUID('4', { message: 'Select a school' })
  schoolId: string;

  @IsUUID('4', { message: 'Select the teacher' })
  facultyId: string;

  @Transform(blankToNull)
  @IsOptional()
  @IsIn(DEPARTMENTS, { message: 'Unknown department' })
  department?: string | null;

  @IsIn(APPRAISAL_PERIODS, { message: 'Unknown period' })
  period: (typeof APPRAISAL_PERIODS)[number];

  @Matches(/^\d{4}-\d{4}$/, {
    message: 'Academic year must look like 2026-2027',
  })
  academicYear: string;

  @IsIn(APPRAISAL_STATUSES, { message: 'Unknown review status' })
  status: (typeof APPRAISAL_STATUSES)[number];

  @ValidateIf(present)
  @Type(() => Number)
  @IsInt({ message: 'Teaching score must be 1 to 5' })
  @Min(1, { message: 'Teaching score must be 1 to 5' })
  @Max(5, { message: 'Teaching score must be 1 to 5' })
  teachingScore?: number | null;

  @ValidateIf(present)
  @Type(() => Number)
  @IsInt({ message: 'Punctuality score must be 1 to 5' })
  @Min(1, { message: 'Punctuality score must be 1 to 5' })
  @Max(5, { message: 'Punctuality score must be 1 to 5' })
  punctualityScore?: number | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsIn(APPRAISAL_BADGES, { message: 'Unknown overall badge' })
  overallBadge?: (typeof APPRAISAL_BADGES)[number] | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  improvementAreas?: string | null;
}
