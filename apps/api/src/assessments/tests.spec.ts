import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { TeacherScope } from '../academic/access.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { Actor } from './actor.js';
import type { TestDto } from './assessments.dto.js';
import type { PaperQuestion } from './scoring.js';
import { prepareResult, TEST_SCAN_LIMIT, TestsService } from './tests.service.js';

const scope = (over: Partial<TeacherScope> = {}): TeacherScope => ({ schoolId: 'school-1', facultyId: 'fac-1', batchIds: ['b1'], programIds: [], active: true, ...over });
const teacher = (over: Partial<TeacherScope> = {}): Actor => ({ kind: 'TEACHER', schoolId: 'school-1', userId: 'u-t', scope: scope(over) });
const admin: Actor = { kind: 'ADMIN', schoolId: 'school-1', userId: 'u-a' };
const testDto = (over: Partial<TestDto> = {}): TestDto =>
  ({ title: 'JEE Mock 1', type: 'MOCK', subject: 'Physics', batchId: 'b1', date: '2026-10-20', time: '10:00', durationMinutes: 180, totalMarks: 300, ...over }) as TestDto;

const row = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  schoolId: 'school-1',
  title: 'JEE Mock 1',
  type: 'MOCK',
  subject: 'Physics',
  batchId: 'b1',
  startsAt: new Date('2026-10-17T04:30:00Z'),
  durationMinutes: 180,
  totalMarks: 300,
  status: 'SCHEDULED',
  facultyId: 'fac-1',
  createdByName: 'Ayush',
  batch: { id: 'b1', name: 'JEE 2027 A', program: { id: 'p1', name: 'JEE' } },
  _count: { questions: 0, results: 0 },
  ...over,
});
const locked = (over: Record<string, unknown> = {}) => [{ id: 't1', batchId: 'b1', facultyId: 'fac-1', status: 'SCHEDULED', startsAt: new Date('2026-10-17T04:30:00Z'), totalMarks: 300, ...over }];
const paperRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  questionId: `bank-${id}`,
  position: 1,
  subject: 'Physics',
  chapterName: null,
  topic: 'Heat',
  difficulty: 'EASY',
  type: 'MCQ',
  text: 'Q?',
  options: ['a', 'b', 'c', 'd'],
  correctAnswer: 'B',
  marks: 4,
  negativeMarks: 1,
  ...over,
});
const sql = (call: unknown[]) => (call[0] as string[]).join('?');

function build() {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue(locked()),
    test: { update: vi.fn(), delete: vi.fn(), findUniqueOrThrow: vi.fn().mockResolvedValue(row()) },
    testResult: {
      aggregate: vi.fn().mockResolvedValue({ _count: { _all: 0 }, _max: { marks: null } }),
      count: vi.fn().mockResolvedValue(0),
      upsert: vi.fn().mockImplementation(({ create }) => Promise.resolve({ id: `r-${create.studentId}` })),
      findMany: vi.fn().mockResolvedValue([]),
    },
    testAnswer: { count: vi.fn().mockResolvedValue(0), deleteMany: vi.fn(), createMany: vi.fn() },
    testQuestion: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn(), createMany: vi.fn() },
    question: { findMany: vi.fn().mockResolvedValue([]) },
    student: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const prisma = {
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    $queryRaw: vi.fn().mockResolvedValue([{ average: null }]),
    batch: { findFirst: vi.fn().mockResolvedValue({ id: 'b1' }), findMany: vi.fn().mockResolvedValue([]) },
    curriculumChapter: { findMany: vi.fn().mockResolvedValue([]) },
    faculty: { findMany: vi.fn().mockResolvedValue([]), findUniqueOrThrow: vi.fn().mockResolvedValue({ name: 'Ayush' }) },
    program: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ fullName: 'Principal Mehta' }) },
    test: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(row()), create: vi.fn().mockResolvedValue({ id: 't1' }) },
    question: { count: vi.fn().mockResolvedValue(0) },
    testQuestion: { findMany: vi.fn().mockResolvedValue([]) },
    testAnswer: { count: vi.fn().mockResolvedValue(0) },
    testResult: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    student: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
  };
  return { prisma, tx, service: new TestsService(prisma as unknown as PrismaService) };
}

