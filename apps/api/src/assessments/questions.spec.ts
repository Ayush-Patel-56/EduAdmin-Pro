import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { Prisma } from '../generated/prisma/client.js';
import { validate } from 'class-validator';
import type { TeacherScope } from '../academic/access.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { Actor } from './actor.js';
import { PaperDto, QuestionDto, ResultInput } from './assessments.dto.js';
import { QuestionsService, shapeAnswer } from './questions.service.js';

const scope = (over: Partial<TeacherScope> = {}): TeacherScope => ({ schoolId: 'school-1', facultyId: 'fac-1', batchIds: ['b1'], programIds: [], active: true, ...over });
const teacher = (over: Partial<TeacherScope> = {}): Actor => ({ kind: 'TEACHER', schoolId: 'school-1', userId: 'u-t', scope: scope(over) });
const admin: Actor = { kind: 'ADMIN', schoolId: 'school-1', userId: 'u-a' };
const dto = (over: Partial<QuestionDto> = {}) =>
  plainToInstance(QuestionDto, {
    subject: 'Physics',
    chapterId: null,
    topic: 'Thermodynamics',
    difficulty: 'MEDIUM',
    type: 'MCQ',
    text: 'What is the SI unit of temperature?',
    options: ['Celsius', 'Kelvin', 'Fahrenheit', 'Rankine'],
    correctAnswer: 'B',
    marks: 4,
    negativeMarks: 1,
    source: null,
    ...over,
  });

function build() {
  const prisma = {
    // Import: the bank's matching texts (lower case), and the per-school import lock.
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn((fn: (t: unknown) => unknown) => fn(prisma)),
    question: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'q1' }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    curriculumChapter: { findFirst: vi.fn().mockResolvedValue({ name: 'Heat', subject: 'Physics' }) },
    faculty: { findUniqueOrThrow: vi.fn().mockResolvedValue({ name: 'Ayush' }) },
    user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ fullName: 'Principal Mehta' }) },
  };
  return { prisma, service: new QuestionsService(prisma as unknown as PrismaService) };
}

describe('question answers by type', () => {
  it('MCQ: four options and an A-D answer (written as a letter, "Option B" or the option text)', () => {
    const opts = ['Celsius', 'Kelvin', 'Fahrenheit', 'Rankine'];
    expect(shapeAnswer('MCQ', opts, 'Option B')).toEqual({ options: opts, correctAnswer: 'B' });
    expect(shapeAnswer('MCQ', opts, 'kelvin')).toEqual({ options: opts, correctAnswer: 'B' });
    expect(shapeAnswer('MCQ', ['a', 'b', '', 'd'], 'A')).toBe('An MCQ needs all four options, A to D');
    expect(shapeAnswer('MCQ', opts, null)).toBe('Give the correct option (A, B, C or D)');
    expect(shapeAnswer('MCQ', opts, 'Z')).toBe('The correct answer must be A, B, C or D');
  });

  it('Integer and Numerical: a number (a unit after it is fine); Subjective: an optional model answer, no options', () => {
    expect(shapeAnswer('INTEGER', undefined, '42')).toEqual({ options: [], correctAnswer: '42' });
    expect(shapeAnswer('INTEGER', undefined, '4.5')).toBe('An integer question needs a whole-number answer');
    expect(shapeAnswer('NUMERICAL', ['x'], '9.81 m/s²')).toEqual({ options: [], correctAnswer: '9.81' });
    expect(shapeAnswer('NUMERICAL', undefined, 'about nine')).toBe('Give the correct answer as a number');
    expect(shapeAnswer('SUBJECTIVE', ['x'], '')).toEqual({ options: [], correctAnswer: null });
  });
});

