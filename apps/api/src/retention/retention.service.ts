import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

const DAY_MS = 86_400_000;
/** A code past its expiry is kept a day, so "this code has expired" still answers. */
const EXPIRED_CODE_KEEP_MS = DAY_MS;
/** Digest records only stop a day being sent twice; a month is plenty. */
const DIGEST_KEEP_MS = 30 * DAY_MS;

/**
 * Deletes account data that has done its job: ended sessions (they hold the
 * device and IP address), spent verification codes and old digest records.
 * Run by the daily cron.
 */
@Injectable()
export class RetentionService {
  constructor(private readonly prisma: PrismaService) {}

  async prune(now = new Date()): Promise<number> {
    const [sessions, codes, digests] = await Promise.all([
      this.prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.emailVerificationToken.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - EXPIRED_CODE_KEEP_MS) } } }),
      this.prisma.emailDigest.deleteMany({ where: { day: { lt: new Date(now.getTime() - DIGEST_KEEP_MS) } } }),
    ]);
    return sessions.count + codes.count + digests.count;
  }
}
