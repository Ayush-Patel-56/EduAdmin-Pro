import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
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
  ) {}

  async signupTeacher(dto: TeacherSignupDto) {
    const email = normalizeEmail(dto.email);
    await this.assertEmailFree(email);
    const passwordHash = await argon2.hash(dto.password);

    const joinCode = await this.prisma.schoolJoinCode.findFirst({
      where: { code: normalizeCode(dto.schoolCode), role: 'TEACHER', ...activeCodeFilter() },
    });
    if (!joinCode || isExhausted(joinCode)) {
      throw new BadRequestException('Invalid or expired school join code');
    }

    const token = await this.createUser(email, async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          fullName: dto.fullName.trim(),
          department: dto.department?.trim() || null,
        },
      });
      await consumeJoinCode(tx, joinCode);
      // Teachers wait for an admin of the school to approve them.
      await tx.schoolMembership.create({
        data: { userId: user.id, schoolId: joinCode.schoolId, role: 'TEACHER', status: 'PENDING' },
      });
      return user.id;
    });

    await this.mail.sendVerificationEmail(email, token);
  }

  async signupAdmin(dto: AdminSignupDto) {
    const email = normalizeEmail(dto.email);
    await this.assertEmailFree(email);
    const passwordHash = await argon2.hash(dto.password);
    const code = normalizeCode(dto.inviteCode);
    const now = new Date();

    // An admin code is either a platform invite (onboard a new school) or a
    // school-issued admin code (join an existing school).
    const platformInvite = await this.prisma.platformInvite.findFirst({
      where: { code, redeemedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    });
    const joinCode = platformInvite
      ? null
      : await this.prisma.schoolJoinCode.findFirst({
          where: { code, role: 'ADMIN', ...activeCodeFilter() },
        });
    if (!platformInvite && (!joinCode || isExhausted(joinCode))) {
      throw new BadRequestException('Invalid or expired invite code');
    }

    const token = await this.createUser(email, async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          fullName: dto.fullName.trim(),
          employeeId: dto.employeeId?.trim() || null,
        },
      });

      if (platformInvite) {
        const claimed = await tx.platformInvite.updateMany({
          where: { id: platformInvite.id, redeemedAt: null },
          data: { redeemedById: user.id, redeemedAt: new Date() },
        });
        if (claimed.count === 0) {
          throw new BadRequestException('Invalid or expired invite code');
        }
      } else if (joinCode) {
        await consumeJoinCode(tx, joinCode);
        await tx.schoolMembership.create({
          data: { userId: user.id, schoolId: joinCode.schoolId, role: 'ADMIN', status: 'ACTIVE' },
        });
      }
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
    if (!user.emailVerified) {
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
        platformInvites: { where: { schoolId: null }, select: { id: true } },
      },
    });
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      activeSchoolId,
      // True when the admin redeemed a platform invite but hasn't created the school yet.
      canCreateSchool: user.platformInvites.length > 0,
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

function activeCodeFilter() {
  const now = new Date();
  return {
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  } satisfies Prisma.SchoolJoinCodeWhereInput;
}

function isExhausted(code: { maxUses: number | null; uses: number }) {
  return code.maxUses !== null && code.uses >= code.maxUses;
}

/** Increments usage, failing if a concurrent signup used the last slot. */
async function consumeJoinCode(tx: Tx, code: { id: string; maxUses: number | null }) {
  const result = await tx.schoolJoinCode.updateMany({
    where: code.maxUses === null ? { id: code.id } : { id: code.id, uses: { lt: code.maxUses } },
    data: { uses: { increment: 1 } },
  });
  if (result.count === 0) {
    throw new BadRequestException('Invalid or expired join code');
  }
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
