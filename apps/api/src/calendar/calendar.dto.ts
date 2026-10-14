import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || null : value;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const EVENT_TYPES = ['HOLIDAY', 'EXAM', 'EVENT', 'PARENT_MEETING'] as const;
export const EVENT_REPEATS = ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY'] as const;
export const EVENT_SCOPES = ['SCHOOL', 'PROGRAM', 'BATCH'] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export type EventRepeat = (typeof EVENT_REPEATS)[number];

/** Add Event / Edit Event. */
export class CalendarEventDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Title is required' })
  @MaxLength(150)
  title: string;

  @IsIn(EVENT_TYPES, { message: 'Select an event type' })
  type: EventType;

  /** Who it is for: the whole school, one program or one batch. */
  @IsIn(EVENT_SCOPES, { message: 'Select who the event is for' })
  scope: (typeof EVENT_SCOPES)[number];

  @ValidateIf((o: CalendarEventDto) => o.scope === 'PROGRAM')
  @IsUUID('4', { message: 'Select a program' })
  programId?: string | null;

  @ValidateIf((o: CalendarEventDto) => o.scope === 'BATCH')
  @IsUUID('4', { message: 'Select a batch' })
  batchId?: string | null;

  @Matches(ISO_DATE, { message: 'Start date is required' })
  startDate: string;

  @Matches(ISO_DATE, { message: 'End date is required' })
  endDate: string;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsIn(EVENT_REPEATS, { message: 'Select how it repeats' })
  repeat: EventRepeat;

  @Transform(blankToNull)
  @IsOptional()
  @Matches(ISO_DATE, { message: 'Repeat until must be a date' })
  repeatUntil?: string | null;
}

export class EventRangeQuery {
  @Matches(ISO_DATE, { message: 'From must be a date' })
  from: string;

  @Matches(ISO_DATE, { message: 'To must be a date' })
  to: string;

  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4')
  programId?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4')
  batchId?: string | null;
}

export class UpcomingQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4')
  programId?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4')
  batchId?: string | null;
}
