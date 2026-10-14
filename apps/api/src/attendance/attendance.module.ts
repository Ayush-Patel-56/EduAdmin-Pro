import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic/academic.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ScheduleModule } from '../schedule/schedule.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { AdminAttendanceController, TeacherAttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';

@Module({
  imports: [AuthModule, AcademicModule, ScheduleModule, StorageModule],
  controllers: [AdminAttendanceController, TeacherAttendanceController],
  providers: [AttendanceService],
})
export class AttendanceModule {}
