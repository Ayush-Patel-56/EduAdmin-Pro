import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || null : value;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** PRD 5.9: the subjects of study material and assignments. */
export const WORKSPACE_SUBJECTS = [
  'Mathematics',
  'Physics',
  'Chemistry',
  'Biology',
  'English',
  'Computer Science',
] as const;
export const MATERIAL_TYPES = [
  'NOTES',
  'PDF',
  'VIDEO',
  'PRACTICE_SHEET',
  'DPP',
  'REFERENCE',
  'ANSWER_KEY',
] as const;
export const ASSIGNMENT_TYPES = [
  'HOMEWORK',
  'DPP',
  'WORKSHEET',
  'PROJECT',
  'REVISION',
] as const;
export const SUBMISSION_STATUSES = [
  'PENDING',
  'SUBMITTED',
  'LATE',
  'GRADED',
] as const;

export class MaterialDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Title is required' })
  @MaxLength(150)
  title: string;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Provider is required' })
  @MaxLength(120)
  provider: string;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(150)
  chapter?: string | null;

  @IsUUID('4', { message: 'Select a batch' })
  batchId: string;

  @IsIn(WORKSPACE_SUBJECTS, { message: 'Select a subject' })
  subject: (typeof WORKSPACE_SUBJECTS)[number];

  @IsIn(MATERIAL_TYPES, { message: 'Select a material type' })
  type: (typeof MATERIAL_TYPES)[number];

  @IsBoolean()
  isPublic: boolean;

  @IsUUID('4', { message: 'Upload the file' })
  fileId: string;
}

export class AssignmentDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Title is required' })
  @MaxLength(150)
  title: string;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Chapter / topic is required' })
  @MaxLength(150)
  chapter: string;

  /**
   * A curriculum chapter of the subject (optional). Its name becomes the
   * chapter, and with the topic it lines the assignment's scores up with the
   * question bank's for topic strength in the student reports.
   */
  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4', { message: 'Select the chapter again' })
  chapterId?: string | null;

  /** The concept / topic it practises (optional). */
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(120, { message: 'Keep the topic under 120 characters' })
  topic?: string | null;

  @IsUUID('4', { message: 'Select a batch' })
  batchId: string;

  @IsIn(WORKSPACE_SUBJECTS, { message: 'Select a subject' })
  subject: (typeof WORKSPACE_SUBJECTS)[number];

  @IsIn(ASSIGNMENT_TYPES, { message: 'Select an assignment type' })
  type: (typeof ASSIGNMENT_TYPES)[number];

  @Matches(ISO_DATE, { message: 'Due date is required' })
  dueDate: string;

  /** IST, 24-hour; the form defaults to 23:59 (11:59 PM). */
  @Matches(TIME, { message: 'Due time must be a time like 23:59' })
  dueTime: string;

  @Type(() => Number)
  @IsInt({ message: 'Total marks must be a whole number' })
  @Min(1, { message: 'Total marks must be at least 1' })
  @Max(1000, { message: 'Total marks can be at most 1,000' })
  totalMarks: number;

  /** The question sheet (optional); null removes it. */
  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4', { message: 'Upload the question sheet again' })
  questionFileId?: string | null;
}

/** Grading one student (a teacher records what the student handed in). */
export class SubmissionDto {
  @IsIn(SUBMISSION_STATUSES, { message: 'Select a status' })
  status: (typeof SUBMISSION_STATUSES)[number];

  @Transform(({ value }: { value: unknown }) =>
    value === '' || value === null ? null : value,
  )
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Score must be a number' })
  @Min(0, { message: "Score can't be negative" })
  score?: number | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  feedback?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @Matches(ISO_DATE, { message: 'Submitted on must be a date' })
  submittedOn?: string | null;

  /** The student's work, scanned or uploaded by the teacher; null removes it. */
  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4', { message: 'Upload the file again' })
  fileId?: string | null;
}

export class WorkspaceQuery {
  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4', { message: 'Unknown batch' })
  batchId?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(20)
  type?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string | null;
}
