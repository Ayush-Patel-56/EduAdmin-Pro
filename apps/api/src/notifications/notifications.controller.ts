import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { Auth, type AuthContext, SessionGuard } from '../auth/session.guard.js';
import { DigestService } from './digest.service.js';
import { NotificationsService } from './notifications.service.js';

/** The signed-in user's own notifications (the bell) and digest. Nothing here takes a user id: it is always the caller's. */
@Controller('notifications')
@UseGuards(SessionGuard)
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly digests: DigestService,
  ) {}

  @Get()
  list(@Auth() auth: AuthContext) {
    return this.notifications.list(auth.userId);
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@Auth() auth: AuthContext) {
    return this.notifications.markAllRead(auth.userId);
  }

  @Patch(':id/read')
  read(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(auth.userId, id);
  }

  /** Email me today's digest now (Account Preferences): a few per hour per account (DigestService). */
  @Post('digest/send')
  @HttpCode(200)
  sendDigest(@Auth() auth: AuthContext) {
    return this.digests.sendNow(auth.userId);
  }
}
