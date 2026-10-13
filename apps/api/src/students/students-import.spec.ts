import { ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { StudentImportRow } from './students.dto.js';
import { StudentImportService } from './students-import.service.js';

const programs = [
  { id: 'p-jee', name: 'JEE' },
  { id: 'p-neet', name: 'NEET' },
];
const batches = [
  { id: 'b-jee-a', name: 'Batch A', programId: 'p-jee' },
  { id: 'b-neet-a', name: 'Batch A', programId: 'p-neet' },
  { id: 'b-neet-b', name: 'Batch B', programId: 'p-neet' },
];

describe('StudentImportService', () => {
  const studentFindMany = vi.fn();
  const transaction = vi.fn();
  const prisma = {
    school: { findUniqueOrThrow: vi.fn().mockResolvedValue({ classes: ['9th', '10th'] }) },
    program: { findMany: vi.fn().mockResolvedValue(programs) },
    batch: { findMany: vi.fn().mockResolvedValue(batches) },
    student: { findMany: studentFindMany },
    $transaction: transaction,
  } as unknown as PrismaService;
  const importer = new StudentImportService(prisma);
  const preview = (rows: StudentImportRow[], defaults?: { programId?: string; batchId?: string }) =>
    importer.import('school-1', { rows, dryRun: true, defaults });

  beforeEach(() => {
    vi.clearAllMocks();
    studentFindMany.mockResolvedValue([
      { id: 'st-rahul', admissionNumber: 'ADM-101', aadharNumber: '234567890123', batchId: 'b-neet-b', rollNumber: '101' },
    ]);
  });

  it('accepts the sample sheet: class "9", "82%", Aadhaar with dashes, lower-case status', async () => {
    const result = await preview([
      {
        fullName: 'Priya Patel', admissionNumber: 'adm-102', aadharNumber: '3234-5678-9012', rollNumber: '102',
        email: 'Priya.Patel@Example.com', phone: '9876500002', parentContact: '9123456789', pincode: '395001',
        dateOfBirth: '2010-09-03', gender: 'female', bloodGroup: 'o+', previousPercentage: '91%', classLevel: '9',
        admissionDate: '2025-06-01', status: 'active', guardianName: 'Meena Patel', guardianRelationship: 'Mother',
        guardianPhone: '9123456789', guardianEmail: 'meena.patel@example.com',
      },
    ]);
    expect(result.rows[0]).toMatchObject({ action: 'create', errors: [] });
  });

  it('never matches by name: same name, no admission number or Aadhaar, is a new student', async () => {
    const result = await preview([{ fullName: 'Rahul Sharma' }]);
    expect(result.rows[0].action).toBe('create');
  });

  it('matches by admission number (any case), else by Aadhaar', async () => {
    const result = await preview([
      { fullName: 'Rahul S', admissionNumber: 'adm-101' },
      { fullName: 'Rahul S', aadharNumber: '2345 6789 0123' },
    ]);
    expect(result.rows.map((r) => r.action)).toEqual(['update', 'error']);
    // The second row is the same student as the first, so it's flagged in-file.
    expect(result.rows[1].errors[0]).toBe('Same student as row 2');
  });

  it('flags an admission number and an Aadhaar that belong to two different students', async () => {
    studentFindMany.mockResolvedValue([
      { id: 'a', admissionNumber: 'ADM-1', aadharNumber: null, batchId: null, rollNumber: null },
      { id: 'b', admissionNumber: null, aadharNumber: '234567890123', batchId: null, rollNumber: null },
    ]);
    const result = await preview([{ fullName: 'X', admissionNumber: 'ADM-1', aadharNumber: '234567890123' }]);
    expect(result.rows[0].errors).toContain('Admission number and Aadhaar belong to two different students');
  });

  it('validates every cell with a readable reason', async () => {
    const result = await preview([
      { fullName: '', phone: '12345', aadharNumber: '1234', pincode: '12', classLevel: '12th', bloodGroup: 'Z+', previousPercentage: '140', gender: 'x', status: 'gone', dateOfBirth: '31-02-2010' },
    ]);
    const errors = result.rows[0].errors.join(' | ');
    for (const expected of ['Name is required', 'Phone must be', 'Aadhaar', 'Pincode', "doesn't offer class", 'Blood Group', 'Previous Percentage', 'Gender', 'Status', 'Date of Birth']) {
      expect(errors).toContain(expected);
    }
    expect(result.skipped).toBe(1);
  });

  it('a batch name used in two programs needs the Program column', async () => {
    const result = await preview([{ fullName: 'A', batch: 'Batch A' }, { fullName: 'B', batch: 'Batch A', program: 'jee' }]);
    expect(result.rows[0].errors[0]).toMatch(/More than one batch is named "Batch A"/);
    expect(result.rows[1].action).toBe('create');
  });

  it('defaults fill blank cells; the row’s own program wins, and a default batch of another program is not applied', async () => {
    const result = await preview(
      [{ fullName: 'A' }, { fullName: 'B', program: 'JEE' }],
      { programId: 'p-neet', batchId: 'b-neet-b' },
    );
    expect(result.rows.every((r) => r.action === 'create')).toBe(true);
  });

  it('roll numbers are unique within a batch, against saved students and inside the file', async () => {
    const result = await preview([
      { fullName: 'New', batch: 'Batch B', rollNumber: '101' },
      { fullName: 'C', batch: 'Batch B', rollNumber: '7' },
      { fullName: 'D', batch: 'Batch B', rollNumber: '7' },
    ]);
    expect(result.rows[0].errors[0]).toMatch(/already taken/);
    expect(result.rows[1].action).toBe('create');
    expect(result.rows[2].errors[0]).toMatch(/same batch as row 3/);
  });

  it('a duplicate created while importing is a 409, not a 500', async () => {
    transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
    );
    await expect(
      importer.import('school-1', { rows: [{ fullName: 'New' }], dryRun: false }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('a preview writes nothing', async () => {
    await preview([{ fullName: 'New' }]);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('applying creates students, their enrollment and primary guardian in one go', async () => {
    const tx = {
      student: { createMany: vi.fn(), update: vi.fn() },
      studentEnrollment: { createMany: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
      studentGuardian: { createMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), count: vi.fn(), create: vi.fn() },
    };
    transaction.mockImplementation((run: (t: typeof tx) => unknown) => run(tx));
    const result = await importer.import('school-1', {
      rows: [{ fullName: 'Amit', batch: 'Batch B', rollNumber: '5', guardianName: 'Ravi' }],
      dryRun: false,
    });
    expect(result).toMatchObject({ applied: true, created: 1 });
    const student = tx.student.createMany.mock.calls[0][0].data[0];
    expect(student).toMatchObject({ fullName: 'Amit', programId: 'p-neet', batchId: 'b-neet-b', status: 'ACTIVE', schoolId: 'school-1' });
    expect(tx.studentEnrollment.createMany.mock.calls[0][0].data[0]).toMatchObject({ studentId: student.id, batchId: 'b-neet-b', rollNumber: '5' });
    expect(tx.studentGuardian.createMany.mock.calls[0][0].data[0]).toMatchObject({ studentId: student.id, name: 'Ravi', isPrimary: true });
  });
});
