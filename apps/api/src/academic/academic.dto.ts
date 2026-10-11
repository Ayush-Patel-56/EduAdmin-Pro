import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  CLASS_LEVELS,
  MAX_IMPORT_ROWS,
  PROGRAM_TYPES,
  SUBJECTS,
  SYLLABUS_STATUSES,
  THEME_COLORS,
} from './academic-options.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
// Blank optional fields arrive as "" from forms; treat them as not provided.
const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || null : value;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ProgramDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Display name is required' })
  @MaxLength(60, { message: 'Display name must be 60 characters or less' })
  name: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() || null : value,
  )
  @IsOptional()
  @Matches(/^[A-Z0-9][A-Z0-9-]{0,19}$/, {
    message: 'Code can use letters, numbers and dashes (max 20)',
  })
  code?: string | null;

  @IsIn(PROGRAM_TYPES, { message: 'Unknown program type' })
  type: (typeof PROGRAM_TYPES)[number];

  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((v) => (typeof v === 'string' ? v.trim() : v)).filter(Boolean)
      : value,
  )
  @IsArray()
  @ArrayMaxSize(20, { message: 'Too many target exams' })
  @IsString({ each: true })
  @MaxLength(40, {
    each: true,
    message: 'Exam names must be 40 characters or less',
  })
  targetExams: string[];

  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @Type(() => Number)
  @IsInt({ message: 'Duration must be a whole number of years' })
  @Min(1, { message: 'Duration must be 1 to 10 years' })
  @Max(10, { message: 'Duration must be 1 to 10 years' })
  durationYears?: number | null;

  @IsIn(THEME_COLORS, { message: 'Unknown theme colour' })
  themeColor: (typeof THEME_COLORS)[number];

  @IsBoolean()
  isActive: boolean;
}

export class BatchDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Batch name is required' })
  @MaxLength(60, { message: 'Batch name must be 60 characters or less' })
  name: string;

  @IsUUID('4', { message: 'Select the program this batch belongs to' })
  programId: string;

  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @Type(() => Number)
  @IsIn(CLASS_LEVELS, { message: 'Class level must be 6 to 12' })
  classLevel?: number | null;

  @Type(() => Number)
  @IsInt({ message: 'Capacity must be a whole number' })
  @Min(1, { message: 'Capacity must be between 1 and 1000' })
  @Max(1000, { message: 'Capacity must be between 1 and 1000' })
  capacity: number;

  @Matches(ISO_DATE, { message: 'Start date is required' })
  startDate: string;

  @Transform(blankToNull)
  @IsOptional()
  @Matches(ISO_DATE, { message: 'End date is invalid' })
  endDate?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4', { message: 'Unknown coordinator' })
  coordinatorId?: string | null;
}

export class SyllabusItemDto {
  @IsUUID('4', { message: 'Select a batch' })
  batchId: string;

  @IsIn(SUBJECTS, { message: 'Select a subject' })
  subject: (typeof SUBJECTS)[number];

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Chapter title is required' })
  @MaxLength(200, { message: 'Chapter title must be 200 characters or less' })
  title: string;

  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @Type(() => Number)
  @IsInt({ message: 'Estimated hours must be a whole number' })
  @Min(0, { message: 'Estimated hours must be 0 to 1000' })
  @Max(1000, { message: 'Estimated hours must be 0 to 1000' })
  estimatedHours?: number | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(60, { message: 'Target dates must be 60 characters or less' })
  targetDates?: string | null;

  @IsIn(SYLLABUS_STATUSES, { message: 'Unknown status' })
  status: (typeof SYLLABUS_STATUSES)[number];

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Remarks must be 1,000 characters or less' })
  remarks?: string | null;
}

export class SyllabusStatusDto {
  @IsIn(SYLLABUS_STATUSES, { message: 'Unknown status' })
  status: (typeof SYLLABUS_STATUSES)[number];
}

/** One spreadsheet row as the web app parsed it; every cell arrives as text. */
export class SyllabusImportRow {
  @IsOptional() @IsString() @MaxLength(200) school?: string;
  @IsOptional() @IsString() @MaxLength(100) program?: string;
  @IsOptional() @IsString() @MaxLength(100) batch?: string;
  @IsOptional() @IsString() @MaxLength(60) subject?: string;
  @IsOptional() @IsString() @MaxLength(300) title?: string;
  @IsOptional() @IsString() @MaxLength(60) estimatedHours?: string;
  @IsOptional() @IsString() @MaxLength(100) targetDates?: string;
  @IsOptional() @IsString() @MaxLength(40) status?: string;
  @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
}

export class SyllabusImportDefaults {
  @Transform(blankToNull) @IsOptional() @IsUUID('4') programId?: string | null;
  @Transform(blankToNull) @IsOptional() @IsUUID('4') batchId?: string | null;
  @Transform(blankToNull) @IsOptional() @IsIn(SUBJECTS) subject?: string | null;
}

export class SyllabusImportDto {
  @IsArray()
  @ArrayMaxSize(MAX_IMPORT_ROWS, {
    message: `Import at most ${MAX_IMPORT_ROWS} rows at a time`,
  })
  @ValidateNested({ each: true })
  @Type(() => SyllabusImportRow)
  rows: SyllabusImportRow[];

  @IsObject()
  @ValidateNested()
  @Type(() => SyllabusImportDefaults)
  defaults: SyllabusImportDefaults;

  /** true = validate and preview only. */
  @IsBoolean()
  dryRun: boolean;
}

/** One faculty spreadsheet row; every cell arrives as text. */
export class FacultyImportRow {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(64) employeeId?: string;
  @IsOptional() @IsString() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsString() @MaxLength(20) altPhone?: string;
  @IsOptional() @IsString() @MaxLength(20) dateOfBirth?: string;
  @IsOptional() @IsString() @MaxLength(20) gender?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(80) state?: string;
  @IsOptional() @IsString() @MaxLength(10) pincode?: string;
  @IsOptional() @IsString() @MaxLength(200) subjects?: string;
  @IsOptional() @IsString() @MaxLength(120) specialization?: string;
  @IsOptional() @IsString() @MaxLength(120) qualification?: string;
  @IsOptional() @IsString() @MaxLength(10) experienceYears?: string;
  @IsOptional() @IsString() @MaxLength(20) joiningDate?: string;
  @IsOptional() @IsString() @MaxLength(20) status?: string;
  @IsOptional() @IsString() @MaxLength(500) batches?: string;
  @IsOptional() @IsString() @MaxLength(1000) bio?: string;
  @IsOptional() @IsString() @MaxLength(500) profileImageUrl?: string;
}

export class FacultyImportDto {
  @IsArray()
  @ArrayMaxSize(MAX_IMPORT_ROWS, {
    message: `Import at most ${MAX_IMPORT_ROWS} rows at a time`,
  })
  @ValidateNested({ each: true })
  @Type(() => FacultyImportRow)
  rows: FacultyImportRow[];

  @IsBoolean()
  dryRun: boolean;
}

export class DeleteFacultyDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  ids: string[];
}

export class PromotionDecisionDto {
  @Matches(/^\d{4}-\d{4}$/, { message: 'Invalid academic year' })
  academicYear: string;
}
