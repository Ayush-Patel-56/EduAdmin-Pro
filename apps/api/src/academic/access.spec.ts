import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AccessService } from './access.service.js';

describe('AccessService.assertAdmin / assertOwner', () => {
  const findUnique = vi.fn();
  const access = new AccessService({
    schoolMembership: { findUnique },
  } as unknown as PrismaService);
  const membership = (over: object) => ({
    role: 'ADMIN',
    status: 'ACTIVE',
    school: { createdById: 'owner' },
    ...over,
  });

  beforeEach(() => {
    findUnique.mockReset();
  });

  it('looks the membership up by the caller and the requested school', async () => {
    findUnique.mockResolvedValue(membership({}));
    await access.assertAdmin('user-1', 'school-1');
    expect(findUnique.mock.calls[0][0].where).toEqual({
      userId_schoolId: { userId: 'user-1', schoolId: 'school-1' },
    });
  });

  it('answers "not found" for a school the caller does not belong to (no leak that it exists)', async () => {
    findUnique.mockResolvedValue(null);
    await expect(
      access.assertAdmin('user-1', 'someone-elses-school'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a teacher, a pending, a revoked and a departed member', async () => {
    for (const over of [
      { role: 'TEACHER' },
      { status: 'PENDING' },
      { status: 'REVOKED' },
      { status: 'LEFT' },
    ]) {
      findUnique.mockResolvedValue(membership(over));
      await expect(
        access.assertAdmin('user-1', 'school-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('lets an active admin through and reports whether they own the school', async () => {
    findUnique.mockResolvedValue(
      membership({ school: { createdById: 'user-1' } }),
    );
    await expect(access.assertAdmin('user-1', 'school-1')).resolves.toEqual({
      isOwner: true,
    });
    findUnique.mockResolvedValue(membership({}));
    await expect(access.assertAdmin('user-1', 'school-1')).resolves.toEqual({
      isOwner: false,
    });
  });

  it('assertOwner refuses an admin who did not create the school', async () => {
    findUnique.mockResolvedValue(membership({}));
    await expect(
      access.assertOwner('user-1', 'school-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('assertOwner accepts the creator', async () => {
    findUnique.mockResolvedValue(
      membership({ school: { createdById: 'user-1' } }),
    );
    await expect(
      access.assertOwner('user-1', 'school-1'),
    ).resolves.toBeUndefined();
  });

  it('assertOwner still refuses a teacher or an unknown school', async () => {
    findUnique.mockResolvedValue(
      membership({ role: 'TEACHER', school: { createdById: 'user-1' } }),
    );
    await expect(
      access.assertOwner('user-1', 'school-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    findUnique.mockResolvedValue(null);
    await expect(
      access.assertOwner('user-1', 'school-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AccessService.teacherScope', () => {
  const findFirst = vi.fn();
  const facultyFindUnique = vi.fn();
  const access = new AccessService({
    schoolMembership: { findFirst },
    faculty: { findUnique: facultyFindUnique },
  } as unknown as PrismaService);
  const profile = (status: string) => ({
    id: 'fac-1',
    status,
    batchAssignments: [{ batchId: 'b1' }, { batchId: 'b2' }],
    programAssignments: [{ programId: 'p1' }],
  });

  beforeEach(() => {
    findFirst.mockReset();
    facultyFindUnique.mockReset();
    findFirst.mockResolvedValue({ schoolId: 'school-1' });
  });

  it('is refused for a user who is not an active teacher anywhere', async () => {
    findFirst.mockResolvedValue(null);
    await expect(access.teacherScope('user-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('takes the school from the teacher’s own membership and returns only their assignments', async () => {
    facultyFindUnique.mockResolvedValue(profile('ACTIVE'));
    await expect(access.teacherScope('user-1')).resolves.toEqual({
      schoolId: 'school-1',
      facultyId: 'fac-1',
      batchIds: ['b1', 'b2'],
      programIds: ['p1'],
    });
    expect(findFirst.mock.calls[0][0].where).toEqual({
      userId: 'user-1',
      role: 'TEACHER',
      status: 'ACTIVE',
    });
    expect(facultyFindUnique.mock.calls[0][0].where).toEqual({
      schoolId_userId: { schoolId: 'school-1', userId: 'user-1' },
    });
  });

  it('a teacher with no faculty profile or no assignments sees nothing, not everything', async () => {
    facultyFindUnique.mockResolvedValue(null);
    await expect(access.teacherScope('user-1')).resolves.toMatchObject({
      batchIds: [],
      programIds: [],
    });
    facultyFindUnique.mockResolvedValue({
      id: 'fac-1',
      status: 'ACTIVE',
      batchAssignments: [],
      programAssignments: [],
    });
    await expect(access.teacherScope('user-1')).resolves.toMatchObject({
      batchIds: [],
      programIds: [],
    });
  });

  it('an INACTIVE profile opens no batches; ON_LEAVE keeps theirs', async () => {
    facultyFindUnique.mockResolvedValue(profile('INACTIVE'));
    await expect(access.teacherScope('user-1')).resolves.toMatchObject({
      facultyId: 'fac-1',
      batchIds: [],
      programIds: [],
    });
    facultyFindUnique.mockResolvedValue(profile('ON_LEAVE'));
    await expect(access.teacherScope('user-1')).resolves.toMatchObject({
      batchIds: ['b1', 'b2'],
    });
  });
});
