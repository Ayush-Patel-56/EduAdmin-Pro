import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

/**
 * Student feedback links on a real database: the rows stay tied to their
 * school, batch and student, and outlive the student and batch they name.
 */
describe('student feedback links on the database (e2e)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const id = () => randomUUID();
  const ids = { school: id(), program: id(), batchA: id(), batchB: id(), s1: id(), s2: id(), s3: id(), sB: id(), f1: id(), f2: id(), f3: id() };
  const tag = ids.school.slice(0, 8);

  beforeAll(async () => {
    await prisma.school.create({ data: { id: ids.school, name: `E2E SFL ${tag}`, inviteCode: `SF-${tag}`, board: 'CBSE' } });
    await prisma.program.create({ data: { id: ids.program, schoolId: ids.school, name: 'JEE', isStandard: true, sortOrder: 1 } });
    await prisma.batch.createMany({
      data: [
        { id: ids.batchA, schoolId: ids.school, programId: ids.program, name: 'JEE A', startDate: new Date('2026-04-01T00:00:00Z') },
        { id: ids.batchB, schoolId: ids.school, programId: ids.program, name: 'JEE B', startDate: new Date('2026-04-01T00:00:00Z') },
      ],
    });
    await prisma.student.createMany({
      data: [
        { id: ids.s1, schoolId: ids.school, fullName: 'Aarav Sharma', batchId: ids.batchA, programId: ids.program, rollNumber: 'A01' },
        { id: ids.s2, schoolId: ids.school, fullName: 'Diya Patel', batchId: ids.batchA, programId: ids.program },
        { id: ids.s3, schoolId: ids.school, fullName: 'Left Student', batchId: ids.batchA, programId: ids.program, status: 'INACTIVE' },
        { id: ids.sB, schoolId: ids.school, fullName: 'Other Batch', batchId: ids.batchB, programId: ids.program },
      ],
    });
    await prisma.faculty.createMany({
      data: [
        { id: ids.f1, schoolId: ids.school, name: 'Vikram Rao', subjects: ['Physics'] },
        { id: ids.f2, schoolId: ids.school, name: 'Inactive Teacher', status: 'INACTIVE' },
        { id: ids.f3, schoolId: ids.school, name: 'Batch B Teacher' },
      ],
    });
    await prisma.facultyBatch.createMany({
      data: [
        { facultyId: ids.f1, batchId: ids.batchA, schoolId: ids.school },
        { facultyId: ids.f2, batchId: ids.batchA, schoolId: ids.school },
        { facultyId: ids.f3, batchId: ids.batchB, schoolId: ids.school },
      ],
    });
  });

  afterAll(async () => {
    await prisma.school.deleteMany({ where: { id: ids.school } });
    await prisma.$disconnect();
  });

  it('feedback outlives its student and batch, keeping their names', async () => {
    const batch = id();
    const student = id();
    await prisma.batch.create({ data: { id: batch, schoolId: ids.school, programId: ids.program, name: 'Temp batch', startDate: new Date('2026-04-01T00:00:00Z') } });
    await prisma.student.create({ data: { id: student, schoolId: ids.school, fullName: 'Temp Student', batchId: batch, programId: ids.program } });
    const row = await prisma.feedback.create({
      data: {
        schoolId: ids.school,
        direction: 'STUDENT_TO_TEACHER',
        senderName: 'Temp Student',
        studentId: student,
        studentName: 'Temp Student',
        batchId: batch,
        batchName: 'Temp batch',
        targetFacultyId: ids.f1,
        targetName: 'Vikram Rao',
        rating: 4,
        content: 'Explains kinematics clearly.',
        feedbackDate: new Date('2026-10-30T00:00:00Z'),
      },
    });
    await prisma.student.delete({ where: { id: student } });
    await prisma.batch.delete({ where: { id: batch } });
    const kept = await prisma.feedback.findUniqueOrThrow({ where: { id: row.id } });
    expect(kept).toMatchObject({ studentId: null, batchId: null, studentName: 'Temp Student', batchName: 'Temp batch', schoolId: ids.school });
  });

  it('the direction rule keeps student fields on Student -> Teacher rows only', async () => {
    const base = { schoolId: ids.school, senderName: 'Someone', rating: 3, content: 'Some feedback text.', feedbackDate: new Date('2026-10-30T00:00:00Z') };
    const student = { studentId: ids.s1, studentName: 'Aarav Sharma', batchId: ids.batchA, batchName: 'JEE A' };
    // A student row without its student or teacher names, or sent "to every teacher".
    await expect(prisma.feedback.create({ data: { ...base, direction: 'STUDENT_TO_TEACHER', targetFacultyId: ids.f1, targetName: 'Vikram Rao', batchName: 'JEE A' } })).rejects.toThrow(/Feedback_direction_check/);
    await expect(prisma.feedback.create({ data: { ...base, ...student, direction: 'STUDENT_TO_TEACHER', targetFacultyId: ids.f1 } })).rejects.toThrow(/Feedback_direction_check/);
    await expect(prisma.feedback.create({ data: { ...base, ...student, direction: 'STUDENT_TO_TEACHER', toAllFaculty: true, targetName: 'x' } })).rejects.toThrow(/Feedback_direction_check/);
    await expect(prisma.feedback.create({ data: { ...base, ...student, direction: 'STUDENT_TO_TEACHER', senderFacultyId: ids.f1, targetFacultyId: ids.f1, targetName: 'Vikram Rao' } })).rejects.toThrow(/Feedback_direction_check/);
    // A teacher's own feedback can't carry a student.
    await expect(prisma.feedback.create({ data: { ...base, ...student, direction: 'TEACHER_TO_MANAGEMENT', senderFacultyId: ids.f1 } })).rejects.toThrow(/Feedback_direction_check/);
  });
});
