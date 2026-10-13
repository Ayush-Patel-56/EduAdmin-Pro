import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic/academic.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { StudentsModule } from '../students/students.module.js';
import {
  AdminCounselingController,
  CounselingOptionsController,
  TeacherCounselingController,
} from './counseling.controller.js';
import { CounselingService } from './counseling.service.js';

@Module({
  imports: [AuthModule, AcademicModule, StudentsModule],
  controllers: [
    CounselingOptionsController,
    AdminCounselingController,
    TeacherCounselingController,
  ],
  providers: [CounselingService],
})
export class CounselingModule {}
