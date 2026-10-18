import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic/academic.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdminAssessmentsController, TeacherAssessmentsController } from './assessments.controller.js';
import { QuestionsService } from './questions.service.js';
import { TestsService } from './tests.service.js';

@Module({
  imports: [AuthModule, AcademicModule],
  controllers: [AdminAssessmentsController, TeacherAssessmentsController],
  providers: [QuestionsService, TestsService],
})
export class AssessmentsModule {}
