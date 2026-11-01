import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CronController } from './cron.controller.js';
import { DigestScheduler } from './digest.scheduler.js';
import { DigestService } from './digest.service.js';
import { NotificationsController } from './notifications.controller.js';
import { RetentionService } from '../retention/retention.service.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController, CronController],
  providers: [NotificationsService, DigestService, DigestScheduler, RetentionService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
