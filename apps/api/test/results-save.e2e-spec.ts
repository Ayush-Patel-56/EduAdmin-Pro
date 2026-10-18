import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { TestsService } from '../src/assessments/tests.service.js';

/**
 * The batched results save (one raw INSERT … ON CONFLICT, then the answers
 * replaced) on a real database: a re-save updates marks and the grader, and
 * every answer lands on its own student's result.
 */
describe('saving test results on the database (e2e)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const service = new TestsService(prisma as unknown as PrismaService);
  const ids = { school: randomUUID(), program: randomUUID(), batch: randomUUID(), test: randomUUID(), q1: randomUUID(), q2: randomUUID(), s1: randomUUID(), s2: randomUUID(), u1: randomUUID(), u2: randomUUID() };
  const admin = (userId: string) => ({ kind: 'ADMIN' as const, schoolId: ids.school, userId });

  beforeAll(async () => {
    const tag = ids.school.slice(0, 8);
    await prisma.school.create({ data: { id: ids.school, name: `E2E ${tag}`, inviteCode: `E2E-${tag}`, board: 'CBSE' } });
    await prisma.user.createMany({
      data: [
        { id: ids.u1, email: `first-${tag}@e2e.test`, passwordHash: 'x', fullName: 'First Grader', accountType: 'ADMIN' },
        { id: ids.u2, email: `second-${tag}@e2e.test`, passwordHash: 'x', fullName: 'Second Grader', accountType: 'ADMIN' },
      ],
    });
    await prisma.program.create({ data: { id: ids.program, schoolId: ids.school, name: 'JEE', isStandard: true, sortOrder: 1 } });
    await prisma.batch.create({ data: { id: ids.batch, schoolId: ids.school, programId: ids.program, name: 'B1', startDate: new Date('2026-04-01T00:00:00Z') } });
    await prisma.student.createMany({
      data: [
        { id: ids.s1, schoolId: ids.school, fullName: 'Aarav', rollNumber: '01', batchId: ids.batch, status: 'ACTIVE' },
        { id: ids.s2, schoolId: ids.school, fullName: 'Diya', rollNumber: '02', batchId: ids.batch, status: 'ACTIVE' },
      ],
    });
    const startsAt = new Date(Date.now() - 4 * 3_600_000);
    await prisma.test.create({
      data: { id: ids.test, schoolId: ids.school, title: 'E2E mock', type: 'MOCK', subject: 'Physics', batchId: ids.batch, startsAt, endsAt: new Date(startsAt.getTime() + 180 * 60_000), durationMinutes: 180, totalMarks: 8, createdByName: 'First Grader' },
    });
    const question = { schoolId: ids.school, testId: ids.test, subject: 'Physics', topic: 'Heat', difficulty: 'EASY' as const, type: 'MCQ' as const, text: 'Q?', options: ['a', 'b', 'c', 'd'], correctAnswer: 'B', marks: 4, negativeMarks: 1 };
    await prisma.testQuestion.createMany({ data: [{ ...question, id: ids.q1, position: 1 }, { ...question, id: ids.q2, position: 2 }] });
  });

  afterAll(async () => {
    await prisma.testResult.deleteMany({ where: { schoolId: ids.school } });
    await prisma.school.delete({ where: { id: ids.school } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.u1, ids.u2] } } });
    await prisma.$disconnect();
  });

  const answers = (r1: string, r2: string) => [
    { testQuestionId: ids.q1, response: r1 },
    { testQuestionId: ids.q2, response: r2 },
  ];

  it('stores each result with its own answers, then a re-save updates marks, counts and grader and replaces the answers', async () => {
    await service.saveResults(admin(ids.u1), ids.test, {
      results: [
        { studentId: ids.s1, present: true, answers: answers('B', 'B') },
        { studentId: ids.s2, present: true, answers: answers('A', 'B') },
      ],
    } as never);
    const first = await prisma.testResult.findMany({ where: { testId: ids.test }, include: { answers: true }, orderBy: { studentId: 'asc' } });
    const byStudent = (rows: typeof first, id: string) => rows.find((r) => r.studentId === id)!;
    expect(Number(byStudent(first, ids.s1).marks)).toBe(8);
    expect(Number(byStudent(first, ids.s2).marks)).toBe(3);
    // Every answer is on its own student's result, and on the test.
    for (const r of first) {
      expect(r.answers).toHaveLength(2);
      expect(r.answers.every((a) => a.resultId === r.id && a.testId === ids.test)).toBe(true);
    }
    expect(byStudent(first, ids.s2).answers.find((a) => a.testQuestionId === ids.q1)?.outcome).toBe('INCORRECT');

    // Diya's answers corrected by another admin; Aarav marked absent.
    const out = await service.saveResults(admin(ids.u2), ids.test, {
      results: [
        { studentId: ids.s2, present: true, answers: answers('B', 'B') },
        { studentId: ids.s1, present: false },
      ],
    } as never);
    const second = await prisma.testResult.findMany({ where: { testId: ids.test }, include: { answers: true } });
    expect(second).toHaveLength(2);
    const diya = byStudent(second, ids.s2);
    expect({ marks: Number(diya.marks), correct: diya.correct, incorrect: diya.incorrect, gradedBy: diya.gradedBy, gradedById: diya.gradedById }).toEqual({
      marks: 8,
      correct: 2,
      incorrect: 0,
      gradedBy: 'Second Grader',
      gradedById: ids.u2,
    });
    // The same result row (updated, not re-created), with its answers replaced.
    expect(diya.id).toBe(byStudent(first, ids.s2).id);
    expect(diya.answers.map((a) => a.outcome).sort()).toEqual(['CORRECT', 'CORRECT']);
    const aarav = byStudent(second, ids.s1);
    expect({ present: aarav.present, marks: aarav.marks, answers: aarav.answers.length }).toEqual({ present: false, marks: null, answers: 0 });
    expect(await prisma.testAnswer.count({ where: { testId: ids.test } })).toBe(2);
    // The sheet comes back with ranks over those present.
    expect('rows' in out && out.rows.find((r) => r.student.id === ids.s2)?.result?.rank).toBe(1);
  });
});
