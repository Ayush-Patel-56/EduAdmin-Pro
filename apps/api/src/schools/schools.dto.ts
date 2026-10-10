import { IsIn, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateSchoolDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'School name is required' })
  @MinLength(3, { message: 'School name must be at least 3 characters' })
  @MaxLength(150)
  name: string;
}

export class CreateJoinCodeDto {
  @IsIn(['TEACHER', 'ADMIN'], { message: 'Role must be TEACHER or ADMIN' })
  role: 'TEACHER' | 'ADMIN';
}
