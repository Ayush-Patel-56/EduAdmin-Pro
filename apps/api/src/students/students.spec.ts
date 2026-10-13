import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AccessService, TeacherScope } from '../academic/access.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { FilesService } from '../storage/files.service.js';
import {
  StudentsController,
  TeacherStudentsController,
} from './students.controller.js';
import type { StudentDto } from './students.dto.js';
import {
  StudentsService,
  maskAadhaar,
  moveEnrollment,
  studentClash,
} from './students.service.js';

const auth = { userId: 'user-1', sessionId: 's', activeSchoolId: null };
const handlers = (controller: object) =>
  Object.getOwnPropertyNames(Object.getPrototypeOf(controller)).filter(
    (n) =>
      n !== 'constructor' &&
      typeof (controller as Record<string, unknown>)[n] === 'function',
  );
const untouched = () =>
  new Proxy(
    {},
    {
      get: () =>
        vi.fn(() => {
          throw new Error('a service was called before the permission check');
        }),
    },
  );

describe('StudentsController: /schools/:schoolId/students/*', () => {
  const assertAdmin = vi.fn();
  const controller = new StudentsController(
    { assertAdmin } as unknown as AccessService,
    untouched() as never,
    untouched() as never,
  );
  const names = handlers(controller);
  const call = (name: string, schoolId: string) =>
    (controller as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[
      name
    ].call(controller, auth, schoolId, 'x', 'y', {});

  it('covers every route', () => {
    expect(names.length).toBeGreaterThanOrEqual(10);
  });

  it.each(names)('%s refuses a non-admin (e.g. a teacher) before touching data', async (name) => {
    assertAdmin.mockRejectedValue(new ForbiddenException('Only admins of this school can do this'));
    await expect(call(name, 'school-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(assertAdmin).toHaveBeenCalledWith('user-1', 'school-1');
  });

  it.each(names)('%s answers 404 for a school the caller is not in', async (name) => {
    assertAdmin.mockRejectedValue(new NotFoundException('School not found'));
    await expect(call(name, 'foreign')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('TeacherStudentsController: read-only, school from the session', () => {
  it('has no route that writes', () => {
    const controller = new TeacherStudentsController({} as never, {} as never);
    expect(handlers(controller).sort()).toEqual(['get', 'list']);
  });

  it('refuses someone who is not a teacher in a school', async () => {
    const teacherScope = vi.fn().mockRejectedValue(new ForbiddenException('Join a school'));
    const controller = new TeacherStudentsController(
      { teacherScope } as unknown as AccessService,
      untouched() as never,
    );
    await expect(controller.list(auth, {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.get(auth, 'x')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('StudentsService: what faculty can see', () => {
  const findFirst = vi.fn();
  const findMany = vi.fn().mockResolvedValue([]);
  const count = vi.fn().mockResolvedValue(0);
  const prisma = { student: { findFirst, findMany, count } } as unknown as PrismaService;
  const service = new StudentsService(prisma, { url: vi.fn() } as unknown as FilesService);
  const scope = (over: Partial<TeacherScope>): TeacherScope => ({
    schoolId: 'school-1',
    facultyId: 'fac-1',
    batchIds: ['b1'],
    programIds: ['p1'],
    active: true,
    ...over,
  });

  beforeEach(() => vi.clearAllMocks());

  it('an INACTIVE or missing profile sees no students', async () => {
    expect(service.teacherWhere(scope({ active: false }))).toBeNull();
    expect(service.teacherWhere(scope({ facultyId: null }))).toBeNull();
    await expect(service.teacherList(scope({ active: false }), {})).resolves.toMatchObject({ total: 0, items: [] });
    expect(findMany).not.toHaveBeenCalled();
    await expect(service.teacherGet(scope({ active: false }), 'st-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('no programs assigned: every student of their school (PRD access rule)', () => {
    expect(service.teacherWhere(scope({ programIds: [], batchIds: [] }))).toEqual({ schoolId: 'school-1' });
  });

  it('with programs: only students in their programs or batches, and only in their school', async () => {
    expect(service.teacherWhere(scope({}))).toEqual({
      schoolId: 'school-1',
      OR: [{ programId: { in: ['p1'] } }, { batchId: { in: ['b1'] } }],
    });
    await service.teacherList(scope({}), { q: 'Riya' });
    expect(findMany.mock.calls[0][0].where.AND[0]).toEqual(service.teacherWhere(scope({})));
  });

  it('a student outside their scope is a 404 (the lookup includes the scope)', async () => {
    findFirst.mockResolvedValue(null);
    await expect(service.teacherGet(scope({}), 'st-9')).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst.mock.calls[0][0].where).toEqual({
      AND: [service.teacherWhere(scope({})), { id: 'st-9' }],
    });
  });

  it('the teacher detail leaves out identity numbers, contacts, address and guardians', async () => {
    findFirst.mockResolvedValue({
      id: 'st-1', fullName: 'Riya', admissionNumber: 'ADM-1', aadharNumber: '234567890123', rollNumber: '7',
      email: 'r@x.com', phone: '9876543210', parentContact: '9876543211', address: 'A', city: 'C', state: 'S', pincode: '380001',
      dateOfBirth: null, gender: 'Female', bloodGroup: 'O+', profileImageUrl: null, photoFileId: null, photo: null,
      previousSchool: 'DPS', previousPercentage: null, classLevel: '9th', program: null, batch: null,
      admissionDate: null, status: 'ACTIVE', notes: 'private', createdAt: new Date(),
      guardians: [{ id: 'g', name: 'Mom', isPrimary: true }], enrollments: [],
    });
    const detail = await service.teacherGet(scope({}), 'st-1');
    for (const hidden of ['admissionNumber', 'aadharNumber', 'email', 'phone', 'parentContact', 'address', 'guardians', 'notes', 'dateOfBirth']) {
      expect(detail).not.toHaveProperty(hidden);
    }
    expect(detail).toMatchObject({ fullName: 'Riya', gender: 'Female', previousSchool: 'DPS' });
  });

  it('the teacher roster has no contact columns', async () => {
    count.mockResolvedValue(1);
    findMany.mockResolvedValue([
      { id: 'st-1', fullName: 'Riya', rollNumber: '7', classLevel: '9th', program: null, batch: null,
        phone: '9876543210', parentContact: '9876543211', email: 'r@x.com', status: 'ACTIVE', profileImageUrl: null, photo: null },
    ]);
    const { items } = await service.teacherList(scope({}), {});
    expect(items[0]).not.toHaveProperty('phone');
    expect(items[0]).not.toHaveProperty('parentContact');
    expect(items[0]).not.toHaveProperty('email');
  });
});

describe('StudentsService: records stay inside the school', () => {
  const dto = (over: Partial<StudentDto> = {}): StudentDto => ({ fullName: 'Riya Shah', status: 'ACTIVE', ...over }) as StudentDto;
  const batchFindFirst = vi.fn();
  const programFindFirst = vi.fn();
  const studentFindFirst = vi.fn();
  const findReady = vi.fn();
  const transaction = vi.fn();
  const prisma = {
    school: { findUniqueOrThrow: vi.fn().mockResolvedValue({ classes: ['9th', '10th'] }) },
    batch: { findFirst: batchFindFirst },
    program: { findFirst: programFindFirst },
    student: { findFirst: studentFindFirst, delete: vi.fn() },
    $transaction: transaction,
  } as unknown as PrismaService;
  const service = new StudentsService(prisma, { findReady } as unknown as FilesService);

  beforeEach(() => {
    vi.clearAllMocks();
    transaction.mockResolvedValue('new-id');
  });

  it('a class the school does not offer is refused', async () => {
    await expect(service.create('school-1', 'u', dto({ classLevel: '12th' }))).rejects.toThrow("doesn't offer class 12th");
  });

  it("another school's batch or program is refused (looked up with this school)", async () => {
    batchFindFirst.mockResolvedValue(null);
    await expect(service.create('school-1', 'u', dto({ batchId: 'b-other' }))).rejects.toBeInstanceOf(BadRequestException);
    expect(batchFindFirst.mock.calls[0][0].where).toEqual({ id: 'b-other', schoolId: 'school-1' });
    programFindFirst.mockResolvedValue(null);
    await expect(service.create('school-1', 'u', dto({ programId: 'p-other' }))).rejects.toBeInstanceOf(BadRequestException);
    expect(programFindFirst.mock.calls[0][0].where).toEqual({ id: 'p-other', schoolId: 'school-1' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('a batch decides the program; naming a different program is refused', async () => {
    batchFindFirst.mockResolvedValue({ programId: 'p-jee', program: { name: 'JEE' } });
    await expect(service.create('school-1', 'u', dto({ batchId: 'b1', programId: 'p-neet' }))).rejects.toThrow('That batch belongs to JEE');
    await expect(service.create('school-1', 'u', dto({ batchId: 'b1' }))).resolves.toEqual({ id: 'new-id' });
  });

  it('an uploaded photo must be a READY photo of this school', async () => {
    findReady.mockRejectedValue(new BadRequestException('Upload the file again'));
    await expect(service.create('school-1', 'u', dto({ photoFileId: 'f1' }))).rejects.toBeInstanceOf(BadRequestException);
    expect(findReady).toHaveBeenCalledWith('school-1', 'f1', 'STUDENT_PHOTO');
  });

  it('a future date of birth is refused', async () => {
    await expect(service.create('school-1', 'u', dto({ dateOfBirth: '2999-01-01' }))).rejects.toThrow('future');
  });

  it("another school's student is a 404 for edit and delete", async () => {
    studentFindFirst.mockResolvedValue(null);
    await expect(service.update('school-1', 'st-x', dto())).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove('school-1', 'st-x')).rejects.toBeInstanceOf(NotFoundException);
    expect(studentFindFirst.mock.calls[0][0].where).toEqual({ id: 'st-x', schoolId: 'school-1' });
  });
});

describe('student helpers', () => {
  it('maskAadhaar keeps only the last four digits', () => {
    expect(maskAadhaar('234567890123')).toBe('XXXX-XXXX-0123');
    expect(maskAadhaar(null)).toBeNull();
  });

  it('unique-index clashes get a message naming the field', () => {
    const message = studentClash({ admissionNumber: 'ADM-1', rollNumber: '7' });
    expect(message(['Student_schoolId_admissionNumber_key'])).toMatch(/Admission number ADM-1/);
    expect(message(['schoolId', 'aadharNumber'])).toMatch(/Aadhaar/);
    expect(message(['Student_batchId_rollNumber_key'])).toMatch(/Roll number 7/);
  });

  it('moving batch closes the open enrollment and opens a new one; a new roll updates it', async () => {
    const tx = { studentEnrollment: { updateMany: vi.fn(), create: vi.fn() } };
    await moveEnrollment(tx as never, 's', 'st', { batchId: 'b1', rollNumber: '1' }, { batchId: 'b2', rollNumber: '4' });
    expect(tx.studentEnrollment.updateMany.mock.calls[0][0].where).toEqual({ studentId: 'st', endedOn: null });
    expect(tx.studentEnrollment.create.mock.calls[0][0].data).toMatchObject({ batchId: 'b2', rollNumber: '4' });

    vi.clearAllMocks();
    await moveEnrollment(tx as never, 's', 'st', { batchId: 'b1', rollNumber: '1' }, { batchId: 'b1', rollNumber: '2' });
    expect(tx.studentEnrollment.create).not.toHaveBeenCalled();
    expect(tx.studentEnrollment.updateMany.mock.calls[0][0]).toEqual({
      where: { studentId: 'st', batchId: 'b1', endedOn: null },
      data: { rollNumber: '2' },
    });

    vi.clearAllMocks();
    await moveEnrollment(tx as never, 's', 'st', { batchId: 'b1', rollNumber: '1' }, { batchId: null, rollNumber: '1' });
    expect(tx.studentEnrollment.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.studentEnrollment.create).not.toHaveBeenCalled();
  });
});
