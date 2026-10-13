import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { FACULTY_STATUSES } from '../academic/academic-options.js';
import { IsIndianMobile } from '../common/validators.js';
import { DEPARTMENTS } from '../recruitment/recruitment-options.js';
import { GENDERS } from '../students/students-options.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || null : value;
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() || null : value;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PINCODE = /^[1-9]\d{5}$/;

export const DESIGNATIONS = ['TEACHER', 'COORDINATOR'] as const;
export const BATCH_ROLES = ['PRIMARY', 'SUBSTITUTE', 'ASSISTANT'] as const;
/** Primary streams offered on the profile (the recruitment departments). */
export const STREAMS = DEPARTMENTS;

/** The contact fields a teacher may change on their own profile. */
export class OwnProfileDto {
  @Transform(blankToNull)
  @IsOptional()
  @IsIndianMobile({ message: 'Phone must be a 10-digit mobile number' })
  phone?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsIndianMobile({ message: 'Alt phone must be a 10-digit mobile number' })
  altPhone?: string | null;

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

  @Transform(blankToNull)
  @IsOptional()
  @IsUrl(
    { protocols: ['https'], require_protocol: true },
    { message: 'Profile image must be an https:// link, or upload a file' },
  )
  @MaxLength(500)
  profileImageUrl?: string | null;

  /** An uploaded photo (purpose FACULTY_PHOTO); null removes it. */
  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4', { message: 'Upload the photo again' })
  photoFileId?: string | null;
}

/** Edit Faculty (PRD 4.7), admins only. */
export class FacultyDto extends OwnProfileDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Full name is required' })
  @MaxLength(120)
  name: string;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  employeeId?: string | null;

  @Transform(lower)
  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email?: string | null;

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
  @IsString()
  @MaxLength(1000)
  bio?: string | null;

  /** The subject taught (primary); more can be added on the profile. */
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Subject is required' })
  @MaxLength(40)
  subject: string;

  /** Exam focus, e.g. "JEE Main" or "NEET UG". */
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Specialisation is required' })
  @MaxLength(120)
  specialization: string;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  qualification?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsIn(STREAMS, { message: 'Select a primary stream' })
  primaryStream?: string | null;

  @Transform(({ value }: { value: unknown }) =>
    value === '' || value === null ? null : value,
  )
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Experience must be a whole number of years' })
  @Min(0)
  @Max(60)
  experienceYears?: number | null;

  @Transform(blankToNull)
  @IsOptional()
  @Matches(ISO_DATE, { message: 'Joining date must be a date' })
  joiningDate?: string | null;

  @IsIn(FACULTY_STATUSES, { message: 'Select a status' })
  status: (typeof FACULTY_STATUSES)[number];

  /** The batches the teacher takes; new ones are added with the Primary role. */
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true, message: 'Select batches from this school' })
  batchIds: string[];
}

export class SubjectsDto {
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((v) => (typeof v === 'string' ? v.trim() : v)).filter(Boolean)
      : value,
  )
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true, message: 'A subject is at most 40 characters' })
  subjects: string[];

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  primarySubject?: string | null;
}

export class BatchAssignmentDto {
  @IsUUID('4', { message: 'Select a batch' })
  batchId: string;

  @IsIn(BATCH_ROLES, { message: 'Select a role' })
  role: (typeof BATCH_ROLES)[number];
}

export class DesignationDto {
  @IsIn(DESIGNATIONS, { message: 'Select Teacher or Coordinator' })
  designation: (typeof DESIGNATIONS)[number];
}
