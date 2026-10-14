import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || null : value;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
/** Keeps line breaks (discussion and action can be several lines). */
const blankToNullMultiline = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/[ \t]+/g, ' ').trim() || null : value;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const MEETING_TYPES = ['GENERAL', 'MANAGEMENT', 'PARENT_TEACHER', 'STAFF', 'DISCIPLINARY'] as const;
export const AGENDA_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export const AGENDA_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];
export type AgendaPriority = (typeof AGENDA_PRIORITIES)[number];
export type AgendaStatus = (typeof AGENDA_STATUSES)[number];

/** Log New Meeting / Edit Meeting. */
export class MeetingDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Title is required' })
  @MaxLength(150)
  title: string;

  @Matches(ISO_DATE, { message: 'Date is required' })
  date: string;

  /** 24-hour "HH:MM", Indian time. */
  @Transform(blankToNull)
  @IsOptional()
  @Matches(TIME, { message: 'Time must be a time like 15:30' })
  time?: string | null;

  @IsIn(MEETING_TYPES, { message: 'Select a meeting type' })
  type: MeetingType;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  venue?: string | null;

  /** Comma-separated, e.g. "Principal, HODs". */
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  attendees?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  minutesPreparedBy?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @Matches(ISO_DATE, { message: 'Next meeting date must be a date' })
  nextMeetingDate?: string | null;
}

export class MeetingQuery {
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string | null;
}

/** An agenda / discussion item, as added or edited. */
export class AgendaItemDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Agenda is required' })
  @MaxLength(300)
  title: string;

  @Transform(blankToNullMultiline)
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  discussion?: string | null;

  @Transform(blankToNullMultiline)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  action?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  responsible?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @Matches(ISO_DATE, { message: 'Target date must be a date' })
  targetDate?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  communicatedTo?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  communicatedBy?: string | null;

  @IsIn(AGENDA_PRIORITIES, { message: 'Select a priority' })
  priority: AgendaPriority;

  @IsIn(AGENDA_STATUSES, { message: 'Select a status' })
  status: AgendaStatus;
}

/** The status and priority pills change one field at a time. */
export class AgendaStateDto {
  @IsOptional()
  @IsIn(AGENDA_STATUSES, { message: 'Select a status' })
  status?: AgendaStatus;

  @IsOptional()
  @IsIn(AGENDA_PRIORITIES, { message: 'Select a priority' })
  priority?: AgendaPriority;
}
