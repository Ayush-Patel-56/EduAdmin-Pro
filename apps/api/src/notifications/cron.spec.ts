import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { CronController } from './cron.controller.js';
import { DigestScheduler } from './digest.scheduler.js';

describe('CronController', () => {
  const ctl = (secret: string | undefined, runDue = vi.fn()) => new CronController({ get: () => secret } as never, { runDue } as never);

  it('401 without the right bearer, and 401 when CRON_SECRET is unset (constant-time compare)', async () => {
    const run = vi.fn();
    await expect(ctl('s3cret', run).digest('Bearer nope')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(ctl(undefined, run).digest('Bearer ')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(ctl('', run).digest('Bearer ')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(ctl('s3cret', run).digest(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(run).not.toHaveBeenCalled();
  });

  it('with the secret, runs the due work once and returns its counts', async () => {
    const run = vi.fn().mockResolvedValue({ due: true, sent: 2, pruned: 5 });
    await expect(ctl('s3cret', run).digest('Bearer s3cret')).resolves.toEqual({ due: true, sent: 2, pruned: 5 });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('DigestScheduler on Vercel Cron', () => {
  const config = (values: Record<string, string>) => ({ get: (k: string, d?: string) => values[k] ?? d }) as unknown as ConfigService;
  const build = () => {
    const digests = { sendDue: vi.fn().mockResolvedValue(3) };
    const notifications = { prune: vi.fn().mockResolvedValue(4) };
    const rateLimit = { prune: vi.fn().mockResolvedValue(5) };
    const scheduler = new DigestScheduler(config({ DIGEST_HOUR_IST: '19', DIGEST_ENABLED: 'true' }), digests as never, notifications as never, rateLimit as never);
    return { digests, notifications, rateLimit, scheduler };
  };

  it('the interval scheduler never starts on Vercel', () => {
    const before = process.env.VERCEL;
    const before2 = process.env.VITEST;
    const spy = vi.spyOn(globalThis, 'setInterval');
    try {
      // Enabled everywhere but Vercel (VITEST is what keeps it off under tests).
      delete process.env.VITEST;
      process.env.VERCEL = '1';
      const onVercel = build().scheduler;
      onVercel.onModuleInit();
      expect(spy).not.toHaveBeenCalled();
      delete process.env.VERCEL;
      const elsewhere = build().scheduler;
      elsewhere.onModuleInit();
      expect(spy).toHaveBeenCalledTimes(1);
      elsewhere.onModuleDestroy();
    } finally {
      spy.mockRestore();
      if (before === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = before;
      if (before2 === undefined) delete process.env.VITEST;
      else process.env.VITEST = before2;
    }
  });

  it('runDue before the digest hour does nothing; after, sends, prunes notifications and rate limits', async () => {
    const { digests, notifications, rateLimit, scheduler } = build();
    // 13:00 UTC is 18:30 IST, before the 19:00 digest hour.
    await expect(scheduler.runDue(new Date('2026-10-20T13:00:00Z'))).resolves.toEqual({ due: false, sent: 0, pruned: 0 });
    expect(digests.sendDue).not.toHaveBeenCalled();
    expect(notifications.prune).not.toHaveBeenCalled();
    expect(rateLimit.prune).not.toHaveBeenCalled();
    await expect(scheduler.runDue(new Date('2026-10-20T14:00:00Z'))).resolves.toEqual({ due: true, sent: 3, pruned: 9 });
    expect(digests.sendDue).toHaveBeenCalledTimes(1);
    expect(notifications.prune).toHaveBeenCalledTimes(1);
    expect(rateLimit.prune).toHaveBeenCalledTimes(1);
  });
});
