import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  Matches,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

class BaseSignupDto {
  @IsString()
  @IsNotEmpty({ message: 'Full name is required' })
  @MaxLength(120)
  fullName: string;

  @IsEmail({}, { message: 'Please enter a valid email address' })
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128)
  password: string;
}

export class TeacherSignupDto extends BaseSignupDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  department?: string;

  // Optional: with a valid code the teacher joins that school straight away.
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value))
  @IsOptional()
  @IsString()
  @MaxLength(32)
  schoolCode?: string;
}

export class AdminSignupDto extends BaseSignupDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  employeeId?: string;

  @IsString()
  @IsNotEmpty({ message: 'Admin invite code is required' })
  @MaxLength(32)
  inviteCode: string;
}

export class LoginDto {
  @IsEmail({}, { message: 'Please enter a valid email address' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MaxLength(128)
  password: string;
}

export class VerifyEmailDto {
  @IsEmail({}, { message: 'Please enter a valid email address' })
  email: string;

  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code from your email' })
  code: string;
}

export class ResendVerificationDto {
  @IsEmail({}, { message: 'Please enter a valid email address' })
  email: string;
}

export class SetActiveSchoolDto {
  @IsUUID('4', { message: 'Invalid school' })
  schoolId: string;
}
