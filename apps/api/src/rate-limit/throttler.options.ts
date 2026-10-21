import type { ThrottlerModuleOptions } from '../throttler/index.js';
import { DURABLE, HybridThrottlerStorage, hasDurableLimit } from './hybrid-throttler.storage.js';
import type { RateLimitService } from './rate-limit.service.js';

/**
 * 120 requests a minute per IP counts in memory on each instance. The durable
 * throttler counts in Postgres and runs only on routes that set a durable
 * limit (login, verification codes), so those hold across instances.
 */
export const throttlerOptions = (rateLimit: RateLimitService): ThrottlerModuleOptions => ({
  throttlers: [
    { name: 'default', ttl: 60_000, limit: 120 },
    { name: DURABLE, ttl: 60_000, limit: 10, skipIf: (ctx) => !hasDurableLimit(ctx) },
  ],
  storage: new HybridThrottlerStorage(rateLimit),
});
