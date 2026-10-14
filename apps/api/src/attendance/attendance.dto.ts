import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || null : value;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A class on the picker: "slot:<id>" (weekly) or "special:<id>". */
const CLASS_KEY = /^(slot|special):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export class DayQuery {
  @Matches(ISO_DATE, { message: 'Pick a date' })
  date: string;
}

export class SheetQuery extends DayQuery {
  @Matches(CLASS_KEY, { message: 'Pick a class' })
  class: string;
}

export class AttendanceEntryDto {
  @IsUUID('4')
  studentId: string;

  @IsIn(ATTENDANCE_STATUSES, { message: 'Mark every student Present, Absent, Late or Excused' })
  status: AttendanceStatus;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(300, { message: 'A note can be at most 300 characters' })
  note?: string | null;
}

export class SubmitAttendanceDto extends SheetQuery {
  @IsArray()
  @ArrayMinSize(1, { message: 'There are no students to mark' })
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AttendanceEntryDto)
  records: AttendanceEntryDto[];
}

export const OVERVIEW_RANGES = [7, 30, 90] as const;

export class OverviewQuery {
  @Type(() => Number)
  @IsOptional()
  @IsIn(OVERVIEW_RANGES, { message: 'Pick 7, 30 or 90 days' })
  days?: (typeof OVERVIEW_RANGES)[number];

  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4')
  programId?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4')
  batchId?: string | null;
}
