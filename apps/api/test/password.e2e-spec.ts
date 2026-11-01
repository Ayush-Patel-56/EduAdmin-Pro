import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { AuthService, loginKeys } from '../src/auth/auth.service.js';
import { EmailVerificationService } from '../src/auth/email-verification.service.js';
import type { MailService } from '../src/auth/mail.service.js';
import { PasswordService } from '../src/auth/password.service.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { RateLimitService } from '../src/rate-limit/rate-limit.service.js';

/**
 * Forgotten and changed passwords on a real database: a reset needs the code
 * sent to the inbox and ends every session; a change needs the current
 * password and ends the other sessions; nothing here says whether an email
 * has an account.
 */
describe('passwords on the database (e2e)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const db = prisma as unknown as PrismaService;
  const resetCodes = new Map<string, string>();
  const changed: string[] = [];
  const mail = {
    sendVerificationCode: async () => undefined,
    sendPasswordResetCode: async ({ to, code }: { to: string; code: string }) => void resetCodes.set(to, code),
    sendPasswordChanged: async ({ to }: { to: string }) => void changed.push(to),
  } as unknown as MailService;
  const config = { get: (key: string) => ({ NODE_ENV: 'test', REQUIRE_EMAIL_VERIFICATION: 'true' })[key] } as unknown as ConfigService;
  const rateLimit = new RateLimitService(db);
  const auth = new AuthService(db, new EmailVerificationService(db, mail), config, rateLimit);
  const passwords = new PasswordService(db, mail, rateLimit);
  const tag = randomUUID().slice(0, 8);
  const email = (name: string) => `e2e-pw-${name}-${tag}@example.com`;
  const status = (e: unknown) => (e instanceof HttpException ? e.getStatus() : e);

  /** A verified teacher account with `sessions` signed-in sessions; returns its id and session ids. */
  async function account(name: string, password: string, sessions = 2) {
    const user = await prisma.user.create({
      data: { email: email(name), passwordHash: await argon2.hash(password), fullName: `Pw ${name}`, accountType: 'TEACHER', emailVerified: true },
    });
    const ids: string[] = [];
    for (let i = 0; i < sessions; i++) {
      const s = await prisma.session.create({ data: { userId: user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 86_400_000) } });
      ids.push(s.id);
    }
    return { userId: user.id, sessions: ids };
  }

  afterAll(async () => {
    const emails = ['reset', 'unknown', 'guess', 'change', 'others', 'locked'].map(email);
    await prisma.rateLimit.deleteMany({ where: { key: { in: emails.flatMap((e) => [loginKeys(e).account, loginKeys(e).address]) } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${tag}@example.com` } } });
    await prisma.$disconnect();
  });

  it('a reset needs the emailed code, sets the new password and signs the account out everywhere', async () => {
    const { userId } = await account('reset', 'old-password-1');
    await passwords.requestReset(email('reset'));
    const code = resetCodes.get(email('reset'))!;
    expect(code).toMatch(/^\d{6}$/);
    expect(status(await passwords.confirmReset(email('reset'), code === '000000' ? '111111' : '000000', 'new-password-1').catch((e: unknown) => e))).toBe(400);
    await passwords.confirmReset(email('reset'), code, 'new-password-1');
    expect(await prisma.session.count({ where: { userId } })).toBe(0);
    expect(status(await auth.login({ email: email('reset'), password: 'old-password-1' }, {}).catch((e: unknown) => e))).toBe(401);
    await expect(auth.login({ email: email('reset'), password: 'new-password-1' }, {})).resolves.toEqual(expect.any(String));
    expect(changed).toContain(email('reset'));
    // A code works once.
    expect(status(await passwords.confirmReset(email('reset'), code, 'another-password').catch((e: unknown) => e))).toBe(400);
  });

  it("asking for a reset says nothing about whether the email has an account, and doesn't resend within a minute", async () => {
    await expect(passwords.requestReset(email('unknown'))).resolves.toBeUndefined();
    expect(resetCodes.has(email('unknown'))).toBe(false);
    await account('guess', 'pw-guess-1', 0);
    await passwords.requestReset(email('guess'));
    const first = resetCodes.get(email('guess'));
    await expect(passwords.requestReset(email('guess'))).resolves.toBeUndefined();
    expect(resetCodes.get(email('guess'))).toBe(first);
    expect(await prisma.passwordResetToken.count({ where: { user: { email: email('guess') } } })).toBe(1);
  });

  it('wrong codes sent in parallel use up at most 5 tries, then even the right code is refused', async () => {
    const right = resetCodes.get(email('guess'))!;
    const wrong = right === '000000' ? '111111' : '000000';
    await Promise.allSettled(Array.from({ length: 12 }, () => passwords.confirmReset(email('guess'), wrong, 'new-password-x')));
    expect((await prisma.passwordResetToken.findFirstOrThrow({ where: { user: { email: email('guess') } } })).attempts).toBe(5);
    await expect(passwords.confirmReset(email('guess'), right, 'new-password-x')).rejects.toThrow('Too many wrong attempts');
  });

  it('a reset also lifts a sign-in lock on the account', async () => {
    await account('locked', 'pw-locked-1', 0);
    await prisma.rateLimit.create({ data: { key: loginKeys(email('locked')).account, hits: 100, resetAt: new Date(Date.now() + 15 * 60_000) } });
    await passwords.requestReset(email('locked'));
    await passwords.confirmReset(email('locked'), resetCodes.get(email('locked'))!, 'pw-locked-2');
    await expect(auth.login({ email: email('locked'), password: 'pw-locked-2' }, { ip: '240.0.3.3' })).resolves.toEqual(expect.any(String));
  });

  it('changing the password needs the current one and signs out the other sessions, not this one', async () => {
    const { userId, sessions } = await account('change', 'current-pw-1', 3);
    const [mine] = sessions;
    expect(status(await passwords.change(userId, mine, 'wrong-current', 'next-pw-1').catch((e: unknown) => e))).toBe(400);
    await passwords.change(userId, mine, 'current-pw-1', 'next-pw-1');
    expect((await prisma.session.findMany({ where: { userId } })).map((s) => s.id)).toEqual([mine]);
    await expect(auth.login({ email: email('change'), password: 'next-pw-1' }, {})).resolves.toEqual(expect.any(String));
    expect(changed).toContain(email('change'));
  });

  it('signing out other devices ends every session but this one', async () => {
    const { userId, sessions } = await account('others', 'pw-others-1', 4);
    await expect(passwords.otherSessions(userId, sessions[0])).resolves.toEqual({ others: 3 });
    await expect(passwords.signOutOthers(userId, sessions[0])).resolves.toEqual({ signedOut: 3 });
    expect((await prisma.session.findMany({ where: { userId } })).map((s) => s.id)).toEqual([sessions[0]]);
  });
});
