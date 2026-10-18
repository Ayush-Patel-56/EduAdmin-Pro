import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { TeacherScope } from '../academic/access.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { type FeedbackImportRow, SendFeedbackDto, TeacherFeedbackDto } from './feedback.dto.js';
import { categoriesMatching, isAllFaculty, parseCategory, parseDirection, sentimentKeywords } from './feedback-rules.js';
import { FEEDBACK_LIST_LIMIT, FeedbackService } from './feedback.service.js';

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
  { id: 'fac-1', name: 'Ayush', email: 'ayush@school.example', employeeId: 'EMP-1' },
  { id: 'fac-2', name: 'Mrs. Gupta', email: 'gupta@school.example', employeeId: 'EMP-2' },
  { id: 'fac-3', name: 'R. Sharma', email: 'rs1@school.example', employeeId: null },
  { id: 'fac-4', name: 'R. Sharma', email: 'rs2@school.example', employeeId: null },
];

function build() {
  const prisma = {
    feedback: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'fb-new' }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    faculty: {
      findFirst: vi.fn().mockResolvedValue({ id: 'fac-1', name: 'Ayush' }),
      findMany: vi.fn().mockResolvedValue(FACULTY),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ name: 'Ayush' }),
    },
    user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ fullName: 'Principal Mehta' }) },
  };
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
    expect(prisma.feedback.findMany.mock.calls[1][0].where).toEqual({ schoolId: 'school-1', feedbackDate: { gte: d('2026-09-19') }, status: { not: 'DISMISSED' } });
    expect(out.items[0]).toMatchObject({ id: 'fb1', target: { all: false, name: 'Ayush' }, sender: { name: 'Principal Mehta', facultyId: null }, date: '2026-10-18' });
    expect(out.items[1].target).toBeNull();
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

  it('sends to all faculty, or to one teacher of this school, in the admin’s name and today’s date', async () => {
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
    await service.send('school-1', 'admin-1', plainToInstance(SendFeedbackDto, { target: 'fac-1', content: 'Thanks', rating: 4, category: 'ACADEMICS' }));
    expect(prisma.faculty.findFirst.mock.calls[0][0].where).toEqual({ id: 'fac-1', schoolId: 'school-1', status: { not: 'INACTIVE' } });
    expect(prisma.feedback.create.mock.calls[1][0].data).toMatchObject({ toAllFaculty: false, targetFacultyId: 'fac-1', targetName: 'Ayush' });
    prisma.faculty.findFirst.mockResolvedValueOnce(null);
    await expect(service.send('school-1', 'admin-1', plainToInstance(SendFeedbackDto, { target: 'fac-x', content: 'x', rating: 4, category: 'ACADEMICS' }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('moves an entry through the workflow, recording who and when; scoped in the write', async () => {
    const { service, prisma } = build();
    await expect(service.setStatus('school-1', 'admin-1', 'fb1', { status: 'ACTIONED' })).resolves.toEqual({ id: 'fb1', status: 'ACTIONED' });
    expect(prisma.feedback.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'fb1', schoolId: 'school-1' },
      data: { status: 'ACTIONED', statusChangedAt: NOW, statusChangedBy: 'Principal Mehta' },
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

  it('checks every row, and creates only on confirm', async () => {
    const { service, prisma } = build();
    const rows = [
      { type: 'Management -> Teacher', sender: 'Principal Mehta', rating: '5', content: 'Excellent results in the last unit test.', subject: 'Unit test', target: 'ayush@school.example', category: 'Academics', date: '2026-10-17' },
      { type: 'Teacher -> Management', sender: 'Mrs. Gupta', rating: '4', content: 'New smartboard in Lab 3 works great.', target: 'Staff', category: 'Administration' },
      { type: 'Management -> Teacher', rating: '3', content: 'Keep the staff room tidy.', target: 'All Faculty' },
    ];
    const preview = await service.import('school-1', 'admin-1', sheet(rows));
    expect(preview).toMatchObject({ applied: false, created: 3, skipped: 0 });
    expect(preview.rows.map((r) => r.label)).toEqual([
      'Management -> Teacher: Principal Mehta to Ayush',
      'Teacher -> Management: Mrs. Gupta',
      'Management -> Teacher: Principal Mehta to All Faculty',
    ]);
    expect(prisma.feedback.createMany).not.toHaveBeenCalled();
    await service.import('school-1', 'admin-1', sheet(rows, false));
    const data = prisma.feedback.createMany.mock.calls[0][0].data;
    expect(data[0]).toEqual({
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
    });
    // A teacher's feedback is linked to their profile; the target column is ignored for it.
    expect(data[1]).toMatchObject({ direction: 'TEACHER_TO_MANAGEMENT', senderName: 'Mrs. Gupta', senderFacultyId: 'fac-2', toAllFaculty: false, targetName: null, feedbackDate: d('2026-10-18') });
    // A blank sender of management feedback is the importing admin.
    expect(data[2]).toMatchObject({ senderName: 'Principal Mehta', toAllFaculty: true, category: 'GENERAL' });
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

  it('a row already imported, or repeated in the file, is skipped so a sheet can be uploaded again', async () => {
    const { service, prisma } = build();
    prisma.feedback.findMany.mockResolvedValueOnce([
      { direction: 'TEACHER_TO_MANAGEMENT', senderName: 'Mrs. Gupta', toAllFaculty: false, targetName: null, feedbackDate: d('2026-10-18'), content: 'New smartboard works great.' },
    ]);
    const again = { type: 'Teacher -> Management', sender: 'gupta@school.example', rating: '5', content: 'New smartboard works great.', date: '2026-10-18' };
    const twice = { type: 'Management -> Teacher', rating: '4', content: 'Well done', target: 'EMP-1' };
    const preview = await service.import('school-1', 'admin-1', sheet([again, twice, twice]));
    expect(preview.rows.map((r) => r.action)).toEqual(['error', 'create', 'error']);
    expect(preview.rows[0].errors).toEqual(['Already imported (same people, date and feedback)']);
    expect(prisma.feedback.findMany.mock.calls[0][0].where).toEqual({ schoolId: 'school-1', source: 'IMPORT', feedbackDate: { in: [d('2026-10-18')] } });
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
  });
});
