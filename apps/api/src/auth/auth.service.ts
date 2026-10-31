import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { createHash } from 'node:crypto';
import { linkFacultyProfile } from '../academic/faculty-link.js';
import { Prisma, type User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { avatarUrlOf } from './avatar.service.js';
import type {
  AdminSignupDto,
  LoginDto,
  TeacherSignupDto,
  UpdatePreferencesDto,
} from './auth.dto.js';
import { EmailVerificationService } from './email-verification.service.js';
import {
  generateToken,
  hashToken,
  normalizeCode,
  normalizeEmail,
} from './tokens.js';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Failed sign-ins one account takes before it waits, from any address. */
export const LOGIN_FAILURE_LIMIT = 10;
export const LOGIN_LOCK_MS = 15 * 60_000;
// The email is hashed so the rate-limit table holds no addresses.
const loginKey = (email: string) => `login-fail:${createHash('sha256').update(email).digest('hex')}`;

// Verified against when the email is unknown, so response time does not
// reveal whether an account exists.
const DUMMY_HASH = await argon2.hash('timing-equaliser-not-a-real-password');

export type ClientInfo = { userAgent?: string; ip?: string };

type Tx = Prisma.TransactionClient;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly verification: EmailVerificationService,
    private readonly config: ConfigService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /**
   * Teachers verify their email with a 6-digit code before they can log in.
   * A valid school code connects them to that school straight away.
   */
  async signupTeacher(dto: TeacherSignupDto) {
    const email = normalizeEmail(dto.email);
    await this.assertEmailFree(email);

    const schoolCode = dto.schoolCode ? normalizeCode(dto.schoolCode) : null;
    const school = schoolCode
      ? await this.prisma.school.findUnique({ where: { inviteCode: schoolCode }, select: { id: true } })
      : null;
    if (schoolCode && !school) throw new BadRequestException('Invalid school join code');
    const passwordHash = await argon2.hash(dto.password);
    const fullName = dto.fullName.trim();

    const code = await this.createUser(async (tx) => {
      await this.releasePendingEmail(tx, email);
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          fullName,
          accountType: 'TEACHER',
          department: dto.department?.trim() || null,
        },
      });
      if (school) {
        await tx.schoolMembership.create({
          data: { userId: user.id, schoolId: school.id, role: 'TEACHER', status: 'ACTIVE' },
        });
        await linkFacultyProfile(tx, school.id, user);
      }
      return this.verification.issue(tx, user.id);
    });

    // The account exists either way; if sending fails the user can press "Resend code".
    try {
      await this.verification.send(email, fullName, code);
      return { email, emailSent: true };
    } catch (err) {
      this.logger.error('Could not send a verification email (the user can press Resend code)', err as Error);
      return { email, emailSent: false };
    }
  }

  async signupAdmin(dto: AdminSignupDto) {
    const email = normalizeEmail(dto.email);
    await this.assertEmailFree(email);

    const now = new Date();
    const invite = await this.prisma.adminInviteCode.findFirst({
      where: {
        code: normalizeCode(dto.inviteCode),
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });
    if (!invite || (invite.maxUses !== null && invite.uses >= invite.maxUses)) {
      throw new BadRequestException('Invalid or expired admin invite code');
    }
    const passwordHash = await argon2.hash(dto.password);

    const fullName = dto.fullName.trim();
    const code = await this.createUser(async (tx) => {
      // Re-check the limit atomically so two signups can't share the last use.
      const claimed = await tx.adminInviteCode.updateMany({
        where:
          invite.maxUses === null
            ? { id: invite.id }
            : { id: invite.id, uses: { lt: invite.maxUses } },
        data: { uses: { increment: 1 } },
      });
      if (claimed.count === 0) {
        throw new BadRequestException('Invalid or expired admin invite code');
      }
      await this.releasePendingEmail(tx, email);
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          fullName,
          accountType: 'ADMIN',
          employeeId: dto.employeeId?.trim() || null,
          adminInviteCodeId: invite.id,
        },
      });
      return this.requiresVerification('ADMIN') ? this.verification.issue(tx, user.id) : null;
    });
    if (code) {
      // The account exists either way; if sending fails the user can press "Resend code".
      try {
        await this.verification.send(email, fullName, code);
      } catch (err) {
        this.logger.error('Could not send a verification email (the user can press Resend code)', err as Error);
      }
    }
    return { email, verificationRequired: code !== null };
  }

  async login(dto: LoginDto, client: ClientInfo) {
    const email = normalizeEmail(dto.email);
    // Per account, on top of the per-address limit: guessing one account's
    // password from many addresses stops after LOGIN_FAILURE_LIMIT misses.
    // Counted for unknown emails too, so the lock says nothing about whether one exists.
    const key = loginKey(email);
    const lock = await this.rateLimit.current(key);
    if (lock && lock.hits >= LOGIN_FAILURE_LIMIT) throw tooManyFailures(lock.resetAt);
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } } },
    });
    const valid = await argon2.verify(user?.passwordHash ?? DUMMY_HASH, dto.password);
    if (!user || !valid) {
      await this.rateLimit.hit(key, LOGIN_LOCK_MS, LOGIN_FAILURE_LIMIT);
      throw new UnauthorizedException('Incorrect email or password');
    }
    if (this.requiresVerification(user.accountType) && !user.emailVerified) {
      // `code` lets the web app send the user to the verification step.
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Please verify your email before signing in',
      });
    }

    const token = generateToken();
    await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        activeSchoolId: user.memberships[0]?.schoolId ?? null,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        userAgent: client.userAgent?.slice(0, 255),
        ip: client.ip,
      },
    });
    return token;
  }

  /**
   * Teachers always verify their email. Admins do too in production, or
   * wherever REQUIRE_EMAIL_VERIFICATION=true (env validation refuses `false`
   * in production).
   */
  requiresVerification(accountType: 'ADMIN' | 'TEACHER') {
    return (
      accountType === 'TEACHER' ||
      this.config.get('NODE_ENV') === 'production' ||
      this.config.get('REQUIRE_EMAIL_VERIFICATION') === 'true'
    );
  }

  async logout(sessionId: string) {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  /** Switch which school the session is working in; must be an active member. */
  async setActiveSchool(userId: string, sessionId: string, schoolId: string) {
    const membership = await this.prisma.schoolMembership.findUnique({
      where: { userId_schoolId: { userId, schoolId } },
    });
    if (membership?.status !== 'ACTIVE') {
      throw new ForbiddenException('You do not have access to this school');
    }
    await this.prisma.session.update({ where: { id: sessionId }, data: { activeSchoolId: schoolId } });
  }

  async profile(userId: string, activeSchoolId: string | null) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        memberships: {
          include: { school: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
        avatar: { select: { updatedAt: true } },
      },
    });
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      accountType: user.accountType,
      emailVerified: user.emailVerified,
      avatarUrl: avatarUrlOf(user),
      preferences: toPreferences(user),
      activeSchoolId,
      memberships: user.memberships.map((m) => ({
        schoolId: m.school.id,
        schoolName: m.school.name,
        role: m.role,
        status: m.status,
      })),
    };
  }

  async updatePreferences(userId: string, dto: UpdatePreferencesDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        emailNotifications: dto.emailNotifications,
        syllabusUpdates: dto.syllabusUpdates,
        accentTheme: dto.accentTheme,
      },
    });
    return toPreferences(user);
  }

  /** An email is free if no account has it, or only one that was never verified (see releasePendingEmail). */
  private async assertEmailFree(email: string) {
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { emailVerified: true, accountType: true } });
    if (existing && !this.isPending(existing)) throw emailTaken();
  }

  /**
   * A signup on an email whose account was never verified replaces that
   * account: it can't have been used (it can't sign in), and it may have been
   * made by someone else with this email. Only the inbox's owner gets the new
   * code, and verifying also needs the new password.
   */
  private async releasePendingEmail(tx: Tx, email: string) {
    const existing = await tx.user.findUnique({ where: { email }, select: { id: true, emailVerified: true, accountType: true } });
    if (!existing) return;
    if (!this.isPending(existing)) throw emailTaken();
    await tx.user.delete({ where: { id: existing.id } });
  }

  private isPending(user: { emailVerified: boolean; accountType: 'ADMIN' | 'TEACHER' }) {
    return !user.emailVerified && this.requiresVerification(user.accountType);
  }

  private async createUser<T>(steps: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(steps);
    } catch (err) {
      // Two signups racing on the same email: the unique index decides.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw emailTaken();
      }
      throw err;
    }
  }
}

function tooManyFailures(resetAt: Date) {
  const minutes = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 60_000));
  return new HttpException(
    `Too many failed sign-ins for this account. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

function emailTaken() {
  return new ConflictException('An account with this email already exists');
}

function toPreferences(user: Pick<User, 'emailNotifications' | 'syllabusUpdates' | 'accentTheme'>) {
  return {
    emailNotifications: user.emailNotifications,
    syllabusUpdates: user.syllabusUpdates,
    accentTheme: user.accentTheme,
  };
}
