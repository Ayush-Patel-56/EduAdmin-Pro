import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Role } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthContext } from '../auth/session.guard.js';
import { generateJoinCode } from '../auth/tokens.js';

const ADMIN_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Tx = Prisma.TransactionClient;

@Injectable()
export class SchoolsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Consumes the admin's redeemed platform invite and makes them the school's first admin. */
  async createSchool(auth: AuthContext, name: string) {
    const invite = await this.prisma.platformInvite.findFirst({
      where: { redeemedById: auth.userId, schoolId: null },
    });
    if (!invite) {
      throw new ForbiddenException('You need a platform invite to create a school');
    }

    return this.prisma.$transaction(async (tx) => {
      const school = await tx.school.create({ data: { name } });
      const claimed = await tx.platformInvite.updateMany({
        where: { id: invite.id, schoolId: null },
        data: { schoolId: school.id },
      });
      if (claimed.count === 0) {
        throw new ConflictException('This invite has already been used to create a school');
      }
      await tx.schoolMembership.create({
        data: { userId: auth.userId, schoolId: school.id, role: 'ADMIN', status: 'ACTIVE' },
      });
      // Every school starts with a teacher code so admins can onboard staff straight away.
      await issueJoinCode(tx, school.id, 'TEACHER');
      await tx.session.update({
        where: { id: auth.sessionId },
        data: { activeSchoolId: school.id },
      });
      return { id: school.id, name: school.name };
    });
  }

  async listJoinCodes(auth: AuthContext, schoolId: string) {
    await this.assertAdmin(auth.userId, schoolId);
    const now = new Date();
    const [school, codes] = await Promise.all([
      this.prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { id: true, name: true } }),
      this.prisma.schoolJoinCode.findMany({
        where: { schoolId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      school,
      codes: codes
        .filter((c) => c.maxUses === null || c.uses < c.maxUses)
        .map(({ id, code, role, uses, maxUses, expiresAt, createdAt }) => ({
          id, code, role, uses, maxUses, expiresAt, createdAt,
        })),
    };
  }

  async createJoinCode(auth: AuthContext, schoolId: string, role: Role) {
    await this.assertAdmin(auth.userId, schoolId);
    const code = await this.prisma.$transaction((tx) => issueJoinCode(tx, schoolId, role));
    return { id: code.id, code: code.code, role: code.role, expiresAt: code.expiresAt };
  }

  async revokeJoinCode(auth: AuthContext, schoolId: string, codeId: string) {
    await this.assertAdmin(auth.userId, schoolId);
    const result = await this.prisma.schoolJoinCode.updateMany({
      where: { id: codeId, schoolId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException('Join code not found');
  }

  private async assertAdmin(userId: string, schoolId: string) {
    const membership = await this.prisma.schoolMembership.findUnique({
      where: { userId_schoolId: { userId, schoolId } },
    });
    if (membership?.role !== 'ADMIN' || membership.status !== 'ACTIVE') {
      throw new ForbiddenException('Only admins of this school can manage join codes');
    }
  }
}

/**
 * Teacher codes are reusable, so issuing a new one revokes the old one (that's
 * how a leaked code is rotated). Admin codes are single-use and expire in 7 days.
 */
async function issueJoinCode(tx: Tx, schoolId: string, role: Role) {
  if (role === 'TEACHER') {
    await tx.schoolJoinCode.updateMany({
      where: { schoolId, role: 'TEACHER', revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  return tx.schoolJoinCode.create({
    data: {
      schoolId,
      role,
      code: await uniqueCode(tx),
      ...(role === 'ADMIN' && {
        maxUses: 1,
        expiresAt: new Date(Date.now() + ADMIN_CODE_TTL_MS),
      }),
    },
  });
}

// Collisions are astronomically rare, but a failed insert would abort the
// surrounding transaction, so check first rather than catching the error.
async function uniqueCode(tx: Tx) {
  for (;;) {
    const code = generateJoinCode();
    const [joinCode, invite] = await Promise.all([
      tx.schoolJoinCode.findUnique({ where: { code }, select: { id: true } }),
      tx.platformInvite.findUnique({ where: { code }, select: { id: true } }),
    ]);
    if (!joinCode && !invite) return code;
  }
}