describe('QuestionsService', () => {
  it('a teacher adds to their own bank, under their name; a chapter must be this school’s and of the subject', async () => {
    const { service, prisma } = build();
    await service.create(teacher(), dto({ chapterId: 'ch-1', text: '  What is   the SI unit\n\n\n of temperature? ' }));
    expect(prisma.curriculumChapter.findFirst.mock.calls[0][0].where).toEqual({ id: 'ch-1', schoolId: 'school-1' });
    expect(prisma.question.create.mock.calls[0][0].data).toEqual({
      schoolId: 'school-1',
      facultyId: 'fac-1',
      authorName: 'Ayush',
      createdById: 'u-t',
      subject: 'Physics',
      chapterId: 'ch-1',
      chapterName: 'Heat',
      topic: 'Thermodynamics',
      difficulty: 'MEDIUM',
      type: 'MCQ',
      text: 'What is the SI unit\n\nof temperature?',
      options: ['Celsius', 'Kelvin', 'Fahrenheit', 'Rankine'],
      correctAnswer: 'B',
      marks: 4,
      negativeMarks: 1,
      source: 'Custom',
    });
    prisma.curriculumChapter.findFirst.mockResolvedValueOnce(null);
    await expect(service.create(teacher(), dto({ chapterId: 'ch-x' }))).rejects.toEqual(new BadRequestException('Select a chapter of this school'));
    prisma.curriculumChapter.findFirst.mockResolvedValueOnce({ name: 'Algebra', subject: 'Mathematics' });
    await expect(service.create(teacher(), dto({ chapterId: 'ch-2' }))).rejects.toThrow('That chapter is a Mathematics chapter');
  });

  it('an admin’s question has no faculty and the admin’s name; an inactive teacher can’t add', async () => {
    const { service, prisma } = build();
    await service.create(admin, dto());
    expect(prisma.question.create.mock.calls[0][0].data).toMatchObject({ facultyId: null, authorName: 'Principal Mehta', createdById: 'u-a' });
    await expect(service.create(teacher({ active: false }), dto())).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.create(admin, dto({ options: ['a', 'b'] }))).rejects.toThrow('An MCQ needs all four options');
  });

  it('teachers list their own bank, or the whole school’s to build a paper; admins can pick an author; search is literal', async () => {
    const { service, prisma } = build();
    await service.list(teacher(), {});
    await service.list(teacher(), { bank: 'school', subject: 'Physics', q: '50%' });
    await service.list(admin, { author: 'admin', difficulty: 'HARD' });
    await service.list(admin, { author: '6f2c1d1e-0000-4000-8000-000000000001', page: 2, pageSize: 10 });
    const where = (i: number) => prisma.question.findMany.mock.calls[i][0].where;
    expect(where(0)).toEqual({ schoolId: 'school-1', facultyId: 'fac-1' });
    expect(where(1)).toMatchObject({ schoolId: 'school-1', subject: 'Physics' });
    expect(where(1).facultyId).toBeUndefined();
    expect(where(1).OR).toContainEqual({ text: { contains: '50\\%', mode: 'insensitive' } });
    expect(where(2)).toEqual({ schoolId: 'school-1', difficulty: 'HARD', facultyId: null });
    expect(where(3)).toEqual({ schoolId: 'school-1', facultyId: '6f2c1d1e-0000-4000-8000-000000000001' });
    expect(prisma.question.findMany.mock.calls[3][0]).toMatchObject({ skip: 10, take: 10 });
  });

  it('an inactive teacher has no access: no questions of their own or the school’s, and no writes', async () => {
    const { service, prisma } = build();
    await expect(service.list(teacher({ active: false }), {})).resolves.toEqual({ total: 0, page: 1, pageSize: 20, items: [] });
    await expect(service.list(teacher({ active: false }), { bank: 'school' })).resolves.toMatchObject({ total: 0, items: [] });
    expect(prisma.question.findMany).not.toHaveBeenCalled();
    await expect(service.update(teacher({ active: false }), 'q1', dto())).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.remove(teacher({ active: false }), 'q1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a teacher edits and deletes only their own questions; admins any; scoped in the write', async () => {
    const { service, prisma } = build();
    await service.update(teacher(), 'q1', dto());
    await service.update(admin, 'q1', dto());
    expect(prisma.question.updateMany.mock.calls[0][0].where).toEqual({ id: 'q1', schoolId: 'school-1', facultyId: 'fac-1' });
    expect(prisma.question.updateMany.mock.calls[1][0].where).toEqual({ id: 'q1', schoolId: 'school-1' });
    prisma.question.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.update(teacher(), 'q-x', dto())).rejects.toBeInstanceOf(NotFoundException);
    prisma.question.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.remove(teacher(), 'q-x')).rejects.toThrow('Question not found');
    expect(prisma.question.deleteMany.mock.calls[0][0].where).toEqual({ id: 'q-x', schoolId: 'school-1', facultyId: 'fac-1' });
  });
});

