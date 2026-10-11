import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic/academic.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { SchoolsController } from './schools.controller.js';
import { SchoolsService } from './schools.service.js';
import { TeacherController } from './teacher.controller.js';

@Module({
  imports: [AuthModule, AcademicModule],
  controllers: [SchoolsController, TeacherController],
  providers: [SchoolsService],
})
export class SchoolsModule {}
