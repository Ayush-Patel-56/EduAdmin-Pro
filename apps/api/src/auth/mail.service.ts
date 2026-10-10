import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// No email provider is wired up yet: links are logged to the console so the
// flow can be tested locally. Swap the body for a provider (e.g. Resend) later.
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendVerificationEmail(to: string, token: string): Promise<void> {
    const origin = this.config.get<string>('WEB_ORIGIN', 'http://localhost:5173');
    const link = `${origin}/verify-email?token=${encodeURIComponent(token)}`;
    this.logger.log(`Verification link for ${to}: ${link}`);
  }
}
