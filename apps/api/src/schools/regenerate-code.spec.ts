import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { SchoolsService } from './schools.service.js';

const auth = { userId: 'user-1', sessionId: 's', activeSchoolId: null };

describe('SchoolsService.regenerateCode', () => {
  const update = vi.fn();
  const prisma = {
    schoolMembership: { findUnique: vi.fn() },
    school: { findFirst: vi.fn(), update },
    $transaction: vi.fn(),
  };
  let schools: SchoolsService;

  beforeEach(async () => {
    vi.clearAllMocks();
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    prisma.school.findFirst.mockResolvedValue(null); // no collision: any generated code is free
    update.mockResolvedValue({ inviteCode: 'NEW-TEACH', adminInviteCode: 'NEW-ADMIN' });
    prisma.schoolMembership.findUnique.mockResolvedValue({ role: 'ADMIN', status: 'ACTIVE' });
    const moduleRef = await Test.createTestingModule({ providers: [SchoolsService] })
      .useMocker((token) => (token === PrismaService ? prisma : {}))
      .compile();
    schools = moduleRef.get(SchoolsService);
  });

  it('replaces only the admin code when asked for ADMIN', async () => {
    await schools.regenerateCode(auth, 'school-1', 'ADMIN');
    const { where, data } = update.mock.calls[0][0];
    expect(where).toEqual({ id: 'school-1' });
    expect(Object.keys(data)).toEqual(['adminInviteCode']);
    expect(data.adminInviteCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('replaces only the teacher code when asked for TEACHER', async () => {
    await schools.regenerateCode(auth, 'school-1', 'TEACHER');
    expect(Object.keys(update.mock.calls[0][0].data)).toEqual(['inviteCode']);
  });

  it('checks the new code against both columns so it never duplicates one', async () => {
    await schools.regenerateCode(auth, 'school-1', 'ADMIN');
    expect(prisma.school.findFirst.mock.calls[0][0].where.OR).toHaveLength(2);
  });

  it('is limited to active admins of that school', async () => {
    prisma.schoolMembership.findUnique.mockResolvedValue({ role: 'TEACHER', status: 'ACTIVE' });
    await expect(schools.regenerateCode(auth, 'school-1', 'ADMIN')).rejects.toBeInstanceOf(ForbiddenException);
    prisma.schoolMembership.findUnique.mockResolvedValue({ role: 'ADMIN', status: 'REVOKED' });
    await expect(schools.regenerateCode(auth, 'school-1', 'ADMIN')).rejects.toBeInstanceOf(ForbiddenException);
    prisma.schoolMembership.findUnique.mockResolvedValue(null);
    await expect(schools.regenerateCode(auth, 'school-1', 'ADMIN')).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });
});
