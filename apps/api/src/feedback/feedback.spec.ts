import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { TeacherScope } from '../academic/access.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { FeedbackImportDto, FeedbackStatusDto, type FeedbackImportRow, SendFeedbackDto, TeacherFeedbackDto } from './feedback.dto.js';
import { categoriesMatching, isAllFaculty, parseCategory, parseDirection, sentimentKeywords } from './feedback-rules.js';
import { Prisma } from '../generated/prisma/client.js';
import { FEEDBACK_LIST_LIMIT, FeedbackService, importKeyOf, legacyImportKeyOf, legacyImportKeysOf } from './feedback.service.js';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const NOW = new Date('2026-10-18T05:00:00Z'); // 10:30 IST, 18 Oct
const scope = (over: Partial<TeacherScope> = {}): TeacherScope => ({ schoolId: 'school-1', facultyId: 'fac-1', batchIds: [], programIds: [], active: true, ...over });
const row = (over: Record<string, unknown> = {}) => ({
  id: 'fb1',
  schoolId: 'school-1',
  direction: 'MANAGEMENT_TO_TEACHER',
  senderName: 'Principal Mehta',
  senderFacultyId: null,
  createdById: 'admin-1',
  toAllFaculty: false,
  targetFacultyId: 'fac-1',
  targetName: 'Ayush',
  rating: 5,
  content: 'Excellent results in the last unit test.',
  subject: null,
  category: 'ACADEMICS',
  feedbackDate: d('2026-10-18'),
  status: 'SUBMITTED',
  statusChangedAt: null,
  statusChangedBy: null,
  source: 'APP',
  createdAt: new Date('2026-10-18T04:45:00Z'),
  updatedAt: new Date('2026-10-18T04:45:00Z'),
  ...over,
});
const FACULTY = [
  { id: 'fac-1', name: 'Ayush', email: 'ayush@school.example', employeeId: 'EMP-1', status: 'ACTIVE' },
  { id: 'fac-2', name: 'Mrs. Gupta', email: 'gupta@school.example', employeeId: 'EMP-2', status: 'ACTIVE' },
  { id: 'fac-3', name: 'R. Sharma', email: 'rs1@school.example', employeeId: null, status: 'ACTIVE' },
  { id: 'fac-4', name: 'R. Sharma', email: 'rs2@school.example', employeeId: null, status: 'ON_LEAVE' },
  { id: 'fac-5', name: 'Left Teacher', email: 'left@school.example', employeeId: 'EMP-5', status: 'INACTIVE' },
];
const p2003 = () => new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 't', meta: { constraint: 'Feedback_targetFacultyId_fkey' } });

function build() {
  const prisma = {
    feedback: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'fb-new' }),
      // Stores every row given (skipDuplicates finds none) unless a test says otherwise.
      createManyAndReturn: vi.fn(({ data }: { data: { importKey: string }[]; skipDuplicates?: boolean }) => Promise.resolve(data.map((r) => ({ importKey: r.importKey })))),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    faculty: {
      findFirst: vi.fn().mockResolvedValue({ id: 'fac-1', name: 'Ayush' }),
      findMany: vi.fn().mockResolvedValue(FACULTY),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ name: 'Ayush' }),
    },
    user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ fullName: 'Principal Mehta' }) },
    // The teacher row lock: the teacher(s) asked for, still there.
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  prisma.$queryRaw.mockImplementation((sql: TemplateStringsArray) =>
    Promise.resolve(sql.join('?').includes('ANY(') ? FACULTY.map(({ id, status }) => ({ id, status })) : [{ id: 'fac-1', name: 'Ayush' }]),
  );
  prisma.$transaction.mockImplementation((run: (tx: typeof prisma) => unknown) => run(prisma));
  return { prisma, service: new FeedbackService(prisma as unknown as PrismaService) };
}

beforeEach(() => vi.useFakeTimers({ now: NOW }));
afterEach(() => vi.useRealTimers());

