import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AvatarController } from './avatar.controller.js';
import { AvatarService } from './avatar.service.js';
import { EmailVerificationService } from './email-verification.service.js';
import { MailService } from './mail.service.js';
import { SessionGuard } from './session.guard.js';

@Module({
  controllers: [AuthController, AvatarController],
  providers: [AuthService, AvatarService, EmailVerificationService, MailService, SessionGuard],
  exports: [SessionGuard, MailService],
})
export class AuthModule {}
