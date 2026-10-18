import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic/academic.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { MarksService } from './marks.service.js';
import { RatingsService } from './ratings.service.js';
import { StudentReportService } from './student-report.service.js';
import { AdminStudentReportsController, TeacherRatingsController, TeacherStudentReportsController } from './student-reports.controller.js';

@Module({
  imports: [AuthModule, AcademicModule],
  controllers: [AdminStudentReportsController, TeacherStudentReportsController, TeacherRatingsController],
  providers: [StudentReportService, MarksService, RatingsService],
})
export class StudentReportsModule {}
