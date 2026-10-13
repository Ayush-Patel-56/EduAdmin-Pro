import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_IMPORT_ROWS } from '../academic/academic-options.js';
import { IsIndianMobile } from '../common/validators.js';
import {
  BLOOD_GROUPS,
  GENDERS,
  STUDENT_STATUSES,
} from './students-options.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
// Blank optional fields arrive as "" from forms; treat them as not provided.
const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || null : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() || null : value;
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() || null : value;
/** "1234 5678 9012" / "1234-5678-9012" -> "123456789012". */
const digitsOnly = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/[\s-]/g, '') || null : value;
/** "87%" / "87.5" / 87 -> 87.5 as a number; "" -> null. */
const percent = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const text = value.trim().replace(/%$/, '').trim();
  return text === '' ? null : Number(text);
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const ADMISSION_NUMBER = /^[A-Z0-9][A-Z0-9/._-]{0,39}$/;
/** 12 digits; UIDAI never issues numbers starting with 0 or 1. */
export const AADHAAR = /^[2-9]\d{11}$/;
export const PINCODE = /^[1-9]\d{5}$/;

export class StudentDto {
  // 1. Identification
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Full name is required' })
  @MaxLength(120, { message: 'Full name must be 120 characters or less' })
  fullName: string;

  @Transform(upper)
  @IsOptional()
  @Matches(ADMISSION_NUMBER, {
    message:
      'Admission number can use letters, numbers, / . _ and - (max 40)',
  })
  admissionNumber?: string | null;

  @Transform(digitsOnly)
  @IsOptional()
  @Matches(AADHAAR, { message: 'Aadhaar number must be 12 digits, not starting with 0 or 1' })
  aadharNumber?: string | null;

  /** Stored upper-cased, so "r5" and "R5" are the same roll number. */
  @Transform(upper)
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Roll number must be 20 characters or less' })
  rollNumber?: string | null;

  // 2. Contact & address
  @Transform(lower)
  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsIndianMobile({ message: 'Phone must be a 10-digit mobile number' })
  phone?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsIndianMobile({ message: 'Parent contact must be a 10-digit mobile number' })
  parentContact?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  state?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @Matches(PINCODE, { message: 'Pincode must be 6 digits' })
  pincode?: string | null;

  // 3. Personal
  @Transform(blankToNull)
  @IsOptional()
  @Matches(ISO_DATE, { message: 'Date of birth must be a date' })
  dateOfBirth?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsIn(GENDERS, { message: 'Select a gender' })
  gender?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsIn(BLOOD_GROUPS, { message: 'Select a blood group' })
  bloodGroup?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsUrl(
    { protocols: ['https'], require_protocol: true },
    { message: 'Profile image must be an https:// link, or upload a file' },
  )
  @MaxLength(500)
  profileImageUrl?: string | null;

  /** An uploaded photo (purpose STUDENT_PHOTO); null removes it. */
  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4', { message: 'Upload the photo again' })
  photoFileId?: string | null;

  // 4. Academic history
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(150)
  previousSchool?: string | null;

  @Transform(percent)
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'Previous percentage must be a number like 87 or 87.5' },
  )
  @Min(0, { message: 'Previous percentage must be between 0 and 100' })
  @Max(100, { message: 'Previous percentage must be between 0 and 100' })
  previousPercentage?: number | null;

  /** One of the school's classes; checked in the service. */
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(20)
  classLevel?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4', { message: 'Select a program' })
  programId?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4', { message: 'Select a batch' })
  batchId?: string | null;

  // 5. Status & metadata
  @Transform(blankToNull)
  @IsOptional()
  @Matches(ISO_DATE, { message: 'Admission date must be a date' })
  admissionDate?: string | null;

  @IsIn(STUDENT_STATUSES, { message: 'Select a status' })
  status: (typeof STUDENT_STATUSES)[number];

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Notes must be 2,000 characters or less' })
  notes?: string | null;
}

export class GuardianDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Guardian name is required' })
  @MaxLength(120)
  name: string;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  relationship?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsIndianMobile({ message: 'Phone must be a 10-digit mobile number' })
  phone?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsIndianMobile({ message: 'Alt phone must be a 10-digit mobile number' })
  altPhone?: string | null;

  @Transform(lower)
  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  occupation?: string | null;

  @Transform(({ value }: { value: unknown }) =>
    value === '' || value === null ? null : value,
  )
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Annual income must be a whole number of rupees' })
  @Min(0)
  @Max(1_000_000_000)
  annualIncome?: number | null;

  @IsBoolean()
  isPrimary: boolean;
}

export class StudentListQuery {
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(20)
  classLevel?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4', { message: 'Unknown program' })
  programId?: string | null;

  /** A batch id, or "unassigned" for students without a batch. */
  @Transform(blankToNull)
  @IsOptional()
  @Matches(/^(unassigned|[0-9a-f-]{36})$/i, { message: 'Unknown batch' })
  batchId?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsIn(STUDENT_STATUSES, { message: 'Unknown status' })
  status?: (typeof STUDENT_STATUSES)[number] | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

/** One spreadsheet row as text; the service validates every cell. */
export class StudentImportRow {
  @IsOptional() @IsString() @MaxLength(120) fullName?: string;
  @IsOptional() @IsString() @MaxLength(40) admissionNumber?: string;
  @IsOptional() @IsString() @MaxLength(20) aadharNumber?: string;
  @IsOptional() @IsString() @MaxLength(20) rollNumber?: string;
  @IsOptional() @IsString() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsString() @MaxLength(20) parentContact?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(80) state?: string;
  @IsOptional() @IsString() @MaxLength(10) pincode?: string;
  @IsOptional() @IsString() @MaxLength(20) dateOfBirth?: string;
  @IsOptional() @IsString() @MaxLength(20) gender?: string;
  @IsOptional() @IsString() @MaxLength(5) bloodGroup?: string;
  @IsOptional() @IsString() @MaxLength(500) profileImageUrl?: string;
  @IsOptional() @IsString() @MaxLength(150) previousSchool?: string;
  @IsOptional() @IsString() @MaxLength(10) previousPercentage?: string;
  @IsOptional() @IsString() @MaxLength(20) classLevel?: string;
  @IsOptional() @IsString() @MaxLength(60) program?: string;
  @IsOptional() @IsString() @MaxLength(60) batch?: string;
  @IsOptional() @IsString() @MaxLength(20) admissionDate?: string;
  @IsOptional() @IsString() @MaxLength(20) status?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsString() @MaxLength(120) guardianName?: string;
  @IsOptional() @IsString() @MaxLength(40) guardianRelationship?: string;
  @IsOptional() @IsString() @MaxLength(20) guardianPhone?: string;
  @IsOptional() @IsString() @MaxLength(254) guardianEmail?: string;
}

export class StudentImportDefaults {
  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4', { message: 'Select a default program' })
  programId?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4', { message: 'Select a default batch' })
  batchId?: string | null;
}

export class StudentImportDto {
  @IsArray()
  @ArrayMaxSize(MAX_IMPORT_ROWS, {
    message: `Import at most ${MAX_IMPORT_ROWS} rows at a time`,
  })
  @ValidateNested({ each: true })
  @Type(() => StudentImportRow)
  rows: StudentImportRow[];

  @IsBoolean()
  dryRun: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => StudentImportDefaults)
  defaults?: StudentImportDefaults;
}
