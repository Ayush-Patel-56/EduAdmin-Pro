import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic/academic.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { FacultyProfileService } from './faculty-profile.service.js';
import {
  TeacherPortalController,
  TeacherProfileController,
} from './teacher-portal.controller.js';

@Module({
  imports: [AuthModule, AcademicModule, StorageModule],
  controllers: [TeacherPortalController, TeacherProfileController],
  providers: [FacultyProfileService],
})
export class TeacherPortalModule {}
