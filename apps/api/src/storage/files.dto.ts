import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { FilePurpose } from '../generated/prisma/client.js';
import { MAX_UPLOAD_BYTES } from './files.service.js';

export const FILE_PURPOSES = [
  'STUDENT_PHOTO',
  'FACULTY_PHOTO',
  'STUDY_MATERIAL',
  'ASSIGNMENT_SHEET',
  'SUBMISSION',
] as const satisfies readonly FilePurpose[];

export class CreateUploadDto {
  @IsIn(FILE_PURPOSES, { message: 'Unknown upload type' })
  purpose: FilePurpose;

  @IsString()
  @IsNotEmpty({ message: 'File name is required' })
  @MaxLength(200)
  name: string;

  @IsString()
  @MaxLength(100)
  contentType: string;

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'The file is empty' })
  @Max(MAX_UPLOAD_BYTES, { message: 'The file is too large' })
  size: number;
}

export class CompleteUploadDto {
  @IsIn(FILE_PURPOSES, { message: 'Unknown upload type' })
  purpose: FilePurpose;
}
