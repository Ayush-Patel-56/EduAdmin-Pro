import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SessionGuard } from '../auth/session.guard.js';
import { AcademicAdminController } from './academic-admin.controller.js';
import {
  CLASS_LEVELS,
  FACULTY_STATUSES,
  PROGRAM_TYPES,
  SUBJECTS,
  SYLLABUS_STATUSES,
  TARGET_EXAMS,
  THEME_COLORS,
} from './academic-options.js';
import { AcademicTeacherController } from './academic-teacher.controller.js';
import { AccessService } from './access.service.js';
import { BatchesService } from './batches.service.js';
import { FacultyService } from './faculty.service.js';
import { ProgramsService } from './programs.service.js';
import { PromotionService } from './promotion.service.js';
import { SyllabusService } from './syllabus.service.js';

@Controller('academic')
@UseGuards(SessionGuard)
class AcademicOptionsController {
  @Get('options')
  options() {
    return {
      subjects: SUBJECTS,
      programTypes: PROGRAM_TYPES,
      themeColors: THEME_COLORS,
      targetExams: TARGET_EXAMS,
      classLevels: CLASS_LEVELS,
      syllabusStatuses: SYLLABUS_STATUSES,
      facultyStatuses: FACULTY_STATUSES,
    };
  }
}

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [
    AcademicOptionsController,
    AcademicAdminController,
    AcademicTeacherController,
  ],
  providers: [
    AccessService,
    ProgramsService,
    BatchesService,
    FacultyService,
    SyllabusService,
    PromotionService,
  ],
  exports: [AccessService],
})
export class AcademicModule {}
