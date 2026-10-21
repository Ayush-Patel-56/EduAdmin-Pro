import { randomUUID } from 'node:crypto';
import { Controller, Get, Global, Injectable, Module, Post, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { DURABLE, HybridThrottlerStorage, durableThrottle } from '../src/rate-limit/hybrid-throttler.storage.js';
import { RateLimitModule } from '../src/rate-limit/rate-limit.module.js';
import { RateLimitService } from '../src/rate-limit/rate-limit.service.js';
import { throttlerOptions } from '../src/rate-limit/throttler.options.js';

/**
 * The durable rate limits on a real database: the count is one atomic
 * statement, so API instances (and concurrent requests) share it, and a window
 * that has passed starts again at 1.
 */
describe('durable rate limits (e2e)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const rl = new RateLimitService(prisma as unknown as PrismaService);
  const run = randomUUID();
  const key = (name: string) => `test:${run}:${name}`;

  afterAll(async () => {
    await prisma.rateLimit.deleteMany({ where: { key: { contains: run } } });
    await prisma.$disconnect();
  });

  it('counts within a window, refuses past the limit, and starts again at 1 after it', async () => {
    const k = key('window');
    const t0 = new Date('2099-01-01T00:00:00Z');
    expect((await rl.hit(k, 60_000, 2, t0)).hits).toBe(1);
    expect(await rl.hit(k, 60_000, 2, new Date(t0.getTime() + 1_000))).toMatchObject({ hits: 2, allowed: true });
    const refused = await rl.hit(k, 60_000, 2, new Date(t0.getTime() + 2_000));
    expect(refused).toMatchObject({ hits: 3, allowed: false });
    // The window is fixed at the first hit: later hits don't push the end out.
    expect(refused.resetAt).toEqual(new Date(t0.getTime() + 60_000));
    expect(await rl.hit(k, 60_000, 2, new Date(t0.getTime() + 61_000))).toMatchObject({ hits: 1, allowed: true });
  });

  it('two storages on one database share a key, and keys never mix', async () => {
    const a = new HybridThrottlerStorage(rl);
    const b = new HybridThrottlerStorage(rl);
    const k = key(`login:${randomUUID()}`);
    await a.increment(k, 60_000, 10, 60_000, DURABLE);
    const r = await b.increment(k, 60_000, 10, 60_000, DURABLE);
    expect(r.totalHits).toBe(2);
    expect((await b.increment(key(`login:${randomUUID()}`), 60_000, 10, 60_000, DURABLE)).totalHits).toBe(1);
  });

  it('20 concurrent hits on one key count to exactly 20', async () => {
    const k = key('concurrent');
    const results = await Promise.all(Array.from({ length: 20 }, () => rl.hit(k, 60_000, 100)));
    const hits = results.map((r) => r.hits).sort((x, y) => x - y);
    expect(hits).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(Math.max(...hits)).toBe(20);
  });

  it('prune deletes only expired rows', async () => {
    // Long ago, so no other row in the table (a real window ends after 2026) is expired at this time.
    const t0 = new Date('2000-01-01T00:00:00Z');
    const expired = key('prune-expired');
    const live = key('prune-live');
    await rl.hit(expired, 1_000, 5, t0);
    await rl.hit(live, 3_600_000, 5, t0);
    // Only this test's own rows are asserted on: another e2e file may share the table.
    expect(await rl.prune(new Date(t0.getTime() + 2_000))).toBeGreaterThanOrEqual(1);
    const rows = await prisma.rateLimit.findMany({ where: { key: { in: [expired, live] } }, select: { key: true } });
    expect(rows.map((r) => r.key)).toEqual([live]);
  });

  describe('wired into the throttler guard', () => {
    // A route with a durable limit of 2 a minute, and one with none.
    @Controller(`rl-${run}`)
    class Routes {
      @Post('limited')
      @Throttle(durableThrottle(2, 60_000))
      limited() {
        return { ok: true };
      }

      @Get('open')
      open() {
        return { ok: true };
      }
    }
    // The stock guard keys a limit by a hash of the class, handler and caller's
    // IP. This one keys it in the clear under this run's prefix, so the test can
    // find (and clean up) exactly its own rows in a table other tests share.
    @Injectable()
    class RunGuard extends ThrottlerGuard {
      protected override generateKey(context: ExecutionContext, suffix: string, name: string) {
        return key(`wired:${context.getHandler().name}:${name}:${suffix}`);
      }
    }
    // The app's PrismaModule is global; this one hands the test's client to RateLimitService.
    @Global()
    @Module({ providers: [{ provide: PrismaService, useValue: prisma }], exports: [PrismaService] })
    class TestPrismaModule {}
    const apps: INestApplication[] = [];
    // One API instance: its own guard and in-memory counts, the shared database.
    const instance = async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [TestPrismaModule, ThrottlerModule.forRootAsync({ imports: [RateLimitModule], inject: [RateLimitService], useFactory: throttlerOptions })],
        controllers: [Routes],
        providers: [{ provide: APP_GUARD, useClass: RunGuard }],
      }).compile();
      const app = moduleRef.createNestApplication();
      await app.init();
      apps.push(app);
      return app;
    };
    // This run's guard rows; the outer afterAll deletes every key with the run in it.
    const wiredRows = async () =>
      (await prisma.rateLimit.findMany({ where: { key: { startsWith: key('wired:') } }, select: { key: true, hits: true } })).map((r) => [r.key.slice(key('wired:').length), r.hits]);

    afterAll(async () => {
      await Promise.all(apps.map((a) => a.close()));
    });

    it('a durable limit holds across two instances, and a route without one is not counted', async () => {
      const [a, b] = [await instance(), await instance()];
      await request(a.getHttpServer()).post(`/rl-${run}/limited`).expect(201);
      await request(b.getHttpServer()).post(`/rl-${run}/limited`).expect(201);
      // A third request is refused on either instance, though each has seen only one or two.
      await request(a.getHttpServer()).post(`/rl-${run}/limited`).expect(429);
      await request(b.getHttpServer()).post(`/rl-${run}/limited`).expect(429);
      for (let i = 0; i < 3; i++) await request(a.getHttpServer()).get(`/rl-${run}/open`).expect(200);
      // One durable row, for the limited route, counted by both instances; none for the open one.
      const rows = await wiredRows();
      expect(rows).toEqual([[expect.stringMatching(/^limited:durable:/), 4]]);
    });
  });
});
