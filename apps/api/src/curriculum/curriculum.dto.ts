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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  CURRICULUM_BOARDS,
  MAX_IMPORT_ROWS,
  SUBJECTS,
} from '../academic/academic-options.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || null : value;
const code = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() || null : value;

export const CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,39}$/;
const CODE_MESSAGE =
  'Codes use letters, numbers, dots and dashes (max 40), e.g. PHY-11-CH03';

export class ChapterDto {
  @IsIn(SUBJECTS, { message: 'Select a subject' })
  subject: (typeof SUBJECTS)[number];

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Chapter name is required' })
  @MaxLength(150, { message: 'Chapter name must be 150 characters or less' })
  name: string;

  @Transform(code)
  @IsOptional()
  @Matches(CODE_PATTERN, { message: CODE_MESSAGE })
  code?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsIn(CURRICULUM_BOARDS, { message: 'Unknown board' })
  board?: (typeof CURRICULUM_BOARDS)[number] | null;

  /** One of the school's classes; checked in the service. */
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(20)
  classLevel?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4', { message: 'Unknown program' })
  programId?: string | null;

  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @Type(() => Number)
  @IsInt({ message: 'Expected hours must be a whole number' })
  @Min(0, { message: 'Expected hours must be 0 to 1000' })
  @Max(1000, { message: 'Expected hours must be 0 to 1000' })
  expectedHours?: number | null;
}

export class ConceptDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Concept name is required' })
  @MaxLength(150, { message: 'Concept name must be 150 characters or less' })
  name: string;

  @Transform(code)
  @IsOptional()
  @Matches(CODE_PATTERN, { message: CODE_MESSAGE })
  code?: string | null;
}

/** One spreadsheet row (PRD §7): one row per concept, chapter columns repeated. */
export class CurriculumImportRow {
  @IsOptional() @IsString() @MaxLength(60) subject?: string;
  @IsOptional() @IsString() @MaxLength(200) chapterName?: string;
  @IsOptional() @IsString() @MaxLength(60) chapterCode?: string;
  @IsOptional() @IsString() @MaxLength(60) board?: string;
  @IsOptional() @IsString() @MaxLength(30) classLevel?: string;
  @IsOptional() @IsString() @MaxLength(100) program?: string;
  @IsOptional() @IsString() @MaxLength(30) expectedHours?: string;
  @IsOptional() @IsString() @MaxLength(200) conceptName?: string;
  @IsOptional() @IsString() @MaxLength(60) conceptCode?: string;
}

export class CurriculumImportDto {
  @IsArray()
  @ArrayMaxSize(MAX_IMPORT_ROWS, {
    message: `Import at most ${MAX_IMPORT_ROWS} rows at a time`,
  })
  @ValidateNested({ each: true })
  @Type(() => CurriculumImportRow)
  rows: CurriculumImportRow[];

  /** Subject for rows without a Subject column; null = read it from each row. */
  @Transform(blankToNull)
  @IsOptional()
  @IsIn(SUBJECTS, { message: 'Unknown subject' })
  subject?: string | null;

  @IsBoolean()
  dryRun: boolean;
}
