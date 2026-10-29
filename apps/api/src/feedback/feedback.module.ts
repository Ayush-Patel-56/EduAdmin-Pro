import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic/academic.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdminFeedbackController, TeacherFeedbackController } from './feedback.controller.js';
import { FeedbackService } from './feedback.service.js';
import { FeedbackLinksService } from './feedback-links.service.js';

@Module({
  imports: [AuthModule, AcademicModule],
  controllers: [AdminFeedbackController, TeacherFeedbackController],
  providers: [FeedbackService, FeedbackLinksService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
