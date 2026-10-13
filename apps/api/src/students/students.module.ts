import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic/academic.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { StorageModule } from '../storage/storage.module.js';
import {
  StudentOptionsController,
  StudentsController,
  TeacherStudentsController,
} from './students.controller.js';
import { StudentImportService } from './students-import.service.js';
import { StudentsService } from './students.service.js';

@Module({
  imports: [AuthModule, AcademicModule, StorageModule],
  controllers: [
    StudentOptionsController,
    StudentsController,
    TeacherStudentsController,
  ],
  providers: [StudentsService, StudentImportService],
  exports: [StudentsService],
})
export class StudentsModule {}
