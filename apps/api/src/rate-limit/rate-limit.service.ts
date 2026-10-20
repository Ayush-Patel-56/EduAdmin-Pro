import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Request counts in Postgres, for limits that must hold across API instances
 * (in-memory counters are per serverless instance). A fixed window per key:
 * the first hit starts it, the window's hits count up, and the first hit
 * after it ends starts a new one.
 */
@Injectable()
export class RateLimitService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Counts one hit on `key` and says whether it is within `limit` hits per
   * `ttlMs`. One atomic statement, so concurrent requests on any instance get
   * distinct counts. Hits past the limit are counted too (and refused).
   */
  async hit(key: string, ttlMs: number, limit: number, now = new Date()): Promise<{ hits: number; allowed: boolean; resetAt: Date }> {
    const [row] = await this.prisma.$queryRaw<{ hits: number; resetAt: Date }[]>`
      INSERT INTO "RateLimit" ("key", "hits", "resetAt")
      VALUES (${key}, 1, ${now}::timestamptz + ${ttlMs}::double precision * interval '1 millisecond')
      ON CONFLICT ("key") DO UPDATE SET
        "hits" = CASE WHEN "RateLimit"."resetAt" <= ${now}::timestamptz THEN 1 ELSE "RateLimit"."hits" + 1 END,
        "resetAt" = CASE WHEN "RateLimit"."resetAt" <= ${now}::timestamptz
          THEN ${now}::timestamptz + ${ttlMs}::double precision * interval '1 millisecond'
          ELSE "RateLimit"."resetAt" END
      RETURNING "hits", "resetAt"`;
    return { hits: row!.hits, allowed: row!.hits <= limit, resetAt: row!.resetAt };
  }

  /** Deletes the windows that have ended; returns how many. */
  async prune(now = new Date()): Promise<number> {
    const { count } = await this.prisma.rateLimit.deleteMany({ where: { resetAt: { lte: now } } });
    return count;
  }
}
