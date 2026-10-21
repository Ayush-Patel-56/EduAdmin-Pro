import { Controller, Get, Req, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle, Throttle } from './throttler/index.js';
import type { Request } from 'express';
import { PrismaService } from './prisma/prisma.service.js';

const READY_TIMEOUT_MS = 3_000;
// A fresh database check at most this often, however many callers ask.
export const READY_CACHE_MS = 5_000;

@Controller('health')
export class AppController {
  private lastReady: { at: number; ok: boolean } | null = null;
  private inFlight: Promise<boolean> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: the process is up. Never touches the database, so it isn't rate limited. */
  @Get()
  @SkipThrottle()
  health() {
    return { status: 'ok' };
  }

  @Get('live')
  @SkipThrottle()
  live() {
    return this.health();
  }

  /**
   * The address Express resolved for the caller (after the trust-proxy setting),
   * and nothing else: lets a deploy check what the rate limiter will key on.
   */
  @Get('ip')
  ip(@Req() req: Request) {
    return { ip: req.ip };
  }

  /**
   * Readiness: the API can serve requests, i.e. the database answers. This one
   * is rate limited and its result is cached for a few seconds, so a flood of
   * calls can't turn into a flood of queries (or keep Neon awake).
   */
  @Get('ready')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async ready() {
    if (!(await this.databaseUp())) {
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'down',
      });
    }
    return { status: 'ok', database: 'up' };
  }

  private async databaseUp(): Promise<boolean> {
    const now = Date.now();
    if (this.lastReady && now - this.lastReady.at < READY_CACHE_MS)
      return this.lastReady.ok;
    // Concurrent callers share one in-flight check.
    this.inFlight ??= withTimeout(
      this.prisma.$queryRaw`SELECT 1`,
      READY_TIMEOUT_MS,
    )
      .then(() => true)
      .catch(() => false)
      .then((ok) => {
        this.lastReady = { at: Date.now(), ok };
        return ok;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
