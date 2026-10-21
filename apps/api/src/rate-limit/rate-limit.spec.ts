import type { ExecutionContext } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DURABLE, HybridThrottlerStorage, durableThrottle, hasDurableLimit } from './hybrid-throttler.storage.js';
import type { RateLimitService } from './rate-limit.service.js';

const storageWith = (hit: RateLimitService['hit']) => new HybridThrottlerStorage({ hit } as unknown as RateLimitService);

describe('HybridThrottlerStorage', () => {
  it('a route without a durable limit never touches Postgres', async () => {
    const storage = storageWith(() => {
      throw new Error('the database was used');
    });
    const totals: number[] = [];
    for (let i = 0; i < 3; i++) totals.push((await storage.increment('ip-1', 60_000, 120, 60_000, 'default')).totalHits);
    expect(totals).toEqual([1, 2, 3]);
    storage.onApplicationShutdown();
  });

  it('maps a durable count to a blocked record past the limit', async () => {
    const hit = vi.fn().mockResolvedValue({ hits: 11, allowed: false, resetAt: new Date(Date.now() + 30_000) });
    const record = await storageWith(hit).increment('login-1', 60_000, 10, 60_000, DURABLE);
    expect(record).toMatchObject({ totalHits: 11, isBlocked: true, timeToExpire: 30, timeToBlockExpire: 30 });
    expect(hit).toHaveBeenCalledWith('login-1', 60_000, 10);
  });

  it('a durable count within the limit is not blocked; the time left is in whole seconds, rounded up', async () => {
    // A fixed clock: 29.001 s left must round up to 30, however slow the machine.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-21T00:00:00Z') });
    try {
      const hit = vi.fn().mockResolvedValue({ hits: 4, allowed: true, resetAt: new Date(Date.now() + 29_001) });
      const record = await storageWith(hit).increment('login-1', 60_000, 10, 60_000, DURABLE);
      expect(record).toMatchObject({ totalHits: 4, isBlocked: false, timeToExpire: 30 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('durableThrottle is the @Throttle argument for the durable throttler', () => {
    expect(durableThrottle(3, 60_000)).toEqual({ durable: { limit: 3, ttl: 60_000 } });
  });
});

describe('hasDurableLimit', () => {
  class Routes {
    @Throttle(durableThrottle(10, 60_000))
    limited() {}

    @Throttle({ default: { limit: 10, ttl: 60_000 } })
    inMemoryOnly() {}

    plain() {}
  }
  const ctx = (route: keyof Routes) => ({ getHandler: () => Routes.prototype[route], getClass: () => Routes }) as unknown as ExecutionContext;

  it('is true only for a route that sets a durable limit', () => {
    expect(hasDurableLimit(ctx('limited'))).toBe(true);
    expect(hasDurableLimit(ctx('inMemoryOnly'))).toBe(false);
    expect(hasDurableLimit(ctx('plain'))).toBe(false);
  });
});
