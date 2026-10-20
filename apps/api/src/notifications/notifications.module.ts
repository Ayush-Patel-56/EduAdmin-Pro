import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DigestScheduler } from './digest.scheduler.js';
import { DigestService } from './digest.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, DigestService, DigestScheduler],
  exports: [NotificationsService],
})
export class NotificationsModule {}
