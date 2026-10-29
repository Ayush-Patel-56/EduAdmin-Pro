import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { HttpException } from '@nestjs/common';
import { FeedbackLinksService } from '../src/feedback/feedback-links.service.js';
import { PublicFeedbackService } from '../src/feedback/public-feedback.service.js';
import type { StudentFeedbackDto } from '../src/feedback/public-feedback.dto.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

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

  describe('the public form', () => {
    const links = new FeedbackLinksService(prisma as unknown as PrismaService);
    const form = new PublicFeedbackService(prisma as unknown as PrismaService);
    const send = (token: string, over: Partial<StudentFeedbackDto> = {}) =>
      form.submit(token, { studentId: ids.s1, facultyId: ids.f1, rating: 5, comment: 'Clear and patient explanations.', ...over } as StudentFeedbackDto);
    const status = (e: unknown) => (e instanceof HttpException ? e.getStatus() : e);
    let token: string;

    beforeAll(async () => {
      token = (await links.create(ids.school, 'e2e-admin', ids.batchA)).token!;
      await links.create(ids.school, 'e2e-admin', ids.batchB);
    });

    it('GET returns only this batch: active students without roll numbers, assigned non-inactive teachers', async () => {
      const page = await form.form(token);
      expect(page).toMatchObject({ batchName: 'JEE A', schoolName: `E2E SFL ${tag}`, cooldownMinutes: 15 });
      expect(page.students).toEqual([
        { id: ids.s1, name: 'Aarav Sharma' },
        { id: ids.s2, name: 'Diya Patel' },
      ]);
      expect(page.teachers).toEqual([{ id: ids.f1, name: 'Vikram Rao', subjects: ['Physics'] }]);
      expect(JSON.stringify(page)).not.toContain('A01');
    });

    it('two submissions by one student at the same moment: one 201, one 429', async () => {
      const results = await Promise.allSettled([send(token), send(token)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(status(rejected?.reason)).toBe(429);
      expect(await prisma.feedback.count({ where: { schoolId: ids.school, studentId: ids.s1 } })).toBe(1);
    });

    it('a student moved to another batch is refused and no longer listed', async () => {
      await prisma.student.update({ where: { id: ids.s2 }, data: { batchId: ids.batchB } });
      try {
        expect((await form.form(token)).students.map((s) => s.id)).not.toContain(ids.s2);
        expect(status(await send(token, { studentId: ids.s2 }).catch((e: unknown) => e))).toBe(400);
        // Nor can another school's or batch's student be sent through this link.
        expect(status(await send(token, { studentId: ids.sB }).catch((e: unknown) => e))).toBe(400);
        expect(status(await send(token, { studentId: ids.s3 }).catch((e: unknown) => e))).toBe(400);
      } finally {
        await prisma.student.update({ where: { id: ids.s2 }, data: { batchId: ids.batchA } });
      }
    });

    it('a teacher unassigned or made inactive is refused and dropped from the list', async () => {
      const f4 = id();
      await prisma.faculty.create({ data: { id: f4, schoolId: ids.school, name: 'Visiting Teacher' } });
      await prisma.facultyBatch.create({ data: { facultyId: f4, batchId: ids.batchA, schoolId: ids.school } });
      expect((await form.form(token)).teachers.map((t) => t.id)).toContain(f4);
      await prisma.facultyBatch.deleteMany({ where: { facultyId: f4 } });
      expect((await form.form(token)).teachers.map((t) => t.id)).not.toContain(f4);
      expect(status(await send(token, { studentId: ids.s2, facultyId: f4 }).catch((e: unknown) => e))).toBe(400);
      // Assigned but inactive, and another batch's teacher.
      expect(status(await send(token, { studentId: ids.s2, facultyId: ids.f2 }).catch((e: unknown) => e))).toBe(400);
      expect(status(await send(token, { studentId: ids.s2, facultyId: ids.f3 }).catch((e: unknown) => e))).toBe(400);
      expect(await prisma.feedback.count({ where: { schoolId: ids.school, studentId: ids.s2 } })).toBe(0);
    });

    it('a replaced or switched-off link is 404 for a student who already has the page open', async () => {
      const replaced = (await links.regenerate(ids.school, ids.batchA)).token!;
      expect(replaced).not.toBe(token);
      expect(status(await send(token, { studentId: ids.s2 }).catch((e: unknown) => e))).toBe(404);
      await links.setActive(ids.school, ids.batchA, false);
      expect(status(await send(replaced, { studentId: ids.s2 }).catch((e: unknown) => e))).toBe(404);
      expect(status(await form.form(replaced).catch((e: unknown) => e))).toBe(404);
      // The other batch's link is untouched, and switching back on works.
      await links.setActive(ids.school, ids.batchA, true);
      await expect(send(replaced, { studentId: ids.s2 })).resolves.toMatchObject({ ok: true });
      token = replaced;
    });

    it("another school's admin can't reach this school's batch link", async () => {
      await expect(links.create(randomUUID(), 'e2e-admin', ids.batchA)).rejects.toThrow('Batch not found');
      await expect(links.setActive(randomUUID(), ids.batchA, false)).rejects.toThrow('This batch has no feedback link');
    });
  });
});
