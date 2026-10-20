import { Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { RateLimitService } from './rate-limit.service.js';

/** The throttler whose counts live in Postgres; every other throttler counts in memory. */
export const DURABLE = 'durable';

/** The `@Throttle(...)` argument for a limit that holds across API instances (alongside, not instead of, the in-memory one). */
export const durableThrottle = (limit: number, ttlMs: number) => ({ [DURABLE]: { limit, ttl: ttlMs } });

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

const reflector = new Reflector();

/**
 * Whether the route (or its controller) sets a durable limit; the durable
 * throttler skips every route that doesn't, since it has no default limit.
 * `@Throttle` stores the limit under this key (the library doesn't export it).
 */
export const hasDurableLimit = (context: ExecutionContext) =>
  reflector.getAllAndOverride<number | undefined>(`THROTTLER:LIMIT${DURABLE}`, [context.getHandler(), context.getClass()]) !== undefined;

/**
 * The throttler's storage: the `durable` throttler counts in Postgres, so a
 * limit holds however many serverless instances serve the requests; the rest
 * (the global per-IP limit) stay in memory, where a miscount is cheap and a
 * database round trip on every request is not.
 */
@Injectable()
export class HybridThrottlerStorage implements ThrottlerStorage {
  private readonly memory = new ThrottlerStorageService();

  constructor(private readonly rateLimit: RateLimitService) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    if (throttlerName !== DURABLE) return this.memory.increment(key, ttl, limit, blockDuration, throttlerName);
    const { hits, allowed, resetAt } = await this.rateLimit.hit(key, ttl, limit);
    const timeToExpire = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
    return { totalHits: hits, timeToExpire, isBlocked: !allowed, timeToBlockExpire: timeToExpire };
  }

  onApplicationShutdown() {
    this.memory.onApplicationShutdown();
  }
}
