import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
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
  ValidateNested,
} from 'class-validator';
import { SUBJECTS } from '../academic/academic-options.js';

const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || null : value;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
/** Keeps line breaks (questions can span lines); collapses runs of spaces. */
const multiline = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim() : value;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;
export const QUESTION_TYPES = ['MCQ', 'NUMERICAL', 'INTEGER', 'SUBJECTIVE'] as const;
export const TEST_TYPES = ['UNIT_TEST', 'MOCK', 'DPP'] as const;
export const TEST_PHASES = ['SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export type QuestionKind = (typeof QUESTION_TYPES)[number];
export type TestKind = (typeof TEST_TYPES)[number];

/**
 * One default for both portals (the PRD had 100 minutes for admins and 180 for
 * faculty; the HLD asks for a single shared default rather than two).
 */
export const TEST_DEFAULTS = { durationMinutes: 180, totalMarks: 300 } as const;
export const QUESTION_DEFAULTS = { marks: 4, negativeMarks: 0, source: 'Custom' } as const;
export const MAX_PDF_TEXT = 500_000;
export const MAX_PAPER = 200;
export const MAX_RESULTS = 1000;

// The pipe reports the last-listed check first, so "required" goes last.

/** Add / edit a question (PRD 4.10, 5.11). */
export class QuestionDto {
  @IsIn(SUBJECTS, { message: 'Select a subject' })
  subject: string;

  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4', { message: 'Select a chapter' })
  chapterId?: string | null;

  @Transform(trim)
  @MaxLength(120, { message: 'Keep the topic under 120 characters' })
  @IsString({ message: 'Enter the concept or topic' })
  @IsNotEmpty({ message: 'Enter the concept or topic' })
  topic: string;

  @IsIn(DIFFICULTIES, { message: 'Select a difficulty' })
  difficulty: Difficulty;

  @IsIn(QUESTION_TYPES, { message: 'Select a question type' })
  type: QuestionKind;

  @Transform(multiline)
  @MaxLength(4000, { message: 'Keep the question under 4000 characters' })
  @IsString({ message: 'Enter the question text' })
  @IsNotEmpty({ message: 'Enter the question text' })
  text: string;

  /** A-D for an MCQ; ignored for other types. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @Transform(({ value }: { value: unknown }) => (Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v)) : value))
  @IsString({ each: true })
  @MaxLength(500, { each: true, message: 'Keep each option under 500 characters' })
  options?: string[];

  @Transform(multiline)
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Keep the answer under 2000 characters' })
  correctAnswer?: string | null;

  @Type(() => Number)
  @Min(1, { message: 'Marks must be 1 to 100' })
  @Max(100, { message: 'Marks must be 1 to 100' })
  @IsInt({ message: 'Marks must be a whole number' })
  marks: number;

  @Type(() => Number)
  @Min(0, { message: 'Negative marks must be 0 to 9' })
  @Max(9, { message: 'Negative marks must be 0 to 9' })
  @IsInt({ message: 'Negative marks must be a whole number' })
  negativeMarks: number;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(60, { message: 'Keep the source under 60 characters' })
  source?: string | null;
}

export class QuestionQuery {
  @Transform(blankToNull) @IsOptional() @IsString() @MaxLength(100) q?: string | null;
  @Transform(blankToNull) @IsOptional() @IsIn(SUBJECTS) subject?: string | null;
  @Transform(blankToNull) @IsOptional() @IsIn(DIFFICULTIES) difficulty?: Difficulty | null;
  @Transform(blankToNull) @IsOptional() @IsIn(QUESTION_TYPES) type?: QuestionKind | null;
  @Transform(blankToNull) @IsOptional() @IsUUID('4') chapterId?: string | null;
  /** Admins: one teacher's questions, or "admin" for those added by admins. */
  @Transform(blankToNull) @IsOptional() @Matches(/^(admin|[0-9a-f-]{36})$/) author?: string | null;
  /** Teachers: their own bank by default; "school" for every question (to build a paper). */
  @Transform(blankToNull) @IsOptional() @IsIn(['mine', 'school']) bank?: 'mine' | 'school' | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
}

/** Upload PDF: the text the browser took from the file, previewed first. */
export class QuestionImportDto {
  @IsString()
  @MaxLength(MAX_PDF_TEXT, { message: 'The PDF has too much text for one upload; split it into smaller files' })
  @IsNotEmpty({ message: 'The PDF has no selectable text (scanned pages are not supported)' })
  text: string;

  @IsBoolean()
  dryRun: boolean;
}

/** Schedule / create a test (PRD 4.10 admin, 5.11 faculty). */
export class TestDto {
  @Transform(trim)
  @MaxLength(150, { message: 'Keep the title under 150 characters' })
  @IsString({ message: 'Enter the test title' })
  @IsNotEmpty({ message: 'Enter the test title' })
  title: string;

  @IsIn(TEST_TYPES, { message: 'Select the test type' })
  type: TestKind;

  @Transform(trim)
  @MaxLength(80, { message: 'Keep the subject under 80 characters' })
  @IsString({ message: 'Enter the subject' })
  @IsNotEmpty({ message: 'Enter the subject' })
  subject: string;

  @IsUUID('4', { message: 'Select a batch' })
  batchId: string;

  @Matches(ISO_DATE, { message: 'Pick the test date' })
  date: string;

  @Matches(TIME, { message: 'Pick the start time' })
  time: string;

  @Type(() => Number)
  @Min(1, { message: 'Duration must be 1 to 720 minutes' })
  @Max(720, { message: 'Duration must be 1 to 720 minutes' })
  @IsInt({ message: 'Duration must be whole minutes' })
  durationMinutes: number;

  @Type(() => Number)
  @Min(1, { message: 'Total marks must be 1 to 10000' })
  @Max(10000, { message: 'Total marks must be 1 to 10000' })
  @IsInt({ message: 'Total marks must be a whole number' })
  totalMarks: number;
}

export class TestStatusDto {
  @IsBoolean()
  cancelled: boolean;
}

export class TestQuery {
  @Transform(blankToNull) @IsOptional() @IsString() @MaxLength(100) q?: string | null;
  @Transform(blankToNull) @IsOptional() @IsUUID('4') batchId?: string | null;
  @Transform(blankToNull) @IsOptional() @IsUUID('4') programId?: string | null;
  /** Admins: one teacher's tests, or "admin" for those scheduled by admins. */
  @Transform(blankToNull) @IsOptional() @Matches(/^(admin|[0-9a-f-]{36})$/) author?: string | null;
  @Transform(blankToNull) @IsOptional() @IsIn(TEST_TYPES) type?: TestKind | null;
  @Transform(blankToNull) @IsOptional() @IsIn(TEST_PHASES) status?: (typeof TEST_PHASES)[number] | null;
  /** A date range (the week calendar): tests starting on these days, in India. */
  @Transform(blankToNull) @IsOptional() @Matches(ISO_DATE) from?: string | null;
  @Transform(blankToNull) @IsOptional() @Matches(ISO_DATE) to?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
}

/**
 * The paper, in order: each id is a question already on it (its paper id, or
 * its bank question's id), which keeps its copy, or a bank question to add.
 */
export class PaperDto {
  @IsArray()
  @ArrayMaxSize(MAX_PAPER, { message: `A paper can have at most ${MAX_PAPER} questions` })
  @ArrayUnique({ message: 'A question can be on the paper only once' })
  @IsUUID('4', { each: true })
  questionIds: string[];
}

export class AnswerInput {
  @IsUUID('4')
  testQuestionId: string;

  /** The option (A-D) or value the student gave; blank is unattempted. Objective questions. */
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  response?: string | null;

  /** Marks the teacher gives a subjective answer; none is unattempted. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  marksAwarded?: number | null;
}

export class ResultInput {
  @IsUUID('4')
  studentId: string;

  @IsBoolean()
  present: boolean;

  /** Total marks, when answers aren't entered question by question. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Marks must be a number with up to two decimals' })
  marks?: number | null;

  @IsOptional() @IsInt() @Min(0) correct?: number | null;
  @IsOptional() @IsInt() @Min(0) incorrect?: number | null;
  @IsOptional() @IsInt() @Min(0) unattempted?: number | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string | null;

  /** Question by question: marks and counts are then worked out from these. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PAPER)
  @ValidateNested({ each: true })
  @Type(() => AnswerInput)
  answers?: AnswerInput[];
}

export class ResultsDto {
  @IsArray()
  @ArrayMaxSize(MAX_RESULTS, { message: `Save at most ${MAX_RESULTS} results at a time` })
  @ValidateNested({ each: true })
  @Type(() => ResultInput)
  results: ResultInput[];

  /**
   * A large sheet is saved in chunks: every chunk but the last asks for just
   * the count saved, so the full sheet (ranks, stats) is built once, at the end.
   */
  @IsOptional() @IsBoolean() summaryOnly?: boolean;
}
