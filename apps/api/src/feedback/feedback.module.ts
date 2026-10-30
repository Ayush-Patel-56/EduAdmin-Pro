import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic/academic.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdminFeedbackController, TeacherFeedbackController } from './feedback.controller.js';
import { FeedbackService } from './feedback.service.js';
import { FeedbackLinksService } from './feedback-links.service.js';
import { PublicFeedbackController } from './public-feedback.controller.js';
import { PublicFeedbackService } from './public-feedback.service.js';

@Module({
  imports: [AuthModule, AcademicModule],
  controllers: [AdminFeedbackController, TeacherFeedbackController, PublicFeedbackController],
  providers: [FeedbackService, FeedbackLinksService, PublicFeedbackService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
