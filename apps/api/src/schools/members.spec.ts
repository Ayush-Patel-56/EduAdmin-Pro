import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AccessService } from '../academic/access.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { MembersService } from './members.service.js';

const OWNER = 'u-owner';
const membership = (over: Record<string, unknown> = {}) => ({
  userId: 'u-teacher',
  schoolId: 'school-1',
  role: 'TEACHER',
  status: 'ACTIVE',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  user: { fullName: 'Vikram Rao', email: 'vikram@school.example' },
  school: { createdById: OWNER },
  ...over,
});

function build({ callerIsOwner = false } = {}) {
  const prisma = {
    schoolMembership: {
      findMany: vi.fn().mockResolvedValue([membership(), membership({ userId: OWNER, role: 'ADMIN', user: { fullName: 'Owner', email: 'o@s.example' } })]),
      findUnique: vi.fn().mockResolvedValue(membership()),
      update: vi.fn().mockResolvedValue({}),
    },
    faculty: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  const assertAdmin = vi.fn().mockResolvedValue({ isOwner: callerIsOwner });
  const service = new MembersService(prisma as unknown as PrismaService, { assertAdmin } as unknown as AccessService);
  return { prisma, assertAdmin, service };
}

describe('MembersService', () => {
  it("lists the school's members for its admins: names, emails, roles, status, the owner and you", async () => {
    const { service, prisma, assertAdmin } = build();
    const out = await service.list('u-admin', 'school-1');
    expect(assertAdmin).toHaveBeenCalledWith('u-admin', 'school-1');
    expect(prisma.schoolMembership.findMany.mock.calls[0][0].where).toEqual({ schoolId: 'school-1', status: { in: ['ACTIVE', 'REVOKED'] } });
    expect(out).toEqual([
      { userId: 'u-teacher', fullName: 'Vikram Rao', email: 'vikram@school.example', role: 'TEACHER', status: 'ACTIVE', isOwner: false, isYou: false },
      { userId: OWNER, fullName: 'Owner', email: 'o@s.example', role: 'ADMIN', status: 'ACTIVE', isOwner: true, isYou: false },
    ]);
  });

  it("an admin removes a teacher: access is revoked (rejoining with the code is refused) and the teacher's profile goes inactive", async () => {
    const { service, prisma } = build();
    await service.revoke('u-admin', 'school-1', 'u-teacher');
    expect(prisma.schoolMembership.update).toHaveBeenCalledWith({
      where: { userId_schoolId: { userId: 'u-teacher', schoolId: 'school-1' } },
      data: { status: 'REVOKED' },
    });
    expect(prisma.faculty.updateMany).toHaveBeenCalledWith({ where: { schoolId: 'school-1', userId: 'u-teacher' }, data: { status: 'INACTIVE' } });
  });

  it('only the owner removes an admin; nobody removes the owner or themselves; strangers are 404', async () => {
    const admin = membership({ userId: 'u-admin2', role: 'ADMIN' });
    const notOwner = build();
    notOwner.prisma.schoolMembership.findUnique.mockResolvedValue(admin);
    await expect(notOwner.service.revoke('u-admin', 'school-1', 'u-admin2')).rejects.toBeInstanceOf(ForbiddenException);

    const owner = build({ callerIsOwner: true });
    owner.prisma.schoolMembership.findUnique.mockResolvedValue(admin);
    await owner.service.revoke(OWNER, 'school-1', 'u-admin2');
    expect(owner.prisma.schoolMembership.update).toHaveBeenCalled();

    owner.prisma.schoolMembership.findUnique.mockResolvedValue(membership({ userId: OWNER, role: 'ADMIN' }));
    await expect(owner.service.revoke('u-other-admin', 'school-1', OWNER)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(owner.service.revoke(OWNER, 'school-1', OWNER)).rejects.toBeInstanceOf(BadRequestException);

    const stranger = build();
    stranger.prisma.schoolMembership.findUnique.mockResolvedValue(null);
    await expect(stranger.service.revoke('u-admin', 'school-1', 'u-nobody')).rejects.toBeInstanceOf(NotFoundException);
    expect(stranger.prisma.schoolMembership.update).not.toHaveBeenCalled();
  });

  it('restoring lets them rejoin with a current invite code, without giving access back by itself', async () => {
    const { service, prisma } = build();
    prisma.schoolMembership.findUnique.mockResolvedValue(membership({ status: 'REVOKED' }));
    await service.restore('u-admin', 'school-1', 'u-teacher');
    expect(prisma.schoolMembership.update).toHaveBeenCalledWith({
      where: { userId_schoolId: { userId: 'u-teacher', schoolId: 'school-1' } },
      data: { status: 'LEFT' },
    });
    prisma.schoolMembership.findUnique.mockResolvedValue(membership({ status: 'ACTIVE' }));
    await expect(service.restore('u-admin', 'school-1', 'u-teacher')).rejects.toBeInstanceOf(BadRequestException);
  });
});
