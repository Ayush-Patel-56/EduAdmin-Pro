import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic/academic.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CalendarController } from './calendar.controller.js';
import { CalendarService } from './calendar.service.js';

@Module({
  imports: [AuthModule, AcademicModule],
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}