describe('QuestionsService: PDF upload', () => {
  const pdf = (body: string, header = 'Subject: Physics\nTopic: Thermodynamics\nDifficulty: Medium\nType: MCQ\nMarks: 4\nNegative Marks: -1\nSource: JEE PYQ') => `${header}\n\n${body}`;

  it('previews every question, adds them on confirm with the header’s subject, topic, marks and source', async () => {
    const { service, prisma } = build();
    const text = pdf('1. What is the SI unit of temperature?\n(A) Celsius\n(B) Kelvin\n(C) Fahrenheit\n(D) Rankine\n\nANSWER KEY\n1. B');
    await expect(service.import(teacher(), { text, dryRun: true })).resolves.toMatchObject({ applied: false, created: 1, skipped: 0 });
    expect(prisma.question.createMany).not.toHaveBeenCalled();
    await service.import(teacher(), { text, dryRun: false });
    expect(prisma.question.createMany.mock.calls[0][0].data).toEqual([
      {
        subject: 'Physics',
        chapterId: null,
        chapterName: null,
        topic: 'Thermodynamics',
        difficulty: 'MEDIUM',
        type: 'MCQ',
        text: 'What is the SI unit of temperature?',
        options: ['Celsius', 'Kelvin', 'Fahrenheit', 'Rankine'],
        correctAnswer: 'B',
        marks: 4,
        negativeMarks: 1,
        source: 'JEE PYQ',
        schoolId: 'school-1',
        facultyId: 'fac-1',
        authorName: 'Ayush',
        createdById: 'u-t',
      },
    ]);
  });

  it('reports each problem question, one already in the bank, and one repeated in the file', async () => {
    const { service, prisma } = build();
    prisma.$queryRaw.mockResolvedValueOnce([{ text: 'old question?' }]);
    const text = pdf(
      [
        '1. Old question?\n(A) a\n(B) b\n(C) c\n(D) d',
        '2. Only two options?\n(A) a\n(B) b',
        '3. No answer here?\n(A) a\n(B) b\n(C) c\n(D) d',
        '4. Fresh question?\n(A) a\n(B) b\n(C) c\n(D) d',
        '5. Fresh question?\n(A) a\n(B) b\n(C) c\n(D) d',
        'ANSWER KEY\n1. A\n2. A\n4. D\n5. D',
      ].join('\n\n'),
    );
    const out = await service.import(admin, { text, dryRun: true });
    expect(out.rows.map((r) => [r.row, r.action, r.errors[0] ?? ''])).toEqual([
      [1, 'error', 'Already in the question bank'],
      [2, 'error', 'An MCQ needs all four options, A to D'],
      [3, 'error', 'No answer for question 3 in the ANSWER KEY'],
      [4, 'create', ''],
      [5, 'error', 'Same as question 4 in this file'],
    ]);
    // Checked against the bank in any letter case, for this school and subject.
    const call = prisma.$queryRaw.mock.calls[0];
    expect((call[0] as string[]).join('?')).toMatch(/lower\("text"\) IN/);
    expect(call.slice(1, 3)).toEqual(['school-1', 'Physics']);
  });

  it('"speed OF light?" counts as already in the bank next to "Speed of light?"; confirming re-checks under a per-school lock', async () => {
    const { service, prisma } = build();
    const text = pdf('1. speed OF light?\n(A) a\n(B) b\n(C) c\n(D) d\n\n2. Fresh one?\n(A) a\n(B) b\n(C) c\n(D) d\n\nANSWER KEY\n1. A\n2. B');
    prisma.$queryRaw.mockResolvedValueOnce([{ text: 'speed of light?' }]);
    const preview = await service.import(admin, { text, dryRun: true });
    expect(preview.rows.map((r) => r.errors[0] ?? 'ok')).toEqual(['Already in the question bank', 'ok']);
    expect(prisma.$queryRaw.mock.calls[0].at(-1)).toEqual(Prisma.join(['speed of light?', 'fresh one?']));
    // Confirm: lock, then check again (another import may have added "Fresh one?" meanwhile), then add.
    prisma.$queryRaw.mockResolvedValueOnce([{ text: 'speed of light?' }, { text: 'fresh one?' }]);
    await expect(service.import(admin, { text, dryRun: false })).resolves.toMatchObject({ applied: true, created: 0, skipped: 2 });
    expect((prisma.$executeRaw.mock.calls[0][0] as string[]).join('?')).toContain('pg_advisory_xact_lock');
    expect(prisma.$executeRaw.mock.calls[0][1]).toBe('question-import:school-1');
    expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.$queryRaw.mock.invocationCallOrder[1]);
    expect(prisma.question.createMany).not.toHaveBeenCalled();
  });

  it('an ambiguous option split is refused with how to fix it; ready rows show the options as read', async () => {
    const { service } = build();
    const text = pdf('1. Choose one?\n(A) Both (B) and (C) (B) x (C) y (D) z\n\n2. Pick one?\n(A) a (B) b (C) c (D) d\n\nANSWER KEY\n1. A\n2. B');
    const out = await service.import(admin, { text, dryRun: true });
    expect(out.rows[0]).toMatchObject({ action: 'error', errors: ["Couldn't tell where the options start (an option mentions another letter). Put each option (A) to (D) on its own line."] });
    expect(out.rows[1]).toMatchObject({ action: 'create', options: ['a', 'b', 'c', 'd'] });
    const missingD = await service.import(admin, { text: pdf('1. Three only?\n(A) a\n(B) b\n(C) c\n\nANSWER KEY\n1. A'), dryRun: true });
    expect(missingD.rows[0].errors).toEqual(['An MCQ needs all four options, A to D']);
  });

  it('refuses a header it can’t use, naming each problem', async () => {
    const { service } = build();
    await expect(service.import(admin, { text: pdf('1. Q?', 'Subject: History\nTopic: X\nDifficulty: Tough\nType: Essay\nMarks: 0\nNegative Marks: -12'), dryRun: true })).rejects.toThrow(
      'The header block has problems: Subject must be one of Physics, Chemistry, Mathematics, Biology, Botany, Zoology; Difficulty must be Easy, Medium or Hard; Type must be MCQ, Numerical, Integer or Subjective; Marks must be a whole number from 1 to 100; Negative Marks must be 0 to -9.',
    );
    await expect(service.import(admin, { text: 'Some text without a header', dryRun: true })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('paper and result limits', () => {
  it('a paper has at most 200 questions; marks have at most 2 decimals', async () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `6f2c1d1e-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(await validate(plainToInstance(PaperDto, { questionIds: ids(200) }))).toEqual([]);
    expect((await validate(plainToInstance(PaperDto, { questionIds: ids(201) })))[0].constraints).toEqual({ arrayMaxSize: 'A paper can have at most 200 questions' });
    const result = (marks: number) => plainToInstance(ResultInput, { studentId: '6f2c1d1e-0000-4000-8000-000000000001', present: true, marks });
    expect(await validate(result(12.25))).toEqual([]);
    expect((await validate(result(12.255)))[0].property).toBe('marks');
  });
});

describe('QuestionDto', () => {
  it('clear messages for the required fields and the mark limits', async () => {
    const list = await validate(plainToInstance(QuestionDto, { subject: 'History', topic: ' ', difficulty: 'X', type: 'Y', text: '', marks: 0, negativeMarks: 12 }));
    expect(Object.fromEntries(list.map((e) => [e.property, Object.values(e.constraints ?? {})[0]]))).toEqual({
      subject: 'Select a subject',
      topic: 'Enter the concept or topic',
      difficulty: 'Select a difficulty',
      type: 'Select a question type',
      text: 'Enter the question text',
      marks: 'Marks must be 1 to 100',
      negativeMarks: 'Negative marks must be 0 to 9',
    });
  });
});
