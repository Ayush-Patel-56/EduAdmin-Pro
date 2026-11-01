import type { PrismaService } from '../prisma/prisma.service.js';
import { RetentionService } from './retention.service.js';

describe('RetentionService', () => {
  it('deletes ended sessions, verification and password-reset codes a day past expiry, and digest records over 30 days old', async () => {
    const prisma = {
      session: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
      emailVerificationToken: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      passwordResetToken: { deleteMany: vi.fn().mockResolvedValue({ count: 4 }) },
      emailDigest: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const now = new Date('2026-10-31T12:00:00Z');
    await expect(new RetentionService(prisma as unknown as PrismaService).prune(now)).resolves.toBe(10);
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lt: now } } });
    expect(prisma.emailVerificationToken.deleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lt: new Date('2026-10-30T12:00:00Z') } } });
    expect(prisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lt: new Date('2026-10-30T12:00:00Z') } } });
    expect(prisma.emailDigest.deleteMany).toHaveBeenCalledWith({ where: { day: { lt: new Date('2026-10-01T12:00:00Z') } } });
  });
});
