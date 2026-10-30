import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { FEEDBACK_CATEGORIES, FEEDBACK_DIRECTIONS, type FeedbackCategory, type FeedbackDirection } from './feedback-rules.js';

const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || null : value;
/** Keeps line breaks: feedback can be several lines. */
export const multiline = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : value;
const UUID_OR_ALL = /^(ALL|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export const MAX_FEEDBACK_LENGTH = 2000;
export const MAX_FEEDBACK_IMPORT_ROWS = 1000;
/** Statuses an admin can move an entry to; nothing goes back to Submitted. */
export const SETTABLE_STATUSES = ['REVIEWED', 'ACTIONED', 'DISMISSED'] as const;

// The pipe reports the last-listed check first, so "required" goes last.
class FeedbackFields {
  @Transform(multiline)
  @MaxLength(MAX_FEEDBACK_LENGTH, { message: `Keep the feedback under ${MAX_FEEDBACK_LENGTH} characters` })
  @IsString({ message: 'Write the feedback' })
  @IsNotEmpty({ message: 'Write the feedback' })
  content: string;

  @Type(() => Number)
  @Min(1, { message: 'Give a rating of 1 to 5 stars' })
  @Max(5, { message: 'Give a rating of 1 to 5 stars' })
  @IsInt({ message: 'Give a rating of 1 to 5 stars' })
  rating: number;
}

/** Send Feedback to Teachers (PRD 4.12): every teacher ("ALL") or one, with a category. */
export class SendFeedbackDto extends FeedbackFields {
  @Matches(UUID_OR_ALL, { message: 'Select a faculty member, or All Faculty' })
  target: string;

  @IsIn(FEEDBACK_CATEGORIES, { message: 'Select a category' })
  category: FeedbackCategory;
}

/** Send Feedback to Management (PRD 5.13): text and stars; the teacher's name goes with it. */
export class TeacherFeedbackDto extends FeedbackFields {}

export class FeedbackStatusDto {
  @IsIn(SETTABLE_STATUSES, { message: 'Status must be Reviewed, Actioned or Dismissed' })
  status: (typeof SETTABLE_STATUSES)[number];
}

export class FeedbackQuery {
  /** Pending: Submitted or Reviewed. Closed: Actioned or Dismissed. */
  @Transform(blankToNull)
  @IsOptional()
  @IsIn(['pending', 'closed'])
  view?: 'pending' | 'closed' | null;

  /** Narrows a view to one status (the Actioned KPI opens Actioned only). */
  @Transform(blankToNull)
  @IsOptional()
  @IsIn(['SUBMITTED', 'REVIEWED', 'ACTIONED', 'DISMISSED'])
  status?: 'SUBMITTED' | 'REVIEWED' | 'ACTIONED' | 'DISMISSED' | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsIn(FEEDBACK_DIRECTIONS)
  direction?: FeedbackDirection | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string | null;
}

export class FeedbackImportRow {
  @IsOptional() @IsString() @MaxLength(40) type?: string;
  @IsOptional() @IsString() @MaxLength(120) sender?: string;
  @IsOptional() @IsString() @MaxLength(10) rating?: string;
  @IsOptional() @IsString() @MaxLength(MAX_FEEDBACK_LENGTH + 100) content?: string;
  @IsOptional() @IsString() @MaxLength(200) subject?: string;
  @IsOptional() @IsString() @MaxLength(120) target?: string;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
  @IsOptional() @IsString() @MaxLength(20) date?: string;
}

/** A row of the same file sent in an earlier chunk: its key and sheet row. */
export class PriorImportKey {
  @Matches(/^[0-9a-f]{64}$/) key: string;
  @IsInt() @Min(2) row: number;
}

/**
 * A feedback sheet, or one chunk of it: the browser sends a large sheet in
 * chunks (each well under the body limit), with the sheet row of the first
 * one, and the keys of the rows already sent so a repeat across chunks is
 * still "appears twice in this file".
 */
export class FeedbackImportDto {
  @IsArray()
  @ArrayMaxSize(MAX_FEEDBACK_IMPORT_ROWS, { message: `Import at most ${MAX_FEEDBACK_IMPORT_ROWS} rows at a time` })
  @ValidateNested({ each: true })
  @Type(() => FeedbackImportRow)
  rows: FeedbackImportRow[];

  @IsBoolean()
  dryRun: boolean;

  /** The sheet row of rows[0] (the header is row 1). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(2) firstRow?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FEEDBACK_IMPORT_ROWS)
  @ValidateNested({ each: true })
  @Type(() => PriorImportKey)
  priorKeys?: PriorImportKey[];
}

/** Give a batch a student feedback link. */
export class CreateFeedbackLinkDto {
  @IsUUID('all', { message: 'Select a batch' })
  batchId: string;
}

/** Switch a batch's student feedback link off or back on. */
export class FeedbackLinkActiveDto {
  @IsBoolean({ message: 'active must be true or false' })
  active: boolean;
}
