import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IsGstin, IsIndianMobile } from '../common/validators.js';
import { CLASS_OPTIONS } from './school-options.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
// Blank optional fields arrive as "" from the form; treat them as not provided.
const trimOrUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateSchoolDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'School name is required' })
  @MinLength(3, { message: 'School name must be at least 3 characters' })
  @MaxLength(150)
  name: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Please select a board' })
  @MaxLength(60, { message: 'Board name is too long' })
  board: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Select at least one class' })
  @IsIn(CLASS_OPTIONS, { each: true, message: 'Unknown class selected' })
  classes: string[];

  // 1 = January … 12 = December. Defaults to April when omitted.
  @IsOptional()
  @IsInt({ message: 'Academic year start month is invalid' })
  @Min(1, { message: 'Academic year start month is invalid' })
  @Max(12, { message: 'Academic year start month is invalid' })
  academicYearStartMonth?: number;

  @Transform(trimOrUndefined)
  @IsOptional()
  @Matches(ISO_DATE, { message: 'MOU start date is invalid' })
  mouStartDate?: string;

  @Transform(trimOrUndefined)
  @IsOptional()
  @Matches(ISO_DATE, { message: 'MOU end date is invalid' })
  mouEndDate?: string;

  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.trim() : v)) : value,
  )
  @IsArray()
  @ArrayMaxSize(20, { message: 'Too many programs' })
  @IsString({ each: true })
  @IsNotEmpty({ each: true, message: 'Program names cannot be empty' })
  @MaxLength(40, { each: true, message: 'Program names must be 40 characters or less' })
  programs: string[];

  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactPerson?: string;

  @Transform(trimOrUndefined)
  @IsOptional()
  @IsIndianMobile()
  phone?: string;

  @Transform(trimOrUndefined)
  @IsOptional()
  @IsEmail({}, { message: 'Please enter a valid email address' })
  @MaxLength(254)
  email?: string;

  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Address must be 500 characters or less' })
  address?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\s/g, '').toUpperCase() || undefined : value,
  )
  @IsOptional()
  @IsGstin()
  gstNumber?: string;
}

export class JoinSchoolDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'Invite code is required' })
  @MaxLength(32)
  inviteCode: string;
}

export class ConfirmNameDto {
  @IsString()
  @IsNotEmpty({ message: 'Type the school name to confirm' })
  @MaxLength(150)
  confirmName: string;
}