describe('feedback rules', () => {
  it('reads direction and category the way people write them', () => {
    for (const t of ['Teacher -> Management', 'teacher → management', 'Teacher to Management', 'TEACHER_TO_MANAGEMENT']) expect(parseDirection(t)).toBe('TEACHER_TO_MANAGEMENT');
    for (const t of ['Management -> Teacher', 'management to teacher', 'MANAGEMENT_TO_TEACHER']) expect(parseDirection(t)).toBe('MANAGEMENT_TO_TEACHER');
    expect(parseDirection('Parent -> Teacher')).toBeNull();
    expect(parseCategory('Teaching Quality')).toBe('TEACHING_QUALITY');
    expect(parseCategory('teaching_quality')).toBe('TEACHING_QUALITY');
    expect(parseCategory('')).toBe('GENERAL');
    expect(parseCategory('Appraisal')).toBeNull();
    expect(isAllFaculty('All Faculty')).toBe(true);
    expect(isAllFaculty('Staff')).toBe(true);
    expect(isAllFaculty('')).toBe(true);
    expect(isAllFaculty('Alice Teacher')).toBe(false);
    expect(categoriesMatching('acad')).toEqual(['ACADEMICS']);
    expect(categoriesMatching('a')).toEqual([]);
  });

  it('keywords come only from what was written: two entries at least, stopwords left out, phrases preferred', () => {
    expect(sentimentKeywords([])).toEqual([]);
    expect(sentimentKeywords([{ content: 'hello', rating: 5 }, { content: 'hi', rating: 5 }])).toEqual([]);
    const keywords = sentimentKeywords([
      { content: 'Doubt clearing sessions are very helpful', rating: 5 },
      { content: 'More doubt clearing please, and detailed notes', rating: 4 },
      { content: 'Doubt clearing on Saturdays helped a lot', rating: 5 },
      { content: 'The pace of teaching is too fast; detailed notes would help', rating: 2 },
      { content: 'Transport delays again', rating: 1 },
    ]);
    expect(keywords.slice(0, 2)).toEqual([
      { phrase: 'Doubt Clearing', mentions: 3, averageRating: 4.7 },
      { phrase: 'Detailed Notes', mentions: 2, averageRating: 3 },
    ]);
    // "doubt" and "clearing" alone add nothing to "Doubt Clearing"; one-off words never show.
    expect(keywords.map((k) => k.phrase)).not.toContain('Doubt');
    expect(keywords.map((k) => k.phrase)).not.toContain('Transport');
  });

  it('a topic only one entry mentions is never a keyword; contractions are not topics; any script counts', () => {
    expect(sentimentKeywords([{ content: 'Transport delays again', rating: 1 }, { content: 'Library hours', rating: 4 }])).toEqual([]);
    expect(sentimentKeywords([{ content: "It's fine", rating: 3 }, { content: 'It\u2019s okay, it’s fine', rating: 3 }]).map((k) => k.phrase)).toEqual(['Fine']);
    expect(sentimentKeywords([{ content: 'पढ़ाई अच्छी है', rating: 5 }, { content: 'पढ़ाई बहुत अच्छी', rating: 5 }]).map((k) => k.phrase)).toEqual(['अच्छी', 'पढ़ाई']);
  });
});

