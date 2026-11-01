import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { loginKeys } from './auth.service.js';
import { MailService } from './mail.service.js';
import { normalizeEmail } from './tokens.js';

const CODE_TTL_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60_000;
const INVALID = 'Invalid or expired code. Request a new one.';

/** Salted with the user id (and a purpose) so the same code never hashes alike twice. */
const hashCode = (userId: string, code: string) => createHash('sha256').update(`reset:${userId}:${code}`).digest('hex');
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const firstName = (fullName: string) => fullName.trim().split(/\s+/)[0];

/**
 * Forgotten passwords (a code emailed to the account), changing a password
 * (needs the current one) and signing out other devices. A reset or a change
 * ends the other sessions, so whoever had the old password is signed out, and
 * the account's owner is told by email.
 */
@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /**
   * Emails a reset code. Silent for an unknown email, and within a minute of
   * the last code, so the answer never says whether an account exists.
   */
  async requestReset(rawEmail: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(rawEmail) },
      select: { id: true, email: true, fullName: true, passwordResetTokens: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!user) return;
    const last = user.passwordResetTokens[0];
    if (last && Date.now() - last.createdAt.getTime() < RESEND_COOLDOWN_MS) return;
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
      this.prisma.passwordResetToken.create({
        data: { userId: user.id, codeHash: hashCode(user.id, code), expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000) },
      }),
    ]);
    try {
      await this.mail.sendPasswordResetCode({ to: user.email, name: firstName(user.fullName), code, ttlMinutes: CODE_TTL_MINUTES });
    } catch (err) {
      this.logger.error('Could not send a password reset email (the user can ask again in a minute)', err as Error);
    }
  }

  /**
   * Sets a new password with the emailed code. Each try uses up an attempt
   * before anything is compared, so parallel guesses can't get past the limit.
   * The code proves the inbox, so the email counts as verified, and any
   * sign-in lock on the account is lifted.
   */
  async confirmReset(rawEmail: string, code: string, password: string): Promise<void> {
    const email = normalizeEmail(rawEmail);
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, fullName: true, passwordResetTokens: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    const token = user?.passwordResetTokens[0];
    // One message for an unknown email, no code and an expired code.
    if (!user || !token || token.expiresAt < new Date()) throw new BadRequestException(INVALID);
    const [claimed] = await this.prisma.$queryRaw<{ attempts: number }[]>`
      UPDATE "PasswordResetToken" SET "attempts" = "attempts" + 1
      WHERE "id" = ${token.id} AND "attempts" < ${MAX_ATTEMPTS}
      RETURNING "attempts"`;
    if (!claimed) throw new BadRequestException('Too many wrong attempts. Request a new code.');
    if (!sameHash(token.codeHash, hashCode(user.id, code))) {
      const left = MAX_ATTEMPTS - claimed.attempts;
      throw new BadRequestException(
        left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Too many wrong attempts. Request a new code.',
      );
    }
    const passwordHash = await argon2.hash(password);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash, emailVerified: true } }),
      this.prisma.session.deleteMany({ where: { userId: user.id } }),
      this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
      this.prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } }),
    ]);
    await this.rateLimit.clear(loginKeys(email).account);
    await this.notifyChanged(user);
  }

  /** Needs the current password; keeps this session and ends the others. */
  async change(userId: string, sessionId: string, currentPassword: string, newPassword: string): Promise<{ signedOut: number }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, fullName: true, passwordHash: true } });
    if (!(await argon2.verify(user.passwordHash, currentPassword))) throw new BadRequestException('Your current password is incorrect');
    if (currentPassword === newPassword) throw new BadRequestException('Choose a password different from your current one');
    const passwordHash = await argon2.hash(newPassword);
    const [, signedOut] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.session.deleteMany({ where: { userId, id: { not: sessionId } } }),
      this.prisma.passwordResetToken.deleteMany({ where: { userId } }),
    ]);
    await this.notifyChanged(user);
    return { signedOut: signedOut.count };
  }

  /** How many other devices are signed in to this account. */
  async otherSessions(userId: string, sessionId: string): Promise<{ others: number }> {
    const others = await this.prisma.session.count({ where: { userId, id: { not: sessionId }, expiresAt: { gt: new Date() } } });
    return { others };
  }

  /** Signs out every other device; this one stays signed in. */
  async signOutOthers(userId: string, sessionId: string): Promise<{ signedOut: number }> {
    const { count } = await this.prisma.session.deleteMany({ where: { userId, id: { not: sessionId } } });
    return { signedOut: count };
  }

  private async notifyChanged(user: { email: string; fullName: string }) {
    try {
      await this.mail.sendPasswordChanged({ to: user.email, name: firstName(user.fullName) });
    } catch (err) {
      this.logger.error('Could not send a password-changed email', err as Error);
    }
  }
}
