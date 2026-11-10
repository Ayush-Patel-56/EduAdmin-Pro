import type { PrismaService } from '../prisma/prisma.service.js';
import type { RateLimitService } from '../rate-limit/rate-limit.service.js';
import type { MailService } from './mail.service.js';
import { PasswordService } from './password.service.js';

describe('PasswordService.requestReset', () => {
  it("answers without waiting for the lookup, the code or the email, so how long it takes can't tell whether the email has an account", async () => {
    // A lookup that never finishes: the answer must not depend on it.
    const prisma = { user: { findUnique: vi.fn(() => new Promise(() => {})) } };
    const service = new PasswordService(prisma as unknown as PrismaService, {} as MailService, {} as RateLimitService);
    await expect(service.requestReset('someone@example.com')).resolves.toBeUndefined();
    expect(prisma.user.findUnique).toHaveBeenCalled();
  });
});
