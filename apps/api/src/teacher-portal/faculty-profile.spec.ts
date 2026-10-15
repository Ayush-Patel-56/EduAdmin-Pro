import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { realUniqueError } from '../common/prisma-errors.fixture.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { FilesService } from '../storage/files.service.js';
import type { FacultyDto } from './faculty-profile.dto.js';
import { cleanSubjects, FacultyProfileService } from './faculty-profile.service.js';

const dto = (over: Partial<FacultyDto> = {}) =>
  ({ name: 'Anita Rao', subject: 'Physics', specialization: 'JEE Main', status: 'ACTIVE', batchIds: [], ...over }) as FacultyDto;

function build() {
  const prisma = {
    faculty: { findFirst: vi.fn(), update: vi.fn() },
    batch: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
    facultyBatch: { findFirst: vi.fn(), deleteMany: vi.fn(), update: vi.fn(), upsert: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    facultyProgram: { upsert: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((run: (tx: typeof prisma) => unknown) => run(prisma));
  const files = { claim: vi.fn(), discardQuietly: vi.fn(), url: vi.fn() };
  return { prisma, files, service: new FacultyProfileService(prisma as unknown as PrismaService, files as unknown as FilesService) };
}

const current = (over = {}) => ({ id: 'f1', userId: null, email: null, subjects: ['Chemistry'], photoFileId: null, photo: null, batchAssignments: [], ...over });

describe('FacultyProfileService', () => {
  it("another school's profile is a 404 everywhere (looked up with the school)", async () => {
    const { service, prisma } = build();
    prisma.faculty.findFirst.mockResolvedValue(null);
    await expect(service.get('school-1', 'f-x')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update('school-1', 'u', 'f-x', dto())).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.setDesignation('school-1', 'f-x', 'COORDINATOR')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.updateOwn('school-1', 'u', 'f-x', {})).rejects.toBeInstanceOf(NotFoundException);
    for (const call of prisma.faculty.findFirst.mock.calls) {
      expect(call[0].where).toEqual({ id: 'f-x', schoolId: 'school-1' });
    }
    expect(prisma.faculty.update).not.toHaveBeenCalled();
  });

  it("a linked teacher's sign-in email can't be changed by an admin", async () => {
    const { service, prisma } = build();
    prisma.faculty.findFirst.mockResolvedValue(current({ userId: 'u1', email: 'anita@school.in' }));
    await expect(service.update('school-1', 'u', 'f1', dto({ email: 'other@school.in' }))).rejects.toThrow('signs in with their email');
  });

  it('batches from another school are refused', async () => {
    const { service, prisma } = build();
    prisma.faculty.findFirst.mockResolvedValue(current());
    prisma.batch.findMany.mockResolvedValue([]);
    await expect(service.update('school-1', 'u', 'f1', dto({ batchIds: ['b-other'] }))).rejects.toThrow('Select batches from this school');
    expect(prisma.batch.findMany.mock.calls[0][0].where).toEqual({ schoolId: 'school-1', id: { in: ['b-other'] } });
  });

  it('the edited subject becomes primary; other subjects stay', async () => {
    const { service, prisma } = build();
    prisma.faculty.findFirst.mockResolvedValue(current({ subjects: ['Chemistry', 'Physics'] }));
    await service.update('school-1', 'u', 'f1', dto({ subject: 'physics' }));
    expect(prisma.faculty.update.mock.calls[0][0].data).toMatchObject({ subjects: ['physics', 'Chemistry'], primarySubject: 'physics' });
  });

  it('the primary subject must be one of the subjects', async () => {
    const { service, prisma } = build();
    prisma.faculty.findFirst.mockResolvedValue({ id: 'f1' });
    await expect(service.setSubjects('school-1', 'f1', { subjects: ['Physics'], primarySubject: 'Biology' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.setSubjects('school-1', 'f1', { subjects: ['Physics', 'physics', 'Maths'], primarySubject: 'maths' })).resolves.toEqual({ subjects: ['Physics', 'Maths'], primarySubject: 'Maths' });
  });

  it("assigning another school's batch is refused", async () => {
    const { service, prisma } = build();
    prisma.faculty.findFirst.mockResolvedValue({ id: 'f1' });
    prisma.batch.findFirst.mockResolvedValue(null);
    await expect(service.assignBatch('school-1', 'f1', { batchId: 'b-x', role: 'PRIMARY' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.batch.findFirst.mock.calls[0][0].where).toEqual({ id: 'b-x', schoolId: 'school-1' });
  });

  it('a teacher editing their own profile changes contact details and photo only', async () => {
    const { service, prisma } = build();
    prisma.faculty.findFirst.mockResolvedValue({ photoFileId: null, photo: null });
    // Extra fields can't reach here (the DTO whitelist drops them); only these are written.
    await service.updateOwn('school-1', 'u', 'f1', { phone: '+91 98765 43210', city: 'Surat' });
    expect(Object.keys(prisma.faculty.update.mock.calls[0][0].data).sort()).toEqual(
      ['address', 'altPhone', 'city', 'phone', 'photoFileId', 'pincode', 'profileImageUrl', 'state'],
    );
    expect(prisma.faculty.update.mock.calls[0][0].data.phone).toBe('9876543210');
  });

  it("a new photo is claimed: this user's own READY upload that nothing else uses", async () => {
    const { service, prisma, files } = build();
    prisma.faculty.findFirst.mockResolvedValue({ photoFileId: 'old', photo: { id: 'old', key: 'k-old' } });
    await service.updateOwn('school-1', 'teacher-user', 'f1', { photoFileId: 'new' });
    expect(files.claim).toHaveBeenCalledWith('school-1', 'new', 'FACULTY_PHOTO', 'teacher-user', 'old');
    // Saved, so the old photo goes (quietly: a failure there isn't the request's failure).
    expect(files.discardQuietly).toHaveBeenCalledWith([{ id: 'old', key: 'k-old' }]);
    prisma.faculty.findFirst.mockResolvedValue(current({ photoFileId: 'p1' }));
    await service.update('school-1', 'admin-user', 'f1', dto({ photoFileId: 'p2' }));
    expect(files.claim).toHaveBeenLastCalledWith('school-1', 'p2', 'FACULTY_PHOTO', 'admin-user', 'p1');
  });

  it("a photo another profile took first, or a duplicate employee ID, is a 409 (the unique index decides)", async () => {
    const { service, prisma } = build();
    prisma.faculty.findFirst.mockResolvedValue({ photoFileId: null, photo: null });
    prisma.faculty.update.mockRejectedValueOnce(realUniqueError('Faculty_photoFileId_key', 'Faculty'));
    await expect(service.updateOwn('school-1', 'u', 'f1', { photoFileId: 'p' })).rejects.toEqual(
      new ConflictException('That photo is already used by another faculty member; upload it again'),
    );
    prisma.faculty.findFirst.mockResolvedValue(current());
    prisma.faculty.update.mockRejectedValueOnce(realUniqueError('Faculty_schoolId_employeeId_key', 'Faculty'));
    await expect(service.update('school-1', 'u', 'f1', dto({ employeeId: 'E7' }))).rejects.toEqual(
      new ConflictException('Employee ID E7 is already used by another faculty member'),
    );
  });

  it("the portal overview counts a batch as covered only by a teacher who isn't inactive", async () => {
    const facultyBatches = vi.fn().mockResolvedValue([{ batchId: 'b1' }]);
    const empty = { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) };
    const prisma = { faculty: empty, facultyBatch: { findMany: facultyBatches }, studyMaterial: empty, counselingSession: empty };
    const service = new FacultyProfileService(prisma as unknown as PrismaService, { url: vi.fn() } as unknown as FilesService);
    await expect(service.overview('school-1')).resolves.toMatchObject({ kpis: { activeBatchesCovered: 1 } });
    expect(facultyBatches.mock.calls[0][0].where).toEqual({ schoolId: 'school-1', faculty: { status: { not: 'INACTIVE' } } });
  });

  it('cleanSubjects drops duplicates in any case, keeping order', () => {
    expect(cleanSubjects(['Physics', 'physics', 'Maths', 'PHYSICS'])).toEqual(['Physics', 'Maths']);
  });
});