describe('FeedbackService: admin', () => {
  it('the Pending view: newest first, within the school; KPIs and the rating chart from every entry', async () => {
    const { service, prisma } = build();
    prisma.feedback.count.mockResolvedValueOnce(1).mockResolvedValueOnce(4);
    prisma.feedback.findMany.mockResolvedValueOnce([row(), row({ id: 'fb2', direction: 'TEACHER_TO_MANAGEMENT', senderFacultyId: 'fac-2', senderName: 'Mrs. Gupta', targetFacultyId: null, targetName: null, rating: 3 })]);
    prisma.feedback.groupBy
      .mockResolvedValueOnce([{ rating: 5, _count: { _all: 3 } }, { rating: 3, _count: { _all: 1 } }])
      .mockResolvedValueOnce([{ status: 'SUBMITTED', _count: { _all: 2 } }, { status: 'REVIEWED', _count: { _all: 1 } }, { status: 'ACTIONED', _count: { _all: 1 } }, { status: 'DISMISSED', _count: { _all: 2 } }]);
    const out = await service.adminList('school-1', {});
    expect(out.kpis).toEqual({ thisMonth: 4, averageRating: 4.5, pending: 3, actioned: 1 });
    expect(out.counts).toEqual({ pending: 3, closed: 3 });
    expect(out.ratingDistribution).toEqual([
      { stars: 5, count: 3 },
      { stars: 4, count: 0 },
      { stars: 3, count: 1 },
      { stars: 2, count: 0 },
      { stars: 1, count: 0 },
    ]);
    const list = prisma.feedback.findMany.mock.calls[0][0];
    expect(list.where).toEqual({ schoolId: 'school-1', status: { in: ['SUBMITTED', 'REVIEWED'] } });
    expect(list.take).toBe(FEEDBACK_LIST_LIMIT);
    // This month counts by the day it was given (1 Oct onwards, India).
    expect(prisma.feedback.count.mock.calls[1][0].where).toEqual({ schoolId: 'school-1', feedbackDate: { gte: d('2026-10-01') } });
    // Keywords read the last 30 days, leaving out dismissed entries.
    expect(prisma.feedback.findMany.mock.calls[1][0].where).toEqual({ schoolId: 'school-1', status: { not: 'DISMISSED' }, feedbackDate: { gte: d('2026-09-19') } });
    expect(out.items[0]).toMatchObject({ id: 'fb1', target: { all: false, name: 'Ayush' }, sender: { name: 'Principal Mehta', facultyId: null }, date: '2026-10-18' });
    expect(out.items[1].target).toBeNull();
  });

  it('the direction tab scopes the KPIs and charts; dismissed entries count in neither the rating nor the keywords', async () => {
    const { service, prisma } = build();
    await service.adminList('school-1', { direction: 'TEACHER_TO_MANAGEMENT' });
    const scope = { schoolId: 'school-1', direction: 'TEACHER_TO_MANAGEMENT' };
    expect(prisma.feedback.count.mock.calls[1][0].where).toEqual({ ...scope, feedbackDate: { gte: d('2026-10-01') } });
    expect(prisma.feedback.groupBy.mock.calls[0][0].where).toEqual({ ...scope, status: { not: 'DISMISSED' } });
    expect(prisma.feedback.groupBy.mock.calls[1][0].where).toEqual(scope);
    expect(prisma.feedback.findMany.mock.calls[1][0].where).toEqual({ ...scope, status: { not: 'DISMISSED' }, feedbackDate: { gte: d('2026-09-19') } });
  });

  it('no feedback: average rating is empty rather than 0', async () => {
    const { service } = build();
    const out = await service.adminList('school-1', {});
    expect(out.kpis.averageRating).toBeNull();
    expect(out.keywords).toEqual([]);
  });

  it('the Actioned view, one status, a direction, and a search taken literally across fields', async () => {
    const { service, prisma } = build();
    await service.adminList('school-1', { view: 'closed' });
    await service.adminList('school-1', { view: 'closed', status: 'ACTIONED', direction: 'TEACHER_TO_MANAGEMENT', q: 'acad 50%' });
    await service.adminList('school-1', { q: 'Academics' });
    const where = (n: number) => prisma.feedback.findMany.mock.calls[n * 2][0].where;
    expect(where(0).status).toEqual({ in: ['ACTIONED', 'DISMISSED'] });
    expect(where(1)).toMatchObject({ status: 'ACTIONED', direction: 'TEACHER_TO_MANAGEMENT' });
    expect(where(1).OR).toContainEqual({ content: { contains: 'acad 50\\%', mode: 'insensitive' } });
    expect(where(2).OR).toContainEqual({ category: { in: ['ACADEMICS'] } });
    expect(where(2).OR).toContainEqual({ targetName: { contains: 'Academics', mode: 'insensitive' } });
  });

  it('sends to all faculty, or to one active teacher of this school (row locked for the insert), in the admin’s name and today’s date', async () => {
    const { service, prisma } = build();
    await service.send('school-1', 'admin-1', plainToInstance(SendFeedbackDto, { target: 'ALL', content: 'Great term', rating: 5, category: 'GENERAL' }));
    expect(prisma.feedback.create.mock.calls[0][0].data).toEqual({
      schoolId: 'school-1',
      direction: 'MANAGEMENT_TO_TEACHER',
      senderName: 'Principal Mehta',
      createdById: 'admin-1',
      toAllFaculty: true,
      targetFacultyId: null,
      targetName: null,
      rating: 5,
      content: 'Great term',
      category: 'GENERAL',
      feedbackDate: d('2026-10-18'),
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    await service.send('school-1', 'admin-1', plainToInstance(SendFeedbackDto, { target: 'fac-1', content: 'Thanks', rating: 4, category: 'ACADEMICS' }));
    const [sql, ...values] = prisma.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(sql.join('?')).toMatch(/FROM "Faculty" WHERE "id" = \? AND "schoolId" = \? AND "status" <> 'INACTIVE' FOR SHARE/);
    expect(values).toEqual(['fac-1', 'school-1']);
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.feedback.create.mock.invocationCallOrder[1]);
    expect(prisma.feedback.create.mock.calls[1][0].data).toMatchObject({ toAllFaculty: false, targetFacultyId: 'fac-1', targetName: 'Ayush' });
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await expect(service.send('school-1', 'admin-1', plainToInstance(SendFeedbackDto, { target: 'fac-x', content: 'x', rating: 4, category: 'ACADEMICS' }))).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.feedback.create).toHaveBeenCalledTimes(2);
  });

  it('a teacher removed at the same moment is a 400, not a foreign-key 500', async () => {
    const { service, prisma } = build();
    prisma.feedback.create.mockRejectedValueOnce(p2003());
    await expect(service.send('school-1', 'admin-1', plainToInstance(SendFeedbackDto, { target: 'fac-1', content: 'x', rating: 4, category: 'ACADEMICS' }))).rejects.toEqual(
      new BadRequestException('That teacher was just removed from the school. Refresh and pick again.'),
    );
  });

  it('moves an entry through the workflow, recording who (name and id) and when; scoped in the write', async () => {
    const { service, prisma } = build();
    await expect(service.setStatus('school-1', 'admin-1', 'fb1', { status: 'ACTIONED' })).resolves.toEqual({ id: 'fb1', status: 'ACTIONED' });
    expect(prisma.feedback.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'fb1', schoolId: 'school-1' },
      data: { status: 'ACTIONED', statusChangedAt: NOW, statusChangedBy: 'Principal Mehta', statusChangedById: 'admin-1' },
    });
    prisma.feedback.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.setStatus('school-1', 'admin-1', 'fb-x', { status: 'DISMISSED' })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('FeedbackService: faculty', () => {
  it('From Management: to all faculty or to them, not dismissed; Sent: their own', async () => {
    const { service, prisma } = build();
    prisma.feedback.findMany.mockResolvedValueOnce([row()]).mockResolvedValueOnce([]);
    const out = await service.teacherFeedback(scope());
    expect(out.received).toHaveLength(1);
    expect(prisma.feedback.findMany.mock.calls[0][0].where).toEqual({
      schoolId: 'school-1',
      direction: 'MANAGEMENT_TO_TEACHER',
      status: { not: 'DISMISSED' },
      OR: [{ toAllFaculty: true }, { targetFacultyId: 'fac-1' }],
    });
    expect(prisma.feedback.findMany.mock.calls[1][0].where).toEqual({ schoolId: 'school-1', direction: 'TEACHER_TO_MANAGEMENT', senderFacultyId: 'fac-1' });
  });

  it('someone who has left keeps their sent list but receives nothing new; without a profile, nothing', async () => {
    const { service, prisma } = build();
    const out = await service.teacherFeedback(scope({ active: false }));
    expect(out.received).toEqual([]);
    expect(prisma.feedback.findMany).toHaveBeenCalledTimes(1);
    await expect(service.teacherFeedback(scope({ facultyId: null }))).resolves.toEqual({ received: [], sent: [] });
  });

  it('sends to management under the teacher’s name; only active faculty can', async () => {
    const { service, prisma } = build();
    await service.teacherSend(scope(), 'user-1', plainToInstance(TeacherFeedbackDto, { content: 'New smartboard in Lab 3 works great.', rating: 5 }));
    expect(prisma.feedback.create.mock.calls[0][0].data).toEqual({
      schoolId: 'school-1',
      direction: 'TEACHER_TO_MANAGEMENT',
      senderName: 'Ayush',
      senderFacultyId: 'fac-1',
      createdById: 'user-1',
      rating: 5,
      content: 'New smartboard in Lab 3 works great.',
      feedbackDate: d('2026-10-18'),
    });
    await expect(service.teacherSend(scope({ active: false }), 'user-1', plainToInstance(TeacherFeedbackDto, { content: 'x', rating: 5 }))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('FeedbackService: import', () => {
  const sheet = (rows: FeedbackImportRow[], dryRun = true) => ({ rows, dryRun });
  const rows: FeedbackImportRow[] = [
    { type: 'Management -> Teacher', sender: 'Principal Mehta', rating: '5', content: 'Excellent results in the last unit test.', subject: 'Unit test', target: 'ayush@school.example', category: 'Academics', date: '2026-10-17' },
    { type: 'Teacher -> Management', sender: 'Mrs. Gupta', rating: '4', content: 'New smartboard in Lab 3 works great.', target: 'Staff', category: 'Administration' },
    { type: 'Management -> Teacher', rating: '3', content: 'Keep the staff room tidy.', target: 'All Faculty' },
  ];

  it('checks every row, and creates only on confirm, with each row’s key', async () => {
    const { service, prisma } = build();
    const preview = await service.import('school-1', 'admin-1', sheet(rows));
    expect(preview).toMatchObject({ applied: false, created: 3, skipped: 0 });
    expect(preview.rows.map((r) => r.label)).toEqual([
      'Management -> Teacher: Principal Mehta to Ayush',
      'Teacher -> Management: Mrs. Gupta',
      'Management -> Teacher: Principal Mehta to All Faculty',
    ]);
    expect(prisma.feedback.createManyAndReturn).not.toHaveBeenCalled();
    // Faculty are looked up in this school only: another school's teacher never matches.
    expect(prisma.faculty.findMany.mock.calls[0][0].where).toEqual({ schoolId: 'school-1' });
    await expect(service.import('school-1', 'admin-1', sheet(rows, false))).resolves.toMatchObject({ applied: true, created: 3, skipped: 0 });
    const call = prisma.feedback.createManyAndReturn.mock.calls[0][0];
    expect(call.skipDuplicates).toBe(true);
    expect(call.data[0]).toEqual({
      schoolId: 'school-1',
      direction: 'MANAGEMENT_TO_TEACHER',
      senderName: 'Principal Mehta',
      senderFacultyId: null,
      createdById: 'admin-1',
      toAllFaculty: false,
      targetFacultyId: 'fac-1',
      targetName: 'Ayush',
      rating: 5,
      content: 'Excellent results in the last unit test.',
      subject: 'Unit test',
      category: 'ACADEMICS',
      feedbackDate: d('2026-10-17'),
      source: 'IMPORT',
      importKey: importKeyOf(rows[0], 'MANAGEMENT_TO_TEACHER', d('2026-10-17'), { senderFacultyId: null, toAllFaculty: false, targetFacultyId: 'fac-1' }),
    });
    // The legacy key is only for matching earlier uploads; it isn't stored.
    expect(call.data[0]).not.toHaveProperty('legacyKey');
    expect(call.data[1]).toMatchObject({ direction: 'TEACHER_TO_MANAGEMENT', senderName: 'Mrs. Gupta', senderFacultyId: 'fac-2', toAllFaculty: false, targetName: null, feedbackDate: d('2026-10-18') });
    expect(call.data[2]).toMatchObject({ senderName: 'Principal Mehta', toAllFaculty: true, category: 'GENERAL' });
    // The teachers it names are share-locked, sorted, in one statement, before the insert.
    const lock = prisma.$queryRaw.mock.calls.find((c) => (c[0] as string[]).join('?').includes('ANY('))!;
    expect((lock[0] as string[]).join('?')).toMatch(/FROM "Faculty" WHERE "schoolId" = \? AND "id" = ANY\(\?::text\[\]\) ORDER BY "id" FOR SHARE/);
    expect(lock.slice(1)).toEqual(['school-1', ['fac-1', 'fac-2']]);
  });

  it('the key: a teacher by who they resolve to (email or name alike); other cells as written, blanks kept blank; direction counts', () => {
    const toAyush = { senderFacultyId: null, toAllFaculty: false, targetFacultyId: 'fac-1' };
    const row = { type: 'Management -> Teacher', rating: '4', content: 'Well  done', target: 'EMP-1' };
    const key = importKeyOf(row, 'MANAGEMENT_TO_TEACHER', null, toAyush);
    // The same teacher written another way, spacing and case: the same row.
    expect(importKeyOf({ ...row, content: ' well done ', target: 'Ayush' }, 'MANAGEMENT_TO_TEACHER', null, toAyush)).toBe(key);
    // A management sender stays as written (blank isn't the importing admin).
    expect(importKeyOf({ ...row, sender: 'Admin C' }, 'MANAGEMENT_TO_TEACHER', null, toAyush)).not.toBe(key);
    expect(importKeyOf({ ...row, date: '17-10-2026' }, 'MANAGEMENT_TO_TEACHER', d('2026-10-17'), toAyush)).toBe(importKeyOf({ ...row, date: '2026-10-17' }, 'MANAGEMENT_TO_TEACHER', d('2026-10-17'), toAyush));
    expect(importKeyOf(row, 'MANAGEMENT_TO_TEACHER', d('2026-10-18'), toAyush)).not.toBe(key);
    // "All Faculty", "Staff" and blank are one target.
    const all = { senderFacultyId: null, toAllFaculty: true, targetFacultyId: null };
    expect(importKeyOf({ ...row, target: 'Staff' }, 'MANAGEMENT_TO_TEACHER', null, all)).toBe(importKeyOf({ ...row, target: '' }, 'MANAGEMENT_TO_TEACHER', null, all));
    // A teacher sender by id: t1@x.test and Ravi Kumar (the same teacher) are one row.
    const fromRavi = { senderFacultyId: 'fac-9', toAllFaculty: false, targetFacultyId: null };
    const t = { type: 'Teacher -> Management', rating: '4', content: 'Lab needs repairs' };
    expect(importKeyOf({ ...t, sender: 't1@x.test' }, 'TEACHER_TO_MANAGEMENT', null, fromRavi)).toBe(importKeyOf({ ...t, sender: 'Ravi Kumar' }, 'TEACHER_TO_MANAGEMENT', null, fromRavi));
    // The two directions never share a key, for otherwise identical cells.
    const same = { type: 'x', sender: 'S', target: 'T', rating: '4', content: 'Same words' };
    const none = { senderFacultyId: null, toAllFaculty: false, targetFacultyId: null };
    expect(importKeyOf(same, 'TEACHER_TO_MANAGEMENT', null, none)).not.toBe(importKeyOf(same, 'MANAGEMENT_TO_TEACHER', null, none));
    expect(legacyImportKeyOf(same, 'TEACHER_TO_MANAGEMENT', null)).not.toBe(legacyImportKeyOf(same, 'MANAGEMENT_TO_TEACHER', null));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the old key (before teachers were keyed by id) is exactly the hash main stored: pinned digests (#41)', () => {
    // Expected values computed with main's importKeyOf at 4025095 (sha-256 of the JSON cell array) and checked independently.
    const t = { type: 'Teacher -> Management', sender: ' Ravi  Kumar ', target: 'Principal', rating: '4', content: 'Lab 3 needs  new benches.', subject: 'Infrastructure', category: 'Administration' };
    expect(legacyImportKeyOf(t, 'TEACHER_TO_MANAGEMENT', d('2026-10-17'))).toBe('0d4bfa72b447bdc52bd0ee8998aa13aabb7d0a3e23cd26791273c8af52c87613');
    const m = { type: 'Management -> Teacher', sender: 'Principal Mehta', target: 'Staff', rating: '5', content: 'Well done', category: 'Academics' };
    expect(legacyImportKeyOf(m, 'MANAGEMENT_TO_TEACHER', null)).toBe('159bafdd26e96efe57e3ff8d2b2ed5cc453e710070acd9e17b633fd195f700da');
  });

  it('a row imported before #39 is found again with the teacher written another way: name, email or employee ID (#41)', async () => {
    const { service, prisma } = build();
    const before = { type: 'Teacher -> Management', sender: 'Mrs. Gupta', rating: '4', content: 'Projector in Lab 2 flickers.', category: 'Administration', date: '2026-10-10' };
    const toAyush = { type: 'Management -> Teacher', sender: 'Principal Mehta', rating: '5', content: 'Great unit test.', target: 'Ayush', category: 'Academics', date: '2026-10-10' };
    const toAll = { type: 'Management -> Teacher', sender: 'Principal Mehta', rating: '3', content: 'Keep the staff room tidy.', target: 'All Faculty', category: 'Administration', date: '2026-10-10' };
    // Stored under the old key, with the teacher (or all faculty) as written then.
    const old = [legacyImportKeyOf(before, 'TEACHER_TO_MANAGEMENT', d('2026-10-10')), legacyImportKeyOf(toAyush, 'MANAGEMENT_TO_TEACHER', d('2026-10-10')), legacyImportKeyOf(toAll, 'MANAGEMENT_TO_TEACHER', d('2026-10-10'))];
    prisma.feedback.findMany.mockImplementation(({ where }: { where: { importKey: { in: string[] } } }) => Promise.resolve(where.importKey.in.filter((k) => old.includes(k)).map((importKey) => ({ importKey }))));
    const preview = await service.import(
      'school-1',
      'admin-1',
      sheet([
        { ...before, sender: 'gupta@school.example' },
        { ...toAyush, target: 'EMP-1', date: '10-10-2026' },
        { ...toAll, target: 'Staff' },
        // A different teacher is a different row.
        { ...before, sender: 'Ayush' },
      ]),
    );
    const already = ['Already imported (an earlier upload has this row)'];
    expect(preview.rows.map((r) => r.errors)).toEqual([already, already, already, []]);
    // The old key itself, then each way of writing the teacher; no duplicates.
    const teacher = { name: 'Mrs. Gupta', email: 'gupta@school.example', employeeId: 'EMP-2' };
    const keys = legacyImportKeysOf({ ...before, sender: 'EMP-2' }, 'TEACHER_TO_MANAGEMENT', d('2026-10-10'), { teacher, toAllFaculty: false });
    expect(keys).toHaveLength(3);
    expect(keys).toContain(old[0]);
    expect(legacyImportKeysOf(before, 'MANAGEMENT_TO_TEACHER', null, { teacher: null, toAllFaculty: false })).toEqual([legacyImportKeyOf(before, 'MANAGEMENT_TO_TEACHER', null)]);
  });

  it('a teacher written with doubled inner spaces or another letter case still matches (#41)', async () => {
    const { service, prisma } = build();
    const preview = await service.import(
      'school-1',
      'admin-1',
      sheet([
        { type: 'Teacher -> Management', sender: ' MRS.   gupta ', rating: '4', content: 'Fine.', category: 'Administration' },
        { type: 'Management -> Teacher', rating: '4', content: 'Fine.', target: '  AYUSH ', category: 'Academics' },
        { type: 'Management -> Teacher', rating: '4', content: 'Fine.', target: ' GUPTA@school.example ', category: 'Academics' },
      ]),
    );
    expect(preview.rows.map((r) => [r.action, r.errors])).toEqual([['create', []], ['create', []], ['create', []]]);
    expect(preview.rows[0].label).toContain('Mrs. Gupta');
    // A profile saved with doubled spaces matches a sheet that writes them once.
    prisma.faculty.findMany.mockResolvedValueOnce([{ id: 'fac-7', name: 'Ravi  Kumar', email: null, employeeId: null, status: 'ACTIVE' }]);
    const spaced = await service.import('school-1', 'admin-1', sheet([{ type: 'Teacher -> Management', sender: 'Ravi Kumar', rating: '4', content: 'Fine.', category: 'Administration' }]));
    expect(spaced.rows[0].action).toBe('create');
  });

  it('refuses what it cannot place, with a reason per row', async () => {
    const { service } = build();
    const preview = await service.import('school-1', 'admin-1', sheet([
      { type: 'Parent -> Teacher', rating: '5', content: 'x' },
      { type: 'Teacher -> Management', sender: 'Nobody', rating: '6', content: '  ' },
      { type: 'Teacher -> Management', sender: 'R. Sharma', rating: '4', content: 'ok' },
      { type: 'Management -> Teacher', rating: '4', content: 'ok', target: 'Alice Teacher', category: 'Appraisal' },
      { type: 'Management -> Teacher', rating: '4.5', content: 'ok', date: '2026-10-19' },
    ]));
    expect(preview.created).toBe(0);
    expect(preview.rows.map((r) => r.errors)).toEqual([
      ['Type must be Teacher -> Management or Management -> Teacher'],
      ['Rating must be a whole number from 1 to 5', 'Content is required', 'No faculty member matches sender Nobody'],
      ['Sender R. Sharma matches more than one faculty member; use their email'],
      ['Category must be one of Academics, Discipline, Punctuality, Teaching Quality, Administration, General', 'No faculty member matches target Alice Teacher'],
      ['Rating must be a whole number from 1 to 5', "Date can't be in the future"],
    ]);
  });

  it('an inactive teacher can be a sender (an older sheet) but not a target, as Send refuses them too', async () => {
    const { service } = build();
    const preview = await service.import('school-1', 'admin-1', sheet([
      { type: 'Teacher -> Management', sender: 'left@school.example', rating: '4', content: 'From before I left' },
      { type: 'Management -> Teacher', rating: '4', content: 'Thanks', target: 'EMP-5' },
      { type: 'Management -> Teacher', rating: '4', content: 'Thanks', target: 'rs2@school.example' },
    ]));
    expect(preview.rows.map((r) => r.action)).toEqual(['create', 'error', 'create']);
    expect(preview.rows[1].errors).toEqual(["Left Teacher is no longer active in this school, so feedback can't be sent to them"]);
  });

  it('a row already uploaded, or twice in this file, is skipped with the reason', async () => {
    const { service, prisma } = build();
    const again = { type: 'Teacher -> Management', sender: 'gupta@school.example', rating: '5', content: 'New smartboard works great.', date: '2026-10-18' };
    const twice = { type: 'Management -> Teacher', rating: '4', content: 'Well done', target: 'EMP-1' };
    // Imported before teachers were keyed by id: found by its old key.
    prisma.feedback.findMany.mockResolvedValueOnce([{ importKey: legacyImportKeyOf(again, 'TEACHER_TO_MANAGEMENT', d('2026-10-18')) }]);
    const preview = await service.import('school-1', 'admin-1', sheet([again, twice, { ...twice, target: 'ayush@school.example' }]));
    expect(preview.rows.map((r) => r.action)).toEqual(['error', 'create', 'error']);
    expect(preview.rows[0].errors).toEqual(['Already imported (an earlier upload has this row)']);
    // EMP-1 and ayush@school.example are the same teacher: the same row.
    expect(preview.rows[2].errors).toEqual(['Appears twice in this file (same as row 3)']);
    const keys = prisma.feedback.findMany.mock.calls[0][0].where.importKey.in;
    expect(keys).toContain(importKeyOf(again, 'TEACHER_TO_MANAGEMENT', d('2026-10-18'), { senderFacultyId: 'fac-2', toAllFaculty: false, targetFacultyId: null }));
    expect(keys).toContain(legacyImportKeyOf(again, 'TEACHER_TO_MANAGEMENT', d('2026-10-18')));
    // Each new row comes back with its key (for the next chunk); errors don't.
    expect(preview.rows[1].key).toMatch(/^[0-9a-f]{64}$/);
    expect(preview.rows[0].key).toBeUndefined();
  });

  it('a large sheet in chunks: rows numbered from the chunk’s first sheet row, and a repeat of an earlier chunk is still "twice in this file"', async () => {
    const { service } = build();
    const first = await service.import('school-1', 'admin-1', sheet(rows));
    const priorKeys = first.rows.flatMap((r) => (r.key ? [{ key: r.key, row: r.row }] : []));
    const next = await service.import('school-1', 'admin-1', { rows: [rows[1], { type: 'Management -> Teacher', rating: '3', content: 'Something new', target: 'All Faculty' }], dryRun: true, firstRow: 202, priorKeys });
    expect(next.rows.map((r) => [r.row, r.action, r.errors[0] ?? ''])).toEqual([
      [202, 'error', 'Appears twice in this file (same as row 3)'],
      [203, 'create', ''],
    ]);
  });

  it('chunk fields: first row from 2, prior keys are sha-256 hex', async () => {
    const msgs = async (plain: object) => (await validate(plainToInstance(FeedbackImportDto, { rows: [], dryRun: true, ...plain }))).map((e) => e.property);
    expect(await msgs({ firstRow: 202, priorKeys: [{ key: 'a'.repeat(64), row: 3 }] })).toEqual([]);
    expect(await msgs({ firstRow: 1 })).toEqual(['firstRow']);
    expect(await msgs({ priorKeys: [{ key: 'nope', row: 3 }] })).toEqual(['priorKeys']);
  });

  it('two confirms at once: rows the other upload stored are reported as skipped, never stored twice', async () => {
    const { service, prisma } = build();
    // The database kept only the first row of ours (the other upload had stored the rest).
    prisma.feedback.createManyAndReturn.mockImplementationOnce(({ data }: { data: { importKey: string }[] }) => Promise.resolve([{ importKey: data[0].importKey }]));
    const out = await service.import('school-1', 'admin-1', sheet(rows, false));
    expect(out).toMatchObject({ applied: true, created: 1, skipped: 2 });
    expect(out.rows.map((r) => r.action)).toEqual(['create', 'error', 'error']);
    expect(out.rows[1].errors).toEqual(['Already imported (by an upload that finished at the same time)']);
  });

  it('a teacher removed or deactivated since the check stops the import (400), nothing stored', async () => {
    const { service, prisma } = build();
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'fac-2', status: 'ACTIVE' }]); // Ayush (the target) is gone
    await expect(service.import('school-1', 'admin-1', sheet(rows, false))).rejects.toThrow('Ayush was removed or deactivated while the file was being checked. Nothing was imported');
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'fac-1', status: 'INACTIVE' }, { id: 'fac-2', status: 'ACTIVE' }]);
    await expect(service.import('school-1', 'admin-1', sheet(rows, false))).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.feedback.createManyAndReturn).not.toHaveBeenCalled();
  });
});

describe('feedback DTOs', () => {
  const first = async (cls: typeof SendFeedbackDto | typeof TeacherFeedbackDto, plain: object) =>
    Object.fromEntries((await validate(plainToInstance(cls, plain))).map((e) => [e.property, Object.values(e.constraints ?? {})[0]]));

  it('clear messages for a missing target, text, rating or category', async () => {
    expect(await first(SendFeedbackDto, { target: 'someone', content: ' ', rating: 0, category: 'X' })).toEqual({
      target: 'Select a faculty member, or All Faculty',
      content: 'Write the feedback',
      rating: 'Give a rating of 1 to 5 stars',
      category: 'Select a category',
    });
    expect(await first(TeacherFeedbackDto, { content: 'Good', rating: '4' })).toEqual({});
    expect(await first(TeacherFeedbackDto, { content: 'Good', rating: 4.5 })).toEqual({ rating: 'Give a rating of 1 to 5 stars' });
    expect(await first(TeacherFeedbackDto, { content: 'Good', rating: 6 })).toEqual({ rating: 'Give a rating of 1 to 5 stars' });
  });

  it('an entry can be moved to Reviewed, Actioned or Dismissed, never back to Submitted', async () => {
    const errors = async (status: string) => (await validate(plainToInstance(FeedbackStatusDto, { status }))).map((e) => Object.values(e.constraints ?? {})[0]);
    for (const ok of ['REVIEWED', 'ACTIONED', 'DISMISSED']) expect(await errors(ok)).toEqual([]);
    expect(await errors('SUBMITTED')).toEqual(['Status must be Reviewed, Actioned or Dismissed']);
  });
});
