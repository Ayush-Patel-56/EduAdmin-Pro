import { HttpException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import type { EmailVerificationService } from './email-verification.service.js';
import { SessionGuard } from './session.guard.js';

const PASSWORD = 'correct-horse-1';
const passwordHash = await argon2.hash(PASSWORD);
const codeOf = (e: unknown) => (e instanceof HttpException ? (e.getResponse() as { code?: string }).code : undefined);

/** Every account, admin or teacher, verifies its email before it can sign in, whatever the environment. */
describe('email verification is required to sign in', () => {
  const allowed = { allowed: true, resetAt: new Date() };
  const rateLimit = { hit: vi.fn(async () => allowed), clear: vi.fn(async () => undefined) } as unknown as RateLimitService;
  const userFind = vi.fn();
  const sessionCreate = vi.fn(async () => ({}));
  const prisma = { user: { findUnique: userFind }, session: { create: sessionCreate } } as unknown as PrismaService;
  const auth = new AuthService(prisma, {} as EmailVerificationService, rateLimit);
  const user = (accountType: 'ADMIN' | 'TEACHER', emailVerified: boolean) => ({ id: 'u1', email: 'a@example.com', passwordHash, accountType, emailVerified, memberships: [] });

  beforeEach(() => {
    userFind.mockReset();
    sessionCreate.mockClear();
  });

  // Admins used to skip this outside production unless REQUIRE_EMAIL_VERIFICATION=true; no setting changes it now.
  it('an unverified admin is refused, and no session is made', async () => {
    userFind.mockResolvedValue(user('ADMIN', false));
    const err = await auth.login({ email: 'a@example.com', password: PASSWORD }, {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(403);
    expect(codeOf(err)).toBe('EMAIL_NOT_VERIFIED');
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it('an unverified teacher is refused too', async () => {
    userFind.mockResolvedValue(user('TEACHER', false));
    expect(codeOf(await auth.login({ email: 'a@example.com', password: PASSWORD }, {}).catch((e: unknown) => e))).toBe('EMAIL_NOT_VERIFIED');
  });

  it('a verified account signs in', async () => {
    userFind.mockResolvedValue(user('ADMIN', true));
    await expect(auth.login({ email: 'a@example.com', password: PASSWORD }, {})).resolves.toEqual(expect.any(String));
    expect(sessionCreate).toHaveBeenCalledOnce();
  });

  it('a wrong password says so before anything about verification', async () => {
    userFind.mockResolvedValue(user('ADMIN', false));
    const err = await auth.login({ email: 'a@example.com', password: 'wrong-password-1' }, {}).catch((e: unknown) => e);
    expect((err as HttpException).getStatus()).toBe(401);
    expect(codeOf(err)).toBeUndefined();
  });
});

describe('SessionGuard: a session counts only for a verified account', () => {
  const findUnique = vi.fn();
  const guard = new SessionGuard({ session: { findUnique } } as unknown as PrismaService);
  const ctx = { switchToHttp: () => ({ getRequest: () => ({ cookies: { eduadmin_sid: 'x' } }) }) } as unknown as ExecutionContext;
  const live = (emailVerified: boolean) => ({ id: 's', userId: 'u', activeSchoolId: null, expiresAt: new Date(Date.now() + 60_000), user: { emailVerified } });

  it('refuses a live session whose account is unverified, so the app sends them back to sign in and verify', async () => {
    findUnique.mockResolvedValueOnce(live(false));
    const err = await guard.canActivate(ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(codeOf(err)).toBe('EMAIL_NOT_VERIFIED');
  });

  it('accepts a live session of a verified account', async () => {
    findUnique.mockResolvedValueOnce(live(true));
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});

describe('signup answers with the email to verify, for admins as for teachers', () => {
  const signedUp = { email: 'new@example.com', emailSent: true };
  const auth = { signupAdmin: vi.fn(async () => signedUp), signupTeacher: vi.fn(async () => signedUp) } as unknown as AuthService;
  const controller = new AuthController(auth, {} as never, {} as never, {} as never);

  it('admin signup returns the email, so the form goes straight to the code step', async () => {
    await expect(controller.signupAdmin({} as never)).resolves.toMatchObject({ email: 'new@example.com', emailSent: true });
  });

  it('teacher signup does the same', async () => {
    await expect(controller.signupTeacher({} as never)).resolves.toMatchObject({ email: 'new@example.com', emailSent: true });
  });
});
