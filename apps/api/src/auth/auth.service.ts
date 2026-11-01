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
import { EmailVerificationService, RESEND_COOLDOWN_MS } from './email-verification.service.js';
import {
  generateToken,
  hashToken,
  normalizeCode,
  normalizeEmail,
} from './tokens.js';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Sign-in attempts per account in a 15-minute window: from one address
 * (guessing stops there), and from all addresses together (guessing spread
 * over many addresses stops too, at a level a stranger who only knows the
 * email can't easily reach to lock its owner out).
 */
export const LOGIN_ATTEMPTS_PER_ADDRESS = 10;
export const LOGIN_ATTEMPTS_PER_ACCOUNT = 100;
export const LOGIN_LOCK_MS = 15 * 60_000;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
/** Rate-limit keys for sign-ins; hashed, so the table holds no emails or IP addresses. */
export const loginKeys = (email: string, ip?: string) => ({
  account: `login-fail:${sha256(email)}`,
  address: `login-fail:${sha256(`${email}|${ip ?? 'unknown'}`)}`,
});

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
    // Signing up again over one's own pending account reuses the invite use it already took.
    const reusing = invite ? await this.pendingHoldsInvite(email, invite.id) : false;
    if (!invite || (!reusing && invite.maxUses !== null && invite.uses >= invite.maxUses)) {
      throw new BadRequestException('Invalid or expired admin invite code');
    }
    const passwordHash = await argon2.hash(dto.password);

    const fullName = dto.fullName.trim();
    const code = await this.createUser(async (tx) => {
      const released = await this.releasePendingEmail(tx, email);
      // Re-check the limit atomically so two signups can't share the last use.
      const claimed = released?.adminInviteCodeId === invite.id ? { count: 1 } : await tx.adminInviteCode.updateMany({
        where:
          invite.maxUses === null
            ? { id: invite.id }
            : { id: invite.id, uses: { lt: invite.maxUses } },
        data: { uses: { increment: 1 } },
      });
      if (claimed.count === 0) {
        throw new BadRequestException('Invalid or expired admin invite code');
      }
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
    // Each attempt is counted before the password is checked, so a burst of
    // parallel guesses can't all pass a stale count. Counted for unknown
    // emails too, so a lock says nothing about whether an account exists.
    const keys = loginKeys(email, client.ip);
    const [byAddress, byAccount] = await Promise.all([
      this.rateLimit.hit(keys.address, LOGIN_LOCK_MS, LOGIN_ATTEMPTS_PER_ADDRESS),
      this.rateLimit.hit(keys.account, LOGIN_LOCK_MS, LOGIN_ATTEMPTS_PER_ACCOUNT),
    ]);
    if (!byAddress.allowed) throw tooManyFailures(byAddress.resetAt);
    if (!byAccount.allowed) throw tooManyFailures(byAccount.resetAt);
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } } },
    });
    const valid = await argon2.verify(user?.passwordHash ?? DUMMY_HASH, dto.password);
    if (!user || !valid) {
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

    // A successful sign-in clears this address's count (the account-wide one runs out its window).
    await this.rateLimit.clear(keys.address);
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
    const existing = await this.prisma.user.findUnique({ where: { email }, select: PENDING_SELECT });
    if (existing && !this.isPending(existing)) throw emailTaken();
  }

  private async pendingHoldsInvite(email: string, inviteId: string) {
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { ...PENDING_SELECT, adminInviteCodeId: true } });
    return !!existing && this.isPending(existing) && existing.adminInviteCodeId === inviteId;
  }

  /**
   * A signup on an email whose account was never verified replaces that
   * account: it can't have been used (it can't sign in), and it may have been
   * made by someone else with this email. Only the inbox's owner gets the new
   * code, and verifying also needs the new password.
   */
  private async releasePendingEmail(tx: Tx, email: string) {
    const existing = await tx.user.findUnique({
      where: { email },
      select: {
        ...PENDING_SELECT,
        id: true,
        adminInviteCodeId: true,
        verificationTokens: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!existing) return null;
    if (!this.isPending(existing)) throw emailTaken();
    // Each signup emails a new code: keep to the resend pace, so signing up
    // again and again can't flood someone's inbox (or use up the mail quota).
    const sentAt = existing.verificationTokens[0]?.createdAt.getTime();
    if (sentAt && Date.now() - sentAt < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - sentAt)) / 1000);
      throw new HttpException(`A code was just sent to this email. Please wait ${wait}s and try again.`, HttpStatus.TOO_MANY_REQUESTS);
    }
    // Only while still unverified: a verification that lands meanwhile wins.
    const { count } = await tx.user.deleteMany({ where: { id: existing.id, emailVerified: false } });
    if (count === 0) throw emailTaken();
    return existing;
  }

  /** Never verified, needs to be, and has made nothing (an admin who created a school is kept). */
  private isPending(user: { emailVerified: boolean; accountType: 'ADMIN' | 'TEACHER'; schoolsCreated: unknown[] }) {
    return !user.emailVerified && this.requiresVerification(user.accountType) && user.schoolsCreated.length === 0;
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

const PENDING_SELECT = { emailVerified: true, accountType: true, schoolsCreated: { select: { id: true }, take: 1 } } as const;

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
