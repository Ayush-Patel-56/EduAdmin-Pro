import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppController, READY_CACHE_MS } from './app.controller.js';
import { PrismaService } from './prisma/prisma.service.js';

describe('AppController', () => {
  let appController: AppController;
  const prisma = { $queryRaw: vi.fn() };

  beforeEach(async () => {
    prisma.$queryRaw.mockReset();
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: PrismaService, useValue: prisma }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('reports healthy without touching the database', () => {
    expect(appController.health()).toEqual({ status: 'ok' });
    expect(appController.live()).toEqual({ status: 'ok' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('echoes the address Express resolved, nothing else', () => {
    const res = appController.ip({ ip: '203.0.113.7', headers: { 'x-forwarded-for': '198.51.100.1' } } as never);
    expect(res).toEqual({ ip: '203.0.113.7' });
    expect(Object.keys(res)).toEqual(['ip']);
  });

  it('is ready when the database answers', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    await expect(appController.ready()).resolves.toEqual({ status: 'ok', database: 'up' });
  });

  it('is not ready when the database is down', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    await expect(appController.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('runs one database check for a burst of readiness calls', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    await Promise.all([appController.ready(), appController.ready(), appController.ready()]);
    await appController.ready();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('checks again once the cached result is stale', async () => {
    vi.useFakeTimers();
    try {
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      await appController.ready();
      vi.advanceTimersByTime(READY_CACHE_MS + 1);
      await appController.ready();
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
