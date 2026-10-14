import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AccessService, TeacherScope } from '../academic/access.service.js';
import { Prisma } from '../generated/prisma/client.js';
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
    for (const hidden of ['admissionNumber', 'aadharNumber', 'email', 'phone', 'parentContact', 'address', 'guardians', 'dateOfBirth']) {
      expect(detail).not.toHaveProperty(hidden);
    }
    // PRD 5.5 includes notes in the faculty view.
    expect(detail).toMatchObject({ fullName: 'Riya', gender: 'Female', previousSchool: 'DPS', notes: 'private' });
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
  const claim = vi.fn();
  const discard = vi.fn();
  const transaction = vi.fn();
  const tx = {
    $queryRaw: vi.fn(),
    batch: { findUniqueOrThrow: vi.fn().mockResolvedValue({ name: '10-A', program: { name: 'JEE' } }) },
    student: { findUniqueOrThrow: vi.fn(), update: vi.fn(), create: vi.fn().mockResolvedValue({ id: 'new' }), delete: vi.fn() },
    attendanceRecord: { count: vi.fn().mockResolvedValue(0) },
    feeDue: { count: vi.fn().mockResolvedValue(0) },
    studentGuardian: { count: vi.fn().mockResolvedValue(0), updateMany: vi.fn(), create: vi.fn().mockResolvedValue({ id: 'g1' }), findFirst: vi.fn(), update: vi.fn() },
    studentEnrollment: { updateMany: vi.fn(), create: vi.fn() },
  };
  const studentFindMany = vi.fn();
  const prisma = {
    school: { findUniqueOrThrow: vi.fn().mockResolvedValue({ classes: ['9th', '10th'] }) },
    batch: { findFirst: batchFindFirst },
    program: { findFirst: programFindFirst },
    student: { findFirst: studentFindFirst, delete: vi.fn(), findMany: studentFindMany },
    $transaction: transaction,
  } as unknown as PrismaService;
  const service = new StudentsService(prisma, { claim, discard } as unknown as FilesService);
  const runTx = () => transaction.mockImplementation((run: (t: typeof tx) => unknown) => run(tx));

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
    batchFindFirst.mockResolvedValue({ name: 'A', classLevel: null, programId: 'p-jee', program: { name: 'JEE' } });
    await expect(service.create('school-1', 'u', dto({ batchId: 'b1', programId: 'p-neet' }))).rejects.toThrow('That batch belongs to JEE');
    await expect(service.create('school-1', 'u', dto({ batchId: 'b1' }))).resolves.toEqual({ id: 'new-id' });
  });

  it('a photo must be a READY upload by this admin that no other student uses', async () => {
    claim.mockRejectedValue(new BadRequestException('Upload the file again'));
    await expect(service.create('school-1', 'admin-1', dto({ photoFileId: 'f1' }))).rejects.toBeInstanceOf(BadRequestException);
    expect(claim).toHaveBeenCalledWith('school-1', 'f1', 'STUDENT_PHOTO', 'admin-1', undefined);
  });

  it('a class-specific batch refuses another class, and fills the class in when blank', async () => {
    batchFindFirst.mockResolvedValue({ name: '10-A', classLevel: 10, programId: 'p', program: { name: 'JEE' } });
    await expect(service.create('school-1', 'u', dto({ batchId: 'b1', classLevel: '9th' }))).rejects.toThrow('10-A is a class 10 batch; this student is in 9th');
    runTx();
    await service.create('school-1', 'u', dto({ batchId: 'b1' }));
    expect(tx.student.create.mock.calls[0][0].data.classLevel).toBe('10th');
    expect(tx.studentEnrollment.create.mock.calls[0][0].data).toMatchObject({ batchId: 'b1', batchName: '10-A', programName: 'JEE' });
  });

  it('a future date of birth is refused', async () => {
    await expect(service.create('school-1', 'u', dto({ dateOfBirth: '2999-01-01' }))).rejects.toThrow('future');
  });

  it("another school's student is a 404 for edit and delete (the lock includes the school)", async () => {
    runTx();
    tx.$queryRaw.mockResolvedValue([]);
    await expect(service.update('school-1', 'u', 'st-x', dto())).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(['st-x', 'school-1']);
    expect(tx.student.update).not.toHaveBeenCalled();
    await expect(service.remove('school-1', 'st-x')).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual(['st-x', 'school-1']);
    expect(tx.student.delete).not.toHaveBeenCalled();
  });

  it('a delete that succeeded is reported as success even if its photo cannot be removed', async () => {
    runTx();
    tx.$queryRaw.mockResolvedValue([{ id: 'st-1' }]);
    tx.student.findUniqueOrThrow.mockResolvedValue({ photo: { id: 'f1', key: 'k' } });
    discard.mockRejectedValue(new Error('still referenced'));
    await expect(service.remove('school-1', 'st-1')).resolves.toEqual({ ok: true });
  });

  it('a student with fee dues is not deleted (financial records stay)', async () => {
    runTx();
    tx.$queryRaw.mockResolvedValue([{ id: 'st-1' }]);
    tx.feeDue.count.mockResolvedValueOnce(2);
    await expect(service.remove('school-1', 'st-1')).rejects.toThrow('This student has 2 fee dues on record');
    expect(tx.feeDue.count.mock.calls[0][0].where).toEqual({ schoolId: 'school-1', studentId: 'st-1' });
    expect(tx.student.delete).not.toHaveBeenCalled();
  });

  it('a student with recorded attendance is not deleted (attendance is a record); checked under the lock', async () => {
    runTx();
    tx.$queryRaw.mockResolvedValue([{ id: 'st-1' }]);
    tx.attendanceRecord.count.mockResolvedValueOnce(3);
    await expect(service.remove('school-1', 'st-1')).rejects.toEqual(
      new ConflictException(
        "Attendance is recorded for this student in 3 classes, so they can't be deleted. Set their status to Inactive or Transferred instead.",
      ),
    );
    expect(tx.attendanceRecord.count.mock.calls[0][0].where).toEqual({ schoolId: 'school-1', studentId: 'st-1' });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.attendanceRecord.count.mock.invocationCallOrder[0]);
    expect(tx.student.delete).not.toHaveBeenCalled();
  });

  it('guardian changes lock the student first, and a lost race is a 409, not a 500', async () => {
    runTx();
    tx.$queryRaw.mockResolvedValue([{ id: 'st-1' }]);
    await service.addGuardian('school-1', 'st-1', { name: 'Mom', isPrimary: false } as never);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.studentGuardian.count.mock.invocationCallOrder[0]);
    // The first guardian becomes the primary contact.
    expect(tx.studentGuardian.create.mock.calls[0][0].data.isPrimary).toBe(true);
    transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 't' }));
    await expect(service.addGuardian('school-1', 'st-1', { name: 'Dad', isPrimary: true } as never)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.updateGuardian('school-1', 'st-1', 'g1', { name: 'Dad', isPrimary: true } as never)).rejects.toBeInstanceOf(ConflictException);
  });

  it('export comes in pages with a hasMore flag, never silently cut off', async () => {
    const row = { fullName: 'A', admissionNumber: null, aadharNumber: null, rollNumber: null, email: null, phone: null, parentContact: null, address: null, city: null, state: null, pincode: null, dateOfBirth: null, gender: null, bloodGroup: null, previousSchool: null, previousPercentage: null, classLevel: null, program: null, batch: null, admissionDate: null, status: 'ACTIVE', notes: null, guardians: [] };
    studentFindMany.mockResolvedValue(Array(1001).fill(row));
    const first = await service.exportRows('school-1', {});
    expect(first.hasMore).toBe(true);
    expect(first.rows).toHaveLength(1000);
    expect(studentFindMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 1001 });
    studentFindMany.mockResolvedValue([row]);
    await expect(service.exportRows('school-1', { page: 2 })).resolves.toMatchObject({ hasMore: false });
    expect(studentFindMany.mock.calls[1][0]).toMatchObject({ skip: 1000 });
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
    expect(message(['Student_photoFileId_key'])).toMatch(/photo is already used/);
  });

  it('moving batch closes the open enrollment and opens a new one; a new roll updates it', async () => {
    const tx = {
      studentEnrollment: { updateMany: vi.fn(), create: vi.fn() },
      batch: { findUniqueOrThrow: vi.fn().mockResolvedValue({ name: 'Batch 2', program: { name: 'NEET' } }) },
    };
    await moveEnrollment(tx as never, 's', 'st', { batchId: 'b1', rollNumber: '1' }, { batchId: 'b2', rollNumber: '4' });
    expect(tx.studentEnrollment.updateMany.mock.calls[0][0].where).toEqual({ studentId: 'st', endedOn: null });
    // The names are kept, so the history survives deleting the batch.
    expect(tx.studentEnrollment.create.mock.calls[0][0].data).toMatchObject({ batchId: 'b2', batchName: 'Batch 2', programName: 'NEET', rollNumber: '4' });

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
