import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic/academic.module.js';
import { AuthModule } from '../auth/auth.module.js';
import {
  AdminScheduleController,
  ScheduleOptionsController,
  TeacherScheduleController,
} from './schedule.controller.js';
import { ScheduleService } from './schedule.service.js';

@Module({
  imports: [AuthModule, AcademicModule],
  controllers: [ScheduleOptionsController, AdminScheduleController, TeacherScheduleController],
  providers: [ScheduleService],
  exports: [ScheduleService],
})
export class ScheduleModule {}
