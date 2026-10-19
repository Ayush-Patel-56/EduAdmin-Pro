import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DigestService } from './digest.service.js';
import { NotificationsService } from './notifications.service.js';

/** How often the job looks for digests that are due. */
const TICK_MS = 10 * 60_000;
const IST_OFFSET_MS = 5.5 * 3_600_000;

/**
 * Sends the daily report digests from DIGEST_HOUR_IST (19:00 by default) and
 * prunes old read notifications. Runs inside the API: every instance ticks,
 * and the per-user-and-day EmailDigest row makes sure each digest goes once.
 * DIGEST_ENABLED=false turns it off (it never runs under tests).
 */
@Injectable()
export class DigestScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DigestScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly hour: number;
  private readonly enabled: boolean;

  constructor(
    config: ConfigService,
    private readonly digests: DigestService,
    private readonly notifications: NotificationsService,
  ) {
    const hour = Number(config.get<string>('DIGEST_HOUR_IST', '19'));
    this.hour = Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 19;
    this.enabled = config.get<string>('DIGEST_ENABLED', 'true') !== 'false' && config.get<string>('NODE_ENV') !== 'test' && !process.env.VITEST;
  }

  onModuleInit() {
    if (!this.enabled) return;
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

  async tick(now = new Date()) {
    if (this.running || !this.isDue(now)) return;
    this.running = true;
    try {
      const sent = await this.digests.sendDue(now);
      const pruned = await this.notifications.prune(now);
      if (sent || pruned) this.logger.log(`Sent ${sent} digest(s), pruned ${pruned} notification(s)`);
    } catch (err) {
      this.logger.warn(`Digest run failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
