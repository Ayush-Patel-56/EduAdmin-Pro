import { BadRequestException, UnauthorizedException, ValidationPipe, type ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import { UpdatePreferencesDto } from './auth.dto.js';
import { EmailVerificationService } from './email-verification.service.js';
import { SessionGuard } from './session.guard.js';

// The same pipe options main.ts uses, so the DTO is checked as it is in production.
const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
const parse = (body: unknown) => pipe.transform(body, { type: 'body', metatype: UpdatePreferencesDto });

describe('UpdatePreferencesDto', () => {
  it('accepts any subset of the three preferences', async () => {
    await expect(parse({ emailNotifications: false })).resolves.toMatchObject({ emailNotifications: false });
    await expect(parse({ accentTheme: 'EMERALD', syllabusUpdates: true })).resolves.toBeTruthy();
    await expect(parse({})).resolves.toBeTruthy();
  });

  it('allows resetting the accent with null', async () => {
    await expect(parse({ accentTheme: null })).resolves.toMatchObject({ accentTheme: null });
  });

  it('rejects unknown themes, wrong types and unknown fields', async () => {
    await expect(parse({ accentTheme: 'NEON' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(parse({ emailNotifications: 'yes' })).rejects.toBeInstanceOf(BadRequestException);
    // Mass-assignment guard: nothing outside the three preferences gets through.
    await expect(parse({ accountType: 'ADMIN' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(parse({ emailVerified: true })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AuthService.updatePreferences', () => {
  const update = vi.fn();
  let auth: AuthService;

  beforeEach(async () => {
    update.mockReset();
    update.mockResolvedValue({ emailNotifications: true, syllabusUpdates: false, accentTheme: 'BLUE' });
    const moduleRef = await Test.createTestingModule({ providers: [AuthService] })
      .useMocker((token) => {
        if (token === PrismaService) return { user: { update } };
        if (token === ConfigService || token === EmailVerificationService) return {};
      })
      .compile();
    auth = moduleRef.get(AuthService);
  });

  it('only ever writes the caller’s own row', async () => {
    await auth.updatePreferences('user-1', { syllabusUpdates: false });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].where).toEqual({ id: 'user-1' });
  });

  it('leaves preferences that were not sent untouched', async () => {
    await auth.updatePreferences('user-1', { accentTheme: 'BLUE' });
    const { data } = update.mock.calls[0][0];
    expect(data).toEqual({ emailNotifications: undefined, syllabusUpdates: undefined, accentTheme: 'BLUE' });
    expect(Object.keys(data).sort()).toEqual(['accentTheme', 'emailNotifications', 'syllabusUpdates']);
  });

  it('returns only the preference fields', async () => {
    await expect(auth.updatePreferences('user-1', {})).resolves.toEqual({
      emailNotifications: true,
      syllabusUpdates: false,
      accentTheme: 'BLUE',
    });
  });
});

describe('SessionGuard (protects PATCH /auth/preferences)', () => {
  const findUnique = vi.fn();
  const guard = new SessionGuard({ session: { findUnique } } as unknown as PrismaService);
  const contextWith = (cookies: Record<string, string>) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ cookies }) }) }) as unknown as ExecutionContext;

  beforeEach(() => findUnique.mockReset());

  it('rejects a request with no session cookie', async () => {
    await expect(guard.canActivate(contextWith({}))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects an unknown or expired session', async () => {
    findUnique.mockResolvedValueOnce(null);
    await expect(guard.canActivate(contextWith({ eduadmin_sid: 'x' }))).rejects.toBeInstanceOf(UnauthorizedException);
    findUnique.mockResolvedValueOnce({ id: 's', userId: 'u', activeSchoolId: null, expiresAt: new Date(Date.now() - 1000) });
    await expect(guard.canActivate(contextWith({ eduadmin_sid: 'x' }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a live session', async () => {
    findUnique.mockResolvedValue({ id: 's', userId: 'u', activeSchoolId: null, expiresAt: new Date(Date.now() + 60_000) });
    await expect(guard.canActivate(contextWith({ eduadmin_sid: 'x' }))).resolves.toBe(true);
  });
});
