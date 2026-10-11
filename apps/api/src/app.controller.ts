import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from './prisma/prisma.service.js';

const READY_TIMEOUT_MS = 3_000;

// Uptime monitors poll these, so they're exempt from rate limiting.
@Controller('health')
@SkipThrottle()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: the process is up. Never touches the database. */
  @Get()
  health() {
    return { status: 'ok' };
  }

  @Get('live')
  live() {
    return this.health();
  }

  /** Readiness: the API can serve requests, i.e. the database answers. */
  @Get('ready')
  async ready() {
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, READY_TIMEOUT_MS);
      return { status: 'ok', database: 'up' };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'down' });
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
