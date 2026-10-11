import { describe, expect, it, vi } from 'vitest';
import {
  assertDevEnvironment,
  DEV_ADMIN_CODE,
  seedDevAdminCode,
} from './dev-seed.js';

describe('assertDevEnvironment', () => {
  it.each(['production', 'PRODUCTION', ' production '])(
    'refuses NODE_ENV=%j',
    (value) => {
      expect(() => assertDevEnvironment({ NODE_ENV: value })).toThrow(
        /production/,
      );
    },
  );

  it('refuses an unset, empty or unknown NODE_ENV', () => {
    expect(() => assertDevEnvironment({})).toThrow(/not set/);
    expect(() => assertDevEnvironment({ NODE_ENV: '' })).toThrow(/not set/);
    expect(() => assertDevEnvironment({ NODE_ENV: 'staging' })).toThrow(
      /staging/,
    );
  });

  it.each(['development', 'test'])('allows NODE_ENV=%s', (value) => {
    expect(() => assertDevEnvironment({ NODE_ENV: value })).not.toThrow();
  });
});

describe('seedDevAdminCode', () => {
  it('creates ADMIN123 or clears a revoke, limit and expiry', async () => {
    const upsert = vi.fn().mockResolvedValue({ code: DEV_ADMIN_CODE });
    await seedDevAdminCode({ adminInviteCode: { upsert } } as never);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { code: 'ADMIN123' },
        create: expect.objectContaining({ code: 'ADMIN123' }),
        update: expect.objectContaining({
          revokedAt: null,
          maxUses: null,
          expiresAt: null,
        }),
      }),
    );
  });
});
