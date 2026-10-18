import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { REPORT_SUBJECTS, REPORT_TERMS, type ReportTermKey } from './report-math.js';

const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || null : value;
/** Keeps line breaks: remarks can be several lines. */
const multilineOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() || null : value;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Rows in one report sheet (PRD 4.5: up to 1,000 students). */
export const MAX_MARK_ROWS = 1000;
/** Students rated in one save (a batch's roster). */
export const MAX_RATINGS = 500;
export const MAX_REMARKS = 1000;
export const MAX_NOTES = 500;
/** Largest max marks of a subject (the column holds up to 99,999.99). */
export const MAX_MAX_MARKS = 10000;
export const REPORTS_PAGE_SIZE = 20;

// Shared filters

export class YearQuery {
  /** The academic year (the year it starts); the current one when left out. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year?: number;
}

export class StudentSearchQuery {
  @Transform(blankToNull) @IsOptional() @IsString() @MaxLength(100) q?: string | null;
  @Transform(blankToNull) @IsOptional() @IsUUID('4') batchId?: string | null;
}

/** The Uploaded Reports Overview filters (PRD 4.5): class (batch), term and subject. */
export class OverviewQuery extends YearQuery {
  @Transform(blankToNull) @IsOptional() @IsIn(REPORT_TERMS) term?: ReportTermKey | null;
  @Transform(blankToNull) @IsOptional() @IsUUID('4') batchId?: string | null;
  @Transform(blankToNull) @IsOptional() @IsIn(REPORT_SUBJECTS) subject?: string | null;
}

export class SetsQuery extends OverviewQuery {
  @Transform(blankToNull) @IsOptional() @IsString() @MaxLength(100) q?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

/** One uploaded sheet: a batch's marks in one subject for one term. */
export class MarkSetQuery {
  @IsUUID('4', { message: 'Select a batch' }) batchId: string;
  @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year: number;
  @IsIn(REPORT_TERMS, { message: 'Select a term' }) term: ReportTermKey;
  @IsIn(REPORT_SUBJECTS, { message: 'Select a subject' }) subject: string;
}

// Import student report (PRD 4.5)

/** A row as read from the sheet; each cell is checked (and reported per row) by the service. */
export class MarkImportRow {
  @IsOptional() @IsString() @MaxLength(40) rollNo?: string;
  @IsOptional() @IsString() @MaxLength(150) name?: string;
  @IsOptional() @IsString() @MaxLength(20) marks?: string;
  @IsOptional() @IsString() @MaxLength(20) maxMarks?: string;
  @IsOptional() @IsString() @MaxLength(20) attendance?: string;
  @IsOptional() @IsString() @MaxLength(MAX_REMARKS + 100) remarks?: string;
}

export class MarksImportDto {
  @IsUUID('4', { message: 'Select a batch' }) batchId: string;
  @Type(() => Number) @IsInt({ message: 'Select the academic year' }) @Min(2000) @Max(2100) year: number;
  @IsIn(REPORT_TERMS, { message: 'Select a term' }) term: ReportTermKey;
  @IsIn(REPORT_SUBJECTS, { message: 'Select a subject' }) subject: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'The sheet has no rows' })
  @ArrayMaxSize(MAX_MARK_ROWS, { message: `Import at most ${MAX_MARK_ROWS} students at a time` })
  @ValidateNested({ each: true })
  @Type(() => MarkImportRow)
  rows: MarkImportRow[];

  @IsBoolean() dryRun: boolean;
}

// Student Progress Reports (PRD 4.8)

export class ProgressListQuery extends YearQuery {
  @Transform(blankToNull) @IsOptional() @IsIn(REPORT_TERMS) term?: ReportTermKey | null;
  @Transform(blankToNull) @IsOptional() @IsUUID('4') batchId?: string | null;
  @Transform(blankToNull) @IsOptional() @IsString() @MaxLength(100) q?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

/** One student's report for one term. */
export class ProgressKeyQuery {
  @IsUUID('4', { message: 'Select a student' }) studentId: string;
  @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year: number;
  @IsIn(REPORT_TERMS, { message: 'Select a term' }) term: ReportTermKey;
}

export class SubjectMarkInput {
  @IsIn(REPORT_SUBJECTS, { message: 'Select each subject' }) subject: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Marks obtained must be a number with up to two decimals' })
  @Min(0, { message: "Marks obtained can't be negative" })
  marks: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Total marks must be a number with up to two decimals' })
  @Min(0.01, { message: 'Total marks must be more than 0' })
  @Max(MAX_MAX_MARKS, { message: `Total marks can be at most ${MAX_MAX_MARKS}` })
  maxMarks: number;
}

/** Generate / Edit Progress Report: the term's subject marks (replacing any there) and the remarks. */
export class ProgressReportDto {
  @IsUUID('4', { message: 'Select a student' }) studentId: string;
  @Type(() => Number) @IsInt({ message: 'Select the academic year' }) @Min(2000) @Max(2100) year: number;
  @IsIn(REPORT_TERMS, { message: 'Select a term' }) term: ReportTermKey;

  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one subject' })
  @ArrayMaxSize(REPORT_SUBJECTS.length)
  @ValidateNested({ each: true })
  @Type(() => SubjectMarkInput)
  subjects: SubjectMarkInput[];

  @Transform(multilineOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REMARKS, { message: `Keep the teacher remarks under ${MAX_REMARKS} characters` })
  teacherRemarks?: string | null;

  @Transform(multilineOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REMARKS, { message: `Keep the principal remarks under ${MAX_REMARKS} characters` })
  principalRemarks?: string | null;
}

// Student Ratings (PRD 5.7)

export class RatingSheetQuery {
  @Matches(ISO_DATE, { message: 'Pick a date' }) date: string;
  @IsUUID('4', { message: 'Select a batch' }) batchId: string;
}

export class RatingDayQuery {
  @Matches(ISO_DATE, { message: 'Pick a date' }) date: string;
}

export class RatingInput {
  @IsUUID('4') studentId: string;
  @IsInt() @Min(1) @Max(5) attitude: number;
  @IsInt() @Min(1) @Max(5) behaviour: number;
  @IsInt() @Min(1) @Max(5) focus: number;
  @IsInt() @Min(1) @Max(5) interaction: number;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(MAX_NOTES, { message: `Keep each note under ${MAX_NOTES} characters` })
  notes?: string | null;
}

export class RatingsDto {
  @Matches(ISO_DATE, { message: 'Pick a date' }) date: string;
  @IsUUID('4', { message: 'Select a batch' }) batchId: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Rate at least one student' })
  @ArrayMaxSize(MAX_RATINGS, { message: `Save at most ${MAX_RATINGS} ratings at a time` })
  @ValidateNested({ each: true })
  @Type(() => RatingInput)
  ratings: RatingInput[];
}
