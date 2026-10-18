import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || null : value;
/** Keeps line breaks: notes and action items can be several lines. */
const multiline = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : value;
const multilineOrNull = (arg: { value: unknown }) => {
  const value = multiline(arg);
  return value === '' ? null : value;
};
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Log New Parent Meeting (PRD 5.8). The pipe reports the last-listed check
 * first, so "required" goes last on each field.
 */
export class PtmNoteDto {
  /**
   * Required for a new note. When correcting one, leaving it out keeps the
   * note's batch as recorded (even one deleted since); naming one re-checks
   * the student and batch like a new note.
   */
  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4', { message: 'Select a batch' })
  batchId?: string | null;

  /** The meeting day; today by default in the form, never a day still to come. */
  @Matches(ISO_DATE, { message: 'Pick the meeting date' })
  date: string;

  @IsUUID('4', { message: 'Select a student' })
  studentId: string;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(120, { message: 'Keep the parent name under 120 characters' })
  parentName?: string | null;

  @IsBoolean({ message: 'Say whether the parent attended' })
  parentAttended: boolean;

  @Transform(multiline)
  @MaxLength(4000, { message: 'Keep the discussion notes under 4000 characters' })
  @IsString({ message: 'Write the discussion notes' })
  @IsNotEmpty({ message: 'Write the discussion notes' })
  discussion: string;

  @Transform(multilineOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(4000, { message: 'Keep the action items under 4000 characters' })
  actionItems?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @Matches(ISO_DATE, { message: 'Follow-up date must be a date' })
  followUpDate?: string | null;
}

export class PtmNoteQuery {
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string | null;
}
