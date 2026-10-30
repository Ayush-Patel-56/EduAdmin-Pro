import { Transform, Type } from 'class-transformer';
import { IsInt, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { multiline } from './feedback.dto.js';

export const MIN_STUDENT_COMMENT = 10;
export const MAX_STUDENT_COMMENT = 1000;

/** What a student sends through their batch's feedback link. The pipe reports the last-listed check first. */
export class StudentFeedbackDto {
  @IsUUID('all', { message: 'Pick your name from the list' })
  studentId: string;

  @IsUUID('all', { message: 'Pick a teacher from the list' })
  facultyId: string;

  @Type(() => Number)
  @Min(1, { message: 'Give a rating of 1 to 5 stars' })
  @Max(5, { message: 'Give a rating of 1 to 5 stars' })
  @IsInt({ message: 'Give a rating of 1 to 5 stars' })
  rating: number;

  @Transform(multiline)
  @MaxLength(MAX_STUDENT_COMMENT, { message: 'Keep it under 1,000 characters' })
  @MinLength(MIN_STUDENT_COMMENT, { message: 'Write at least 10 characters' })
  @IsString({ message: 'Write at least 10 characters' })
  comment: string;
}
