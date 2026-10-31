import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { AuthService, loginKeys } from '../src/auth/auth.service.js';
import { EmailVerificationService } from '../src/auth/email-verification.service.js';
import type { MailService } from '../src/auth/mail.service.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { RateLimitService } from '../src/rate-limit/rate-limit.service.js';

/**
 * Accounts on a real database: someone who signs up first with another
 * person's email can't end up owning that account, codes can't be guessed in
 * parallel past the limit, and one account's password can't be guessed
 * from many addresses.
 */
describe('accounts and verification on the database (e2e)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const db = prisma as unknown as PrismaService;
  const codes = new Map<string, string>();
  const mail = { sendVerificationCode: async ({ to, code }: { to: string; code: string }) => void codes.set(to, code) } as unknown as MailService;
  const config = { get: (key: string) => ({ NODE_ENV: 'test', REQUIRE_EMAIL_VERIFICATION: 'true' })[key] } as unknown as ConfigService;
  const rateLimit = new RateLimitService(db);
  const verification = new EmailVerificationService(db, mail);
  const auth = new AuthService(db, verification, config, rateLimit);
  const tag = randomUUID().slice(0, 8);
  const email = (name: string) => `e2e-acct-${name}-${tag}@example.com`;
  const status = (e: unknown) => (e instanceof HttpException ? e.getStatus() : e);
  const names = ['victim', 'verified', 'parallel', 'locked', 'spread', 'flood'];
  const IPS = ['240.0.0.9', '240.0.1.1', '240.0.2.2'];
  const signup = (to: string, password: string, fullName = 'Real Teacher') => auth.signupTeacher({ email: to, password, fullName } as never);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${tag}@example.com` } } });
    // Only this run's sign-in counts.
    const keys = names.flatMap((n) => [undefined, ...IPS].flatMap((ip) => Object.values(loginKeys(email(n), ip))));
    await prisma.rateLimit.deleteMany({ where: { key: { in: keys } } });
    await prisma.$disconnect();
  });

  it("an unverified signup with someone's email doesn't block or capture their account", async () => {
    const victim = email('victim');
    await signup(victim, 'attacker-password-1', 'Attacker');
    // The real owner signs up later (after the code's resend cooldown): the
    // pending account is replaced, not "already exists".
    await prisma.emailVerificationToken.updateMany({ where: { user: { email: victim } }, data: { createdAt: new Date(Date.now() - 61_000) } });
    await signup(victim, 'owner-password-1', 'Real Owner');
    expect(await prisma.user.count({ where: { email: victim } })).toBe(1);
    // The code goes to the owner's inbox; with the attacker's password it doesn't verify.
    const code = codes.get(victim)!;
    expect(status(await verification.verify(victim, code, 'attacker-password-1').catch((e: unknown) => e))).toBe(400);
    await verification.verify(victim, code, 'owner-password-1');
    expect(status(await auth.login({ email: victim, password: 'attacker-password-1' }, {}).catch((e: unknown) => e))).toBe(401);
    await expect(auth.login({ email: victim, password: 'owner-password-1' }, {})).resolves.toEqual(expect.any(String));
    expect((await prisma.user.findUniqueOrThrow({ where: { email: victim } })).fullName).toBe('Real Owner');
  });

  it('a verified account is never replaced by a new signup', async () => {
    const owner = email('verified');
    await signup(owner, 'owner-password-2');
    await verification.verify(owner, codes.get(owner)!, 'owner-password-2');
    expect(status(await signup(owner, 'attacker-password-2').catch((e: unknown) => e))).toBe(409);
  });

  it('wrong codes sent in parallel use up at most 5 attempts, then even the right code is refused', async () => {
    const to = email('parallel');
    await signup(to, 'owner-password-3');
    const right = codes.get(to)!;
    const wrong = right === '000000' ? '111111' : '000000';
    await Promise.allSettled(Array.from({ length: 12 }, () => verification.verify(to, wrong, 'owner-password-3')));
    const token = await prisma.emailVerificationToken.findFirstOrThrow({ where: { user: { email: to } } });
    expect(token.attempts).toBe(5);
    await expect(verification.verify(to, right, 'owner-password-3')).rejects.toThrow('Too many wrong attempts');
  });

  it('10 failed sign-ins from one address lock the account there for 15 minutes, but not for its owner elsewhere', async () => {
    const to = email('locked');
    await signup(to, 'owner-password-4');
    await verification.verify(to, codes.get(to)!, 'owner-password-4');
    for (let i = 0; i < 10; i++) {
      expect(status(await auth.login({ email: to, password: `guess-${i}` }, { ip: '240.0.0.9' }).catch((e: unknown) => e))).toBe(401);
    }
    // That address waits, even with the right password, so guessing stops there...
    expect(status(await auth.login({ email: to, password: 'owner-password-4' }, { ip: '240.0.0.9' }).catch((e: unknown) => e))).toBe(429);
    // ...but someone who knows the account's email can't lock its owner out from everywhere.
    await expect(auth.login({ email: to, password: 'owner-password-4' }, { ip: '240.0.1.1' })).resolves.toEqual(expect.any(String));
  }, 30_000); // a dozen argon2 checks, which are slow on purpose

  it('failures spread over many addresses still lock the account at 100 in 15 minutes', async () => {
    const to = email('spread');
    await signup(to, 'owner-password-5');
    await verification.verify(to, codes.get(to)!, 'owner-password-5');
    // Stand in for 100 earlier failures from many addresses (100 argon2 checks would be slow here).
    await prisma.rateLimit.create({ data: { key: loginKeys(to).account, hits: 100, resetAt: new Date(Date.now() + 15 * 60_000) } });
    expect(status(await auth.login({ email: to, password: 'owner-password-5' }, { ip: '240.0.2.2' }).catch((e: unknown) => e))).toBe(429);
  });

  it("signing up again on a pending email waits out the code's resend cooldown, so it can't flood an inbox", async () => {
    const to = email('flood');
    await signup(to, 'pw-flood-1');
    expect(status(await signup(to, 'pw-flood-2').catch((e: unknown) => e))).toBe(429);
  });
});
