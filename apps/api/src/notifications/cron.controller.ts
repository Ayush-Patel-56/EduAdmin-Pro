import { createHash, timingSafeEqual } from 'node:crypto';
import { Controller, Get, Headers, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '../throttler/index.js';
import { DigestScheduler } from './digest.scheduler.js';

const sha256 = (value: string) => createHash('sha256').update(value).digest();

/**
 * Vercel Cron calls this (GET, with `Authorization: Bearer <CRON_SECRET>`)
 * a few times after the digest hour; the per-user-and-day EmailDigest row
 * makes every extra call a no-op. It has no session: the secret is the guard,
 * and with none configured nothing gets in.
 */
@Controller('internal/cron')
export class CronController {
  constructor(
    private readonly config: ConfigService,
    private readonly scheduler: DigestScheduler,
  ) {}

  @Get('digest')
  @SkipThrottle()
  async digest(@Headers('authorization') authorization?: string) {
    const secret = this.config.get<string>('CRON_SECRET');
    // Hashing first makes both sides the same length, so the compare is constant-time.
    if (!secret || !timingSafeEqual(sha256(`Bearer ${secret}`), sha256(authorization ?? ''))) {
      throw new UnauthorizedException();
    }
    return this.scheduler.runDue();
  }
}