describe('TestsService: scheduling', () => {
  it('a teacher schedules for their own batch, at the IST time, under their name; not for another batch', async () => {
    const { service, prisma } = build();
    await service.create(teacher(), testDto());
    expect(prisma.test.create.mock.calls[0][0].data).toEqual({
      schoolId: 'school-1',
      title: 'JEE Mock 1',
      type: 'MOCK',
      subject: 'Physics',
      batchId: 'b1',
      startsAt: new Date('2026-10-20T04:30:00Z'),
      durationMinutes: 180,
      totalMarks: 300,
      facultyId: 'fac-1',
      createdByName: 'Ayush',
      createdById: 'u-t',
    });
    await expect(service.create(teacher(), testDto({ batchId: 'b2' }))).rejects.toEqual(new ForbiddenException("You aren't assigned to that batch"));
    await expect(service.create(teacher({ active: false }), testDto())).rejects.toBeInstanceOf(ForbiddenException);
    prisma.batch.findFirst.mockResolvedValueOnce(null);
    await expect(service.create(admin, testDto({ batchId: 'other-school' }))).rejects.toEqual(new BadRequestException('Select a batch of this school'));
    expect(prisma.batch.findFirst.mock.calls.at(-1)?.[0].where).toEqual({ id: 'other-school', schoolId: 'school-1' });
  });

  it('admins schedule for any batch of the school, with no faculty', async () => {
    const { service, prisma } = build();
    await service.create(admin, testDto({ batchId: 'b9' }));
    expect(prisma.test.create.mock.calls[0][0].data).toMatchObject({ batchId: 'b9', facultyId: null, createdByName: 'Principal Mehta' });
  });

  it('only the creating teacher (or an admin) edits, cancels or deletes, under a lock on the test', async () => {
    const { service, tx } = build();
    tx.$queryRaw.mockResolvedValue(locked({ facultyId: 'fac-2' }));
    await expect(service.update(teacher(), 't1', testDto())).rejects.toEqual(new ForbiddenException('Only the teacher who created this test (or an admin) can change it'));
    await expect(service.setStatus(teacher(), 't1', { cancelled: true })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.remove(teacher(), 't1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(sql(tx.$queryRaw.mock.calls[0])).toContain('FOR UPDATE');
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(['t1', 'school-1']);
    await service.setStatus(admin, 't1', { cancelled: true });
    expect(tx.test.update.mock.calls[0][0]).toEqual({ where: { id: 't1' }, data: { status: 'CANCELLED', cancelledAt: expect.any(Date) } });
    await service.setStatus(admin, 't1', { cancelled: false });
    expect(tx.test.update.mock.calls[1][0].data).toEqual({ status: 'SCHEDULED', cancelledAt: null });
  });

  it('a test of a batch the teacher no longer teaches (or another school’s) is not found', async () => {
    const { service, tx } = build();
    tx.$queryRaw.mockResolvedValueOnce(locked({ batchId: 'b7' }));
    await expect(service.setStatus(teacher(), 't1', { cancelled: true })).rejects.toBeInstanceOf(NotFoundException);
    tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(service.remove(admin, 't1')).rejects.toEqual(new NotFoundException('Test not found'));
  });

  it('with results recorded: stays with its batch, total not below the best score, and is cancelled rather than deleted', async () => {
    const { service, tx } = build();
    tx.testResult.aggregate.mockResolvedValue({ _count: { _all: 3 }, _max: { marks: { toString: () => '212.5', valueOf: () => 212.5 } } });
    await expect(service.update(admin, 't1', testDto({ batchId: 'b2' }))).rejects.toEqual(new ConflictException("Results are recorded for this test, so it can't move to another batch"));
    await expect(service.update(admin, 't1', testDto({ totalMarks: 200 }))).rejects.toThrow("A student scored 212.5, so total marks can't be less than that");
    await service.update(admin, 't1', testDto({ totalMarks: 250, title: 'Mock 1 (revised)' }));
    expect(tx.test.update.mock.calls[0][0]).toMatchObject({ where: { id: 't1' }, data: { totalMarks: 250, title: 'Mock 1 (revised)' } });
    tx.testResult.count.mockResolvedValueOnce(1);
    await expect(service.remove(admin, 't1')).rejects.toThrow('1 result is recorded for this test. Cancel it instead.');
    await service.remove(admin, 't1');
    expect(tx.test.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
  });
});

describe('TestsService: lists', () => {
  it('teachers see their batches’ tests; filters by batch, program, type, author, dates (IST days) and literal search', async () => {
    const { service, prisma } = build();
    await service.list(teacher(), { q: '100%', type: 'UNIT_TEST', from: '2026-10-19', to: '2026-10-25' });
    const where = prisma.test.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ schoolId: 'school-1', batchId: { in: ['b1'] }, type: 'UNIT_TEST', startsAt: { gte: new Date('2026-10-18T18:30:00Z'), lt: new Date('2026-10-25T18:30:00Z') } });
    expect(where.OR[0]).toEqual({ title: { contains: '100\\%', mode: 'insensitive' } });
    expect(prisma.test.findMany.mock.calls[0][0]).toMatchObject({ orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], take: TEST_SCAN_LIMIT });
    await service.list(admin, { author: 'admin', programId: 'p1' });
    expect(prisma.test.findMany.mock.calls[1][0].where).toEqual({ schoolId: 'school-1', facultyId: null, batch: { programId: 'p1' } });
    await expect(service.list(admin, { from: '2026-10-25', to: '2026-10-19' })).rejects.toThrow("To can't be before from");
  });

  it('the status filter reads the clock: Scheduled, Ongoing and Completed are worked out, then paged', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-18T06:00:00Z') });
    try {
      const { service, prisma } = build();
      prisma.test.findMany.mockResolvedValue([
        row({ id: 'later', startsAt: new Date('2026-10-19T04:30:00Z') }),
        row({ id: 'now', startsAt: new Date('2026-10-18T04:30:00Z') }),
        row({ id: 'done1', startsAt: new Date('2026-10-17T04:30:00Z') }),
        row({ id: 'done2', startsAt: new Date('2026-10-16T04:30:00Z') }),
      ]);
      const done = await service.list(admin, { status: 'COMPLETED', pageSize: 1, page: 2 });
      expect(prisma.test.findMany.mock.calls[0][0].where.status).toBe('SCHEDULED');
      expect(done).toMatchObject({ total: 2, page: 2, pageSize: 1 });
      expect(done.items.map((t) => [t.id, t.phase])).toEqual([['done2', 'COMPLETED']]);
      const ongoing = await service.list(admin, { status: 'ONGOING' });
      expect(ongoing.items[0]).toMatchObject({ id: 'now', phase: 'ONGOING', date: '2026-10-18', time: '10:00', program: { id: 'p1', name: 'JEE' }, faculty: { id: 'fac-1', name: 'Ayush' } });
      await service.list(admin, { status: 'CANCELLED' });
      expect(prisma.test.findMany.mock.calls[2][0].where.status).toBe('CANCELLED');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('TestsService: paper', () => {
  it('keeps the copies of questions already on it, copies new ones from this school’s bank, in the order given', async () => {
    const { service, tx } = build();
    tx.testQuestion.findMany.mockResolvedValueOnce([paperRow('tq1', { questionId: 'qa', text: 'As attached', marks: 4 })]);
    tx.question.findMany.mockResolvedValueOnce([{ ...paperRow('qb'), id: 'qb', text: 'New from bank', marks: 2, negativeMarks: 0, type: 'INTEGER', options: [], correctAnswer: '7' }]);
    await expect(service.setPaper(teacher(), 't1', { questionIds: ['qb', 'qa'] })).resolves.toEqual({ id: 't1', questions: 2 });
    expect(sql(tx.$queryRaw.mock.calls[0])).toContain('FOR UPDATE');
    expect(tx.question.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['qb'] }, schoolId: 'school-1' });
    expect(tx.testQuestion.deleteMany).toHaveBeenCalledWith({ where: { testId: 't1', schoolId: 'school-1' } });
    const data = tx.testQuestion.createMany.mock.calls[0][0].data;
    expect(data.map((d: { questionId: string; position: number; text: string; type: string }) => [d.questionId, d.position, d.text, d.type])).toEqual([
      ['qb', 1, 'New from bank', 'INTEGER'],
      ['qa', 2, 'As attached', 'MCQ'],
    ]);
  });

  it('a copy whose bank question was deleted stays (named by its paper id); one question can’t be named twice', async () => {
    const { service, tx } = build();
    const current = [paperRow('tq-orphan', { questionId: null, text: 'Bank copy gone' }), paperRow('tq2', { questionId: 'qa' })];
    tx.testQuestion.findMany.mockResolvedValue(current);
    await service.setPaper(admin, 't1', { questionIds: ['qa', 'tq-orphan'] });
    expect(tx.question.findMany).not.toHaveBeenCalled();
    expect(tx.testQuestion.createMany.mock.calls[0][0].data.map((d: { questionId: string | null; position: number; text: string }) => [d.questionId, d.position, d.text])).toEqual([
      ['qa', 1, 'Q?'],
      [null, 2, 'Bank copy gone'],
    ]);
    await expect(service.setPaper(admin, 't1', { questionIds: ['qa', 'tq2'] })).rejects.toThrow('A question can be on the paper only once');
  });

  it('refuses questions gone from the bank, and any change once answers are recorded', async () => {
    const { service, tx } = build();
    await expect(service.setPaper(admin, 't1', { questionIds: ['gone'] })).rejects.toThrow('Some questions are no longer in the bank');
    tx.testAnswer.count.mockResolvedValueOnce(5);
    await expect(service.setPaper(admin, 't1', { questionIds: [] })).rejects.toEqual(new ConflictException("Answers are recorded against this paper, so it can't change"));
    expect(tx.testQuestion.deleteMany).not.toHaveBeenCalled();
  });

  it('any active teacher of the batch can set the paper; a test outside their batches is not found', async () => {
    const { service, prisma } = build();
    prisma.test.findFirst.mockResolvedValueOnce(row({ facultyId: 'fac-2' }));
    await service.setPaper(teacher(), 't1', { questionIds: [] });
    prisma.test.findFirst.mockResolvedValueOnce(null);
    await expect(service.setPaper(teacher(), 't1', { questionIds: [] })).rejects.toEqual(new NotFoundException('Test not found'));
    expect(prisma.test.findFirst.mock.calls[1][0].where).toEqual({ id: 't1', schoolId: 'school-1', batchId: { in: ['b1'] } });
  });

  it('detail: the paper, its total, whether it is locked, and whether this person can edit the test', async () => {
    const { service, prisma } = build();
    prisma.testQuestion.findMany.mockResolvedValueOnce([paperRow('tq1'), paperRow('tq2', { position: 2, marks: 2 })]);
    prisma.testAnswer.count.mockResolvedValueOnce(1);
    prisma.test.findFirst.mockResolvedValueOnce(row({ facultyId: 'fac-2' }));
    const out = await service.detail(teacher(), 't1');
    expect(out.paper).toMatchObject({ totalMarks: 6, locked: true });
    expect(out.canEdit).toBe(false);
    expect((await service.detail(teacher(), 't1')).canEdit).toBe(true);
  });
});

describe('preparing a result', () => {
  const paper: PaperQuestion[] = [
    { id: 'q1', type: 'MCQ', correctAnswer: 'B', marks: 4, negativeMarks: 1 },
    { id: 'q2', type: 'INTEGER', correctAnswer: '12', marks: 4, negativeMarks: 0 },
    { id: 'q3', type: 'SUBJECTIVE', correctAnswer: null, marks: 5, negativeMarks: 0 },
  ];

  it('from answers: every question of the paper gets an outcome and the totals come from them', () => {
    const out = prepareResult({ studentId: 's1', present: true, answers: [{ testQuestionId: 'q1', response: 'C' }, { testQuestionId: 'q3', marksAwarded: 3 }] }, paper, 300);
    expect(out).toMatchObject({ present: true, marks: 2, correct: 1, incorrect: 1, unattempted: 1 });
    expect(out.answers.map((a) => a.outcome)).toEqual(['INCORRECT', 'UNATTEMPTED', 'PARTIAL']);
  });

  it('as totals: marks with optional counts that fit the paper', () => {
    expect(prepareResult({ studentId: 's1', present: true, marks: 180.5, correct: 2 }, paper, 300)).toMatchObject({ marks: 180.5, correct: 2, incorrect: null, answers: [] });
    expect(() => prepareResult({ studentId: 's1', present: true, marks: 10, correct: 2, incorrect: 2 }, paper, 300)).toThrow("add up to more than the paper's 3 questions");
    expect(() => prepareResult({ studentId: 's1', present: true, marks: 301 }, paper, 300)).toThrow('Marks must be within 300');
    expect(() => prepareResult({ studentId: 's1', present: true }, paper, 300)).toThrow('Enter the marks, or mark the student absent');
  });

  it('absent: no marks, counts or answers', () => {
    expect(prepareResult({ studentId: 's1', present: false, remarks: 'Unwell' }, paper, 300)).toEqual({ present: false, marks: null, correct: null, incorrect: null, unattempted: null, remarks: 'Unwell', answers: [] });
    expect(() => prepareResult({ studentId: 's1', present: false, marks: 0 }, paper, 300)).toThrow("An absent student can't have marks or answers");
  });

  it('refuses answers off the paper, twice for one question, a bad answer (naming the question), or a score over the total', () => {
    expect(() => prepareResult({ studentId: 's', present: true, answers: [{ testQuestionId: 'zz', response: 'A' }] }, paper, 300)).toThrow('not on this paper');
    expect(() => prepareResult({ studentId: 's', present: true, answers: [{ testQuestionId: 'q1', response: 'A' }, { testQuestionId: 'q1', response: 'B' }] }, paper, 300)).toThrow('answered twice');
    expect(() => prepareResult({ studentId: 's', present: true, answers: [{ testQuestionId: 'q2', response: '1.5' }] }, paper, 300)).toThrow('Q2: An integer answer is a whole number');
    expect(() => prepareResult({ studentId: 's', present: true, answers: [{ testQuestionId: 'q1', response: 'B' }] }, paper, 3)).toThrow("more than the test's 3 marks");
    expect(() => prepareResult({ studentId: 's', present: true, answers: [{ testQuestionId: 'q1', response: 'B' }] }, [], 300)).toThrow('This test has no paper');
  });
});

describe('TestsService: results', () => {
  const roster = [
    { id: 's1', fullName: 'Aarav Shah', rollNumber: '01', batchId: 'b1' },
    { id: 's2', fullName: 'Diya Rao', rollNumber: '02', batchId: 'b1' },
  ];

  it('locks the batch (shared) before the test, grades from the roster, and replaces each student’s answers', async () => {
    const { service, tx } = build();
    tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce(locked());
    tx.student.findMany.mockResolvedValue(roster);
    tx.testQuestion.findMany.mockResolvedValue([paperRow('q1')]);
    await service.saveResults(teacher(), 't1', {
      results: [
        { studentId: 's1', present: true, answers: [{ testQuestionId: 'q1', response: 'B' }] },
        { studentId: 's2', present: false },
      ],
    });
    expect(sql(tx.$queryRaw.mock.calls[0])).toMatch(/FROM "Batch".*FOR SHARE/);
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(['b1', 'school-1']);
    expect(sql(tx.$queryRaw.mock.calls[1])).toMatch(/FROM "Test".*FOR UPDATE/);
    expect(tx.student.findMany.mock.calls[0][0].where).toEqual({ schoolId: 'school-1', OR: [{ batchId: 'b1', status: 'ACTIVE' }, { testResults: { some: { testId: 't1' } } }] });
    expect(tx.testResult.upsert.mock.calls[0][0]).toMatchObject({
      where: { testId_studentId: { testId: 't1', studentId: 's1' } },
      create: { schoolId: 'school-1', testId: 't1', studentId: 's1', present: true, marks: 4, correct: 1, incorrect: 0, unattempted: 0, gradedById: 'u-t', gradedBy: 'Ayush' },
    });
    expect(tx.testAnswer.deleteMany.mock.calls.map((c) => c[0].where)).toEqual([
      { resultId: 'r-s1', schoolId: 'school-1' },
      { resultId: 'r-s2', schoolId: 'school-1' },
    ]);
    expect(tx.testAnswer.createMany.mock.calls).toHaveLength(1);
    expect(tx.testAnswer.createMany.mock.calls[0][0].data).toEqual([{ schoolId: 'school-1', resultId: 'r-s1', testQuestionId: 'q1', response: 'B', outcome: 'CORRECT', marksAwarded: 4 }]);
  });

  it('refuses a cancelled test, one not started, a student twice, someone outside the roster, and names the student with a bad result', async () => {
    const { service, tx } = build();
    tx.student.findMany.mockResolvedValue(roster);
    const save = (results: object[]) => service.saveResults(admin, 't1', { results } as never);
    tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce(locked({ status: 'CANCELLED' }));
    await expect(save([{ studentId: 's1', present: false }])).rejects.toEqual(new ConflictException('This test is cancelled. Restore it before entering results.'));
    tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce(locked({ startsAt: new Date(Date.now() + 3_600_000) }));
    await expect(save([{ studentId: 's1', present: false }])).rejects.toThrow("This test hasn't started yet");
    tx.$queryRaw.mockResolvedValue(locked());
    await expect(save([{ studentId: 's1', present: false }, { studentId: 's1', present: false }])).rejects.toThrow('Each student can be graded only once');
    await expect(save([{ studentId: 'stranger', present: false }])).rejects.toThrow("Some students aren't in this test's batch");
    await expect(save([{ studentId: 's2', present: true, marks: 400 }])).rejects.toEqual(new BadRequestException('Diya Rao (02): Marks must be within 300'));
    expect(tx.testResult.upsert).not.toHaveBeenCalled();
  });

  it('an inactive teacher can’t grade; clearing a result is scoped to the test and school', async () => {
    const { service, prisma } = build();
    await expect(service.saveResults(teacher({ active: false }), 't1', { results: [] })).rejects.toBeInstanceOf(ForbiddenException);
    await service.clearResult(admin, 't1', 's1');
    expect(prisma.testResult.deleteMany).toHaveBeenCalledWith({ where: { testId: 't1', studentId: 's1', schoolId: 'school-1' } });
    prisma.testResult.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.clearResult(admin, 't1', 's9')).rejects.toEqual(new NotFoundException('No result for that student'));
  });

  it('the sheet: everyone on the roster, with percent, pass, rank and percentile for those present, and class stats', async () => {
    const { service, prisma } = build();
    prisma.student.findMany.mockResolvedValueOnce([...roster, { id: 's3', fullName: 'Kabir Jain', rollNumber: null, batchId: 'b2' }]);
    const result = (studentId: string, present: boolean, marks: number | null) => ({ studentId, present, marks, correct: null, incorrect: null, unattempted: null, remarks: null, gradedBy: 'Ayush', updatedAt: new Date('2026-10-18T06:00:00Z'), answers: [] });
    prisma.testResult.findMany.mockResolvedValueOnce([result('s1', true, 210), result('s3', false, null)]);
    const out = await service.results(admin, 't1');
    expect(out.rows.map((r) => [r.student.fullName, r.student.inBatch, r.result?.percent ?? null, r.result?.passed ?? null, r.result?.rank ?? null])).toEqual([
      ['Aarav Shah', true, 70, true, 1],
      ['Diya Rao', true, null, null, null],
      ['Kabir Jain', false, null, null, null],
    ]);
    expect(out.stats).toMatchObject({ students: 3, graded: 2, present: 1, absent: 1, averagePercent: 70, passPercent: 50 });
    expect(out.canGrade).toBe(true);
  });
});

describe('TestsService: admin overview', () => {
  it('KPIs: this week’s scheduled tests, the bank’s size, the average score (null without data) and ended tests still to grade', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-18T06:00:00Z') });
    try {
      const { service, prisma } = build();
      prisma.test.findMany
        .mockResolvedValueOnce([row({ id: 'w1' }), row({ id: 'w2', status: 'CANCELLED' })])
        .mockResolvedValueOnce([
          { id: 'e1', batchId: 'b1', startsAt: new Date('2026-10-17T04:30:00Z'), durationMinutes: 180, status: 'SCHEDULED', _count: { results: 1 } },
          { id: 'e2', batchId: 'b2', startsAt: new Date('2026-10-16T04:30:00Z'), durationMinutes: 180, status: 'SCHEDULED', _count: { results: 5 } },
          { id: 'running', batchId: 'b1', startsAt: new Date('2026-10-18T05:00:00Z'), durationMinutes: 180, status: 'SCHEDULED', _count: { results: 0 } },
        ])
        .mockResolvedValueOnce([
          { id: 'm2', title: 'Mock 2', batchId: 'b1', totalMarks: 300, startsAt: new Date('2026-10-15T04:30:00Z'), batch: { name: 'JEE A' }, results: [{ marks: 150 }, { marks: 210 }] },
          { id: 'm1', title: 'Mock 1', batchId: 'b1', totalMarks: 300, startsAt: new Date('2026-10-01T04:30:00Z'), batch: { name: 'JEE A' }, results: [{ marks: 30 }] },
        ]);
      prisma.question.count.mockResolvedValueOnce(42);
      prisma.$queryRaw.mockResolvedValueOnce([{ average: 61.5 }]);
      prisma.student.groupBy.mockResolvedValueOnce([
        { batchId: 'b1', _count: { _all: 3 } },
        { batchId: 'b2', _count: { _all: 5 } },
      ]);
      const out = await service.overview('school-1');
      expect(out.kpis).toEqual({ scheduledThisWeek: 1, totalQuestions: 42, averageScore: 61.5, pendingGrading: 1 });
      // The IST week runs Monday 12 Oct 00:00 IST (11 Oct 18:30 UTC) for seven days.
      expect(prisma.test.findMany.mock.calls[0][0].where).toEqual({ schoolId: 'school-1', startsAt: { gte: new Date('2026-10-11T18:30:00Z'), lt: new Date('2026-10-18T18:30:00Z') } });
      expect(out.week.from).toBe('2026-10-12');
      expect(prisma.student.groupBy.mock.calls[0][0].where).toEqual({ schoolId: 'school-1', status: 'ACTIVE', batchId: { in: ['b1', 'b2'] } });
      expect(out.batchAverages).toEqual([{ batch: { id: 'b1', name: 'JEE A' }, test: { id: 'm2', title: 'Mock 2', date: '2026-10-15' }, averagePercent: 60, students: 2 }]);
      expect(sql(prisma.$queryRaw.mock.calls[0])).toContain('r."present"');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a new school: nothing to report reads as no data', async () => {
    const { service } = build();
    const out = await service.overview('school-1');
    expect(out.kpis).toEqual({ scheduledThisWeek: 0, totalQuestions: 0, averageScore: null, pendingGrading: 0 });
    expect(out.batchAverages).toEqual([]);
  });
});

describe('TestsService: options', () => {
  it('teachers get their batches only, no faculty or program lists; defaults from one place', async () => {
    const { service, prisma } = build();
    const out = await service.options(teacher());
    expect(prisma.batch.findMany.mock.calls[0][0].where).toEqual({ schoolId: 'school-1', id: { in: ['b1'] } });
    expect(prisma.faculty.findMany).not.toHaveBeenCalled();
    expect(out).toMatchObject({ active: true, facultyId: 'fac-1', faculty: [], programs: [], defaults: { durationMinutes: 180, totalMarks: 300, marks: 4, negativeMarks: 0, source: 'Custom' } });
    expect((await service.options(admin)).facultyId).toBeNull();
    expect(prisma.faculty.findMany.mock.calls[0][0].where).toEqual({ schoolId: 'school-1' });
  });
});
