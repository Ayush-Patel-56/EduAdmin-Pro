import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || null : value;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
/** Keeps line breaks: topics, homework and observations can be several lines. */
const multiline = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : value;
const multilineOrNull = (arg: { value: unknown }) => {
  const value = multiline(arg);
  return value === '' ? null : value;
};
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const REPORT_STATUSES = ['ON_TIME', 'LATE'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/**
 * Submit (or edit) a Daily Class Report (PRD 5.6). The pipe reports the
 * last-listed check first, so "required" goes last on each field.
 */
export class DailyReportDto {
  /** The day taught; defaults to today in the form, and can be an earlier day (then it is Late). */
  @Matches(ISO_DATE, { message: 'Pick the date taught' })
  date: string;

  @IsUUID('4', { message: 'Select a batch' })
  batchId: string;

  @Transform(trim)
  @MaxLength(80, { message: 'Keep the subject under 80 characters' })
  @IsString({ message: 'Select a subject' })
  @IsNotEmpty({ message: 'Select a subject' })
  subject: string;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(150, { message: 'Keep the chapter under 150 characters' })
  chapter?: string | null;

  @Transform(multiline)
  @MaxLength(4000, { message: 'Keep the topics under 4000 characters' })
  @IsString({ message: 'Describe the topics covered' })
  @IsNotEmpty({ message: 'Describe the topics covered' })
  topics: string;

  @Transform(multilineOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(4000, { message: 'Keep the homework under 4000 characters' })
  homework?: string | null;

  @Transform(multilineOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(4000, { message: 'Keep the observations under 4000 characters' })
  observations?: string | null;
}

/** Daily Teacher Reports (PRD 4.8): one day, optionally one program or batch and On Time / Late. */
export class AdminReportQuery {
  @Matches(ISO_DATE, { message: 'Pick a date' })
  date: string;

  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4', { message: 'Unknown program' })
  programId?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4', { message: 'Unknown batch' })
  batchId?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsIn(REPORT_STATUSES, { message: 'Status must be On Time or Late' })
  status?: ReportStatus | null;
}
