import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  AdminSignupDto,
  LoginDto,
  TeacherSignupDto,
} from './auth.dto.js';
import { MailService } from './mail.service.js';
import {
  generateToken,
  hashToken,
  normalizeCode,
  normalizeEmail,
} from './tokens.js';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

// Verified against when the email is unknown, so response time does not
// reveal whether an account exists.
const DUMMY_HASH = await argon2.hash('timing-equaliser-not-a-real-password');

export type ClientInfo = { userAgent?: string; ip?: string };

type Tx = Prisma.TransactionClient;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async signupTeacher(dto: TeacherSignupDto) {
    const email = normalizeEmail(dto.email);
    await this.assertEmailFree(email);

    const school = await this.prisma.school.findUnique({
      where: { inviteCode: normalizeCode(dto.schoolCode) },
      select: { id: true },
    });
    if (!school) throw new BadRequestException('Invalid school join code');
    const passwordHash = await argon2.hash(dto.password);

    const token = await this.createUser(email, async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          fullName: dto.fullName.trim(),
          accountType: 'TEACHER',
          department: dto.department?.trim() || null,
        },
      });
      // Teachers wait for an admin of the school to approve them.
      await tx.schoolMembership.create({
        data: { userId: user.id, schoolId: school.id, role: 'TEACHER', status: 'PENDING' },
      });
      return user.id;
    });

    await this.mail.sendVerificationEmail(email, token);
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

    const token = await this.createUser(email, async (tx) => {
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
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          fullName: dto.fullName.trim(),
          accountType: 'ADMIN',
          employeeId: dto.employeeId?.trim() || null,
          adminInviteCodeId: invite.id,
        },
      });
      return user.id;
    });

    await this.mail.sendVerificationEmail(email, token);
  }

  async login(dto: LoginDto, client: ClientInfo) {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(dto.email) },
      include: { memberships: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } } },
    });
    const valid = await argon2.verify(user?.passwordHash ?? DUMMY_HASH, dto.password);
    if (!user || !valid) {
      throw new UnauthorizedException('Incorrect email or password');
    }
    if (!user.emailVerified && this.config.get('REQUIRE_EMAIL_VERIFICATION') === 'true') {
      throw new ForbiddenException('Please verify your email before logging in');
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

  async verifyEmail(token: string) {
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!record || record.expiresAt < new Date()) {
      throw new BadRequestException('This link is invalid or has expired');
    }
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { emailVerified: true } }),
      this.prisma.emailVerificationToken.deleteMany({ where: { userId: record.userId } }),
    ]);
  }

  /** Always succeeds from the caller's view, so it cannot be used to probe for accounts. */
  async resendVerification(rawEmail: string) {
    const email = normalizeEmail(rawEmail);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.emailVerified) return;

    const token = await this.prisma.$transaction(async (tx) => {
      await tx.emailVerificationToken.deleteMany({ where: { userId: user.id } });
      return issueVerificationToken(tx, user.id);
    });
    await this.mail.sendVerificationEmail(email, token);
  }

  async profile(userId: string, activeSchoolId: string | null) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        memberships: {
          include: { school: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      accountType: user.accountType,
      emailVerified: user.emailVerified,
      activeSchoolId,
      memberships: user.memberships.map((m) => ({
        schoolId: m.school.id,
        schoolName: m.school.name,
        role: m.role,
        status: m.status,
      })),
    };
  }

  private async assertEmailFree(email: string) {
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw emailTaken();
  }

  /** Runs the user-creation steps and issues a verification token in one transaction. */
  private async createUser(email: string, steps: (tx: Tx) => Promise<string>) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const userId = await steps(tx);
        return issueVerificationToken(tx, userId);
      });
    } catch (err) {
      // Two signups racing on the same email: the unique index decides.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw emailTaken();
      }
      throw err;
    }
  }
}

function emailTaken() {
  return new ConflictException('An account with this email already exists');
}

async function issueVerificationToken(tx: Tx, userId: string) {
  const token = generateToken();
  await tx.emailVerificationToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
    },
  });
  return token;
}
