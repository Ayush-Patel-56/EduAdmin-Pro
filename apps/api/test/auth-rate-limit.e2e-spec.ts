import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

/**
 * The durable limit on the real login route: ten attempts a minute from one
 * address, counted in Postgres, so the eleventh is refused even when the
 * attempts are split across two API instances (each of which sees only five or
 * six). Fails if `STRICT` in auth.controller.ts loses its durable limit.
 */
describe('POST /api/auth/login rate limit (e2e)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  // A made-up client address in the reserved 240.0.0.0/4 range, unique to this
  // run, so no other run or real client shares the count.
  const ip = `240.${randomInt(256)}.${randomInt(256)}.${randomInt(256)}`;
  // The throttler's key for this route and address (a hash, so it can't be matched by prefix).
  const rowKey = createHash('sha256').update(`AuthController-login-durable-${ip}`).digest('hex');
  const apps: INestApplication[] = [];

  // One API instance: its own in-memory counts, the shared database.
  const instance = async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>();
    // As in main.ts behind the platform's proxy: req.ip comes from X-Forwarded-For.
    app.set('trust proxy', 1);
    app.setGlobalPrefix('api');
    await app.init();
    apps.push(app);
    return app;
  };

  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
    await prisma.rateLimit.deleteMany({ where: { key: rowKey } });
    await prisma.$disconnect();
  });

  it('refuses the 11th attempt in a minute across two instances', async () => {
    const [a, b] = [await instance(), await instance()];
    const attempt = (app: INestApplication) =>
      request(app.getHttpServer())
        .post('/api/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: `nobody-${randomUUID()}@example.invalid`, password: 'not-the-password' });

    // Alternating, each instance sees at most six, under its own limit of ten.
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push((await attempt(i % 2 === 0 ? a : b)).status);
    expect(statuses).toEqual(Array(10).fill(401));

    const eleventh = await attempt(a);
    expect(eleventh.status).toBe(429);
    // The other instance refuses too: the count is the database's, not its own.
    expect((await attempt(b)).status).toBe(429);

    const row = await prisma.rateLimit.findUnique({ where: { key: rowKey } });
    expect(row?.hits).toBe(12);
  });
});
