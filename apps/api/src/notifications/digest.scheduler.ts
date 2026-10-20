import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DigestService } from './digest.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { NotificationsService } from './notifications.service.js';

/** How often the job looks for digests that are due. */
const TICK_MS = 10 * 60_000;
const IST_OFFSET_MS = 5.5 * 3_600_000;

/**
 * Sends the daily report digests from DIGEST_HOUR_IST (19:00 by default) and
 * prunes old read notifications. Runs inside the API: every instance ticks,
 * and the per-user-and-day EmailDigest row makes sure each digest goes once.
 * On Vercel there is no long-lived process: Vercel Cron calls runDue through
 * CronController, and the interval never starts (nor under tests).
 * DIGEST_ENABLED=false stops the digest emails in both cases; pruning goes on.
 */
@Injectable()
export class DigestScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DigestScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly hour: number;
  /** Whether the setInterval loop runs here (not on Vercel, not under tests). */
  private readonly ticking: boolean;
  /** DIGEST_ENABLED: whether digest emails go out at all, however runDue is called. */
  private readonly digestsEnabled: boolean;

  constructor(
    config: ConfigService,
    private readonly digests: DigestService,
    private readonly notifications: NotificationsService,
    private readonly rateLimit: RateLimitService,
  ) {
    const hour = Number(config.get<string>('DIGEST_HOUR_IST', '19'));
    this.hour = Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 19;
    this.digestsEnabled = config.get<string>('DIGEST_ENABLED', 'true') !== 'false';
    this.ticking = config.get<string>('NODE_ENV') !== 'test' && !process.env.VITEST && process.env.VERCEL !== '1';
  }

  onModuleInit() {
    if (!this.ticking) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Due when the hour has come in India today. */
  isDue(now = new Date()) {
    return new Date(now.getTime() + IST_OFFSET_MS).getUTCHours() >= this.hour;
  }

  /**
   * One pass: when due, send the digests (unless DIGEST_ENABLED=false) and
   * prune old rows. Errors propagate to the caller.
   */
  async runDue(now = new Date()) {
    if (!this.isDue(now)) return { due: false, sent: 0, pruned: 0 };
    const sent = this.digestsEnabled ? await this.digests.sendDue(now) : 0;
    const pruned = (await this.notifications.prune(now)) + (await this.rateLimit.prune(now));
    if (sent || pruned) this.logger.log(`Sent ${sent} digest(s), pruned ${pruned} row(s)`);
    return { due: true, sent, pruned };
  }

  async tick(now = new Date()) {
    if (this.running || !this.isDue(now)) return;
    this.running = true;
    try {
      await this.runDue(now);
    } catch (err) {
      this.logger.warn(`Digest run failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
