import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || null : value;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const COUNSELING_TYPES = [
  'ACADEMIC',
  'CAREER',
  'PERSONAL',
  'DISCIPLINARY',
  'PARENT_MEETING',
] as const;
export const COUNSELING_STATUSES = [
  'SCHEDULED',
  'COMPLETED',
  'NO_SHOW',
  'CANCELLED',
] as const;

/** Fields shared by the admin's Schedule Session and the teacher's Log Session. */
export class SessionFields {
  @IsUUID('4', { message: 'Select a student' })
  studentId: string;

  @IsIn(COUNSELING_TYPES, { message: 'Select a session type' })
  type: (typeof COUNSELING_TYPES)[number];

  @Matches(ISO_DATE, { message: 'Date is required' })
  date: string;

  /** IST, 24-hour. */
  @Matches(TIME, { message: 'Time must be a time like 10:00' })
  time: string;

  @Type(() => Number)
  @IsInt({ message: 'Duration must be a whole number of minutes' })
  @Min(5, { message: 'Duration must be at least 5 minutes' })
  @Max(480, { message: 'Duration can be at most 8 hours' })
  durationMinutes: number;

  @Transform(blankToNull)
  @IsOptional()
  @Matches(ISO_DATE, { message: 'Next session date must be a date' })
  nextSessionDate?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  actionItems?: string | null;
}

/** Admin: schedule or edit a session with any counselor (admin or faculty). */
export class ScheduleSessionDto extends SessionFields {
  /** "admin:<userId>" or "faculty:<facultyId>", from GET counseling/counselors. */
  @Matches(/^(admin|faculty):[0-9a-f-]{36}$/i, { message: 'Select a counselor' })
  counselor: string;

  @IsOptional()
  @IsIn(COUNSELING_STATUSES, { message: 'Select a status' })
  status?: (typeof COUNSELING_STATUSES)[number];

  @IsOptional()
  @IsBoolean()
  flagged?: boolean;
}

/** Admin: the registry's quick actions. */
export class SessionStatusDto {
  @IsOptional()
  @IsIn(COUNSELING_STATUSES, { message: 'Select a status' })
  status?: (typeof COUNSELING_STATUSES)[number];

  @IsOptional()
  @IsBoolean()
  flagged?: boolean;
}

export class CounselingQuery {
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsIn(COUNSELING_STATUSES)
  status?: (typeof COUNSELING_STATUSES)[number] | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsIn(COUNSELING_TYPES)
  type?: (typeof COUNSELING_TYPES)[number] | null;

  @Transform(blankToNull)
  @IsOptional()
  @Matches(/^(admin|faculty):[0-9a-f-]{36}$/i, { message: 'Unknown counselor' })
  counselor?: string | null;

  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsOptional()
  @IsBoolean()
  flagged?: boolean;

  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4')
  studentId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

/** Teacher: edit a session they logged (the counselor is always themselves). */
export class TeacherSessionDto extends SessionFields {
  @IsOptional()
  @IsIn(COUNSELING_STATUSES, { message: 'Select a status' })
  status?: (typeof COUNSELING_STATUSES)[number];
}
