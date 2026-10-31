import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessService } from '../academic/access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Who belongs to a school, and taking someone out of it. Removing sets the
 * membership to REVOKED: every request re-checks membership, so access ends
 * at once, and joining again with the invite code is refused. A removed
 * teacher's profile goes inactive (their records stay).
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async list(userId: string, schoolId: string) {
    await this.access.assertAdmin(userId, schoolId);
    const members = await this.prisma.schoolMembership.findMany({
      where: { schoolId, status: { in: ['ACTIVE', 'REVOKED'] } },
      select: { userId: true, role: true, status: true, user: { select: { fullName: true, email: true } }, school: { select: { createdById: true } } },
      orderBy: [{ role: 'asc' }, { user: { fullName: 'asc' } }],
    });
    return members.map((m) => ({
      userId: m.userId,
      fullName: m.user.fullName,
      email: m.user.email,
      role: m.role,
      status: m.status,
      isOwner: m.school.createdById === m.userId,
      isYou: m.userId === userId,
    }));
  }

  /** Admins remove teachers; only the owner removes admins. Nobody removes the owner, or themselves. */
  async revoke(userId: string, schoolId: string, memberId: string) {
    const { isOwner } = await this.access.assertAdmin(userId, schoolId);
    const member = await this.member(schoolId, memberId);
    if (memberId === userId) throw new BadRequestException("You can't remove yourself");
    if (member.school.createdById === memberId) throw new ForbiddenException("The school's owner can't be removed");
    if (member.role === 'ADMIN' && !isOwner) throw new ForbiddenException('Only the school owner can remove an admin');
    await this.prisma.$transaction(async (tx) => {
      await tx.schoolMembership.update({ where: { userId_schoolId: { userId: memberId, schoolId } }, data: { status: 'REVOKED' } });
      await tx.faculty.updateMany({ where: { schoolId, userId: memberId }, data: { status: 'INACTIVE' } });
    });
    return { userId: memberId, status: 'REVOKED' as const };
  }

  /**
   * Undoes a removal: they may join again with a current invite code (which
   * the school may have changed since). Nothing is given back by itself.
   */
  async restore(userId: string, schoolId: string, memberId: string) {
    const { isOwner } = await this.access.assertAdmin(userId, schoolId);
    const member = await this.member(schoolId, memberId);
    if (member.status !== 'REVOKED') throw new BadRequestException("This person's access wasn't removed");
    if (member.role === 'ADMIN' && !isOwner) throw new ForbiddenException('Only the school owner can restore an admin');
    await this.prisma.schoolMembership.update({ where: { userId_schoolId: { userId: memberId, schoolId } }, data: { status: 'LEFT' } });
    return { userId: memberId, status: 'LEFT' as const };
  }

  private async member(schoolId: string, userId: string) {
    const member = await this.prisma.schoolMembership.findUnique({
      where: { userId_schoolId: { userId, schoolId } },
      select: { role: true, status: true, school: { select: { createdById: true } } },
    });
    if (!member) throw new NotFoundException('Member not found');
    return member;
  }
}
