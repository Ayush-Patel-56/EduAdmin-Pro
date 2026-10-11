import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { SchoolsService } from './schools.service.js';

const TEACHER_CODE = 'TEAC-1111';
const ADMIN_CODE = 'ADMN-2222';
const school = { id: 'school-1', name: 'Test School', inviteCode: TEACHER_CODE, adminInviteCode: ADMIN_CODE };
const auth = { userId: 'user-1', sessionId: 'session-1', activeSchoolId: null };

describe('SchoolsService.joinSchool: the code decides the role', () => {
  const upsert = vi.fn();
  const prisma = {
    user: { findUniqueOrThrow: vi.fn() },
    school: { findFirst: vi.fn() },
    schoolMembership: { findUnique: vi.fn(), updateMany: vi.fn(), upsert },
    session: { update: vi.fn() },
    faculty: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  };
  let schools: SchoolsService;

  const accountIs = (accountType: 'ADMIN' | 'TEACHER') =>
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      id: 'user-1',
      accountType,
      email: 'u@example.com',
      fullName: 'U',
      department: null,
    });

  beforeEach(async () => {
    vi.clearAllMocks();
    prisma.school.findFirst.mockResolvedValue(school);
    prisma.schoolMembership.findUnique.mockResolvedValue(null);
    prisma.faculty.findUnique.mockResolvedValue(null);
    // Works for both the array and the callback form of $transaction.
    prisma.$transaction.mockImplementation(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : arg,
    );
    const moduleRef = await Test.createTestingModule({ providers: [SchoolsService] })
      .useMocker((token) => (token === PrismaService ? prisma : {}))
      .compile();
    schools = moduleRef.get(SchoolsService);
  });

  it('teacher code + teacher account joins as TEACHER', async () => {
    accountIs('TEACHER');
    await schools.joinSchool(auth, TEACHER_CODE);
    expect(upsert.mock.calls[0][0].create).toMatchObject({ role: 'TEACHER', status: 'ACTIVE' });
  });

  it('admin code + admin account joins as ADMIN', async () => {
    accountIs('ADMIN');
    await schools.joinSchool(auth, ADMIN_CODE);
    expect(upsert.mock.calls[0][0].create).toMatchObject({ role: 'ADMIN', status: 'ACTIVE' });
  });

  it('an admin account can NOT become admin with the teacher code', async () => {
    accountIs('ADMIN');
    await expect(schools.joinSchool(auth, TEACHER_CODE)).rejects.toBeInstanceOf(ForbiddenException);
    expect(upsert).not.toHaveBeenCalled();
    expect(prisma.session.update).not.toHaveBeenCalled();
  });

  it('a teacher account can NOT use the admin code', async () => {
    accountIs('TEACHER');
    await expect(schools.joinSchool(auth, ADMIN_CODE)).rejects.toBeInstanceOf(ForbiddenException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects an unknown code', async () => {
    accountIs('TEACHER');
    prisma.school.findFirst.mockResolvedValue(null);
    await expect(schools.joinSchool(auth, 'NOPE-0000')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('looks a code up in both columns', async () => {
    accountIs('TEACHER');
    await schools.joinSchool(auth, TEACHER_CODE);
    expect(prisma.school.findFirst.mock.calls[0][0].where).toEqual({
      OR: [{ inviteCode: TEACHER_CODE }, { adminInviteCode: TEACHER_CODE }],
    });
  });

  it('refuses an existing member regardless of code', async () => {
    accountIs('ADMIN');
    prisma.schoolMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    await expect(schools.joinSchool(auth, ADMIN_CODE)).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a revoked member even with the right code', async () => {
    accountIs('ADMIN');
    prisma.schoolMembership.findUnique.mockResolvedValue({ status: 'REVOKED' });
    await expect(schools.joinSchool(auth, ADMIN_CODE)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
