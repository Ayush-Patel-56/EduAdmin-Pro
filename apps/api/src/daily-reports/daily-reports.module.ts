import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic/academic.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdminDailyReportsController, TeacherDailyReportsController } from './daily-reports.controller.js';
import { DailyReportsService } from './daily-reports.service.js';

@Module({
  imports: [AuthModule, AcademicModule],
  controllers: [AdminDailyReportsController, TeacherDailyReportsController],
  providers: [DailyReportsService],
})
export class DailyReportsModule {}
