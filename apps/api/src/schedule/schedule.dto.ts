import { Transform, Type } from 'class-transformer';
import {
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
} from 'class-validator';

const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || null : value;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** 24-hour "HH:MM", Indian time; the forms convert from their AM/PM pickers. */
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const SPECIAL_CLASS_TYPES = ['EXTRA', 'DOUBT', 'REVISION', 'MAKEUP', 'ORIENTATION'] as const;
export type SpecialClassType = (typeof SPECIAL_CLASS_TYPES)[number];

/** A weekly slot as a teacher adds it on their Schedule page (PRD 5.2). */
export class TeacherSlotDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Subject is required' })
  @MaxLength(80)
  subject: string;

  @IsUUID('4', { message: 'Select a batch' })
  batchId: string;

  @Type(() => Number)
  @IsInt({ message: 'Select a day' })
  @Min(0, { message: 'Select a day' })
  @Max(6, { message: 'Select a day' })
  dayOfWeek: number;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  room?: string | null;

  @Matches(TIME, { message: 'Start time is required' })
  startTime: string;

  @Matches(TIME, { message: 'End time is required' })
  endTime: string;

  @Matches(ISO_DATE, { message: 'Effective from must be a date' })
  effectiveFrom: string;

  @Transform(blankToNull)
  @IsOptional()
  @Matches(ISO_DATE, { message: 'Effective to must be a date' })
  effectiveTo?: string | null;
}

/** The admin's Add Slot (PRD 4.1): any teacher of the school, and an active switch. */
export class AdminSlotDto extends TeacherSlotDto {
  @IsUUID('4', { message: 'Select a teacher' })
  facultyId: string;

  @IsBoolean()
  active: boolean;
}

/** A special class as a teacher schedules it (PRD 5.2). */
export class TeacherSpecialClassDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Title is required' })
  @MaxLength(120)
  title: string;

  @IsIn(SPECIAL_CLASS_TYPES, { message: 'Select a class type' })
  type: SpecialClassType;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  subject?: string | null;

  @IsUUID('4', { message: 'Select a batch' })
  batchId: string;

  @Matches(ISO_DATE, { message: 'Date is required' })
  date: string;

  @Matches(TIME, { message: 'Start time is required' })
  startTime: string;

  @Matches(TIME, { message: 'End time is required' })
  endTime: string;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  room?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

/** The admin's Add Special Class (PRD 4.1): the teacher is optional. */
export class AdminSpecialClassDto extends TeacherSpecialClassDto {
  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4', { message: 'Select a teacher' })
  facultyId?: string | null;
}

export class ScheduleQuery {
  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4')
  programId?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4')
  batchId?: string | null;

  /** Special classes: `true` lists the last 60 days instead of what's coming. */
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsOptional()
  @IsBoolean()
  past?: boolean;
}

/** "HH:MM" -> minutes after midnight. */
export function toMinute(time: string) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** 570 -> "9:30 AM" (Indian time, as the forms show it). */
export function formatMinute(minute: number) {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
