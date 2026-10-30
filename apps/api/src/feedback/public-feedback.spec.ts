import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { PrismaService } from '../prisma/prisma.service.js';
import { StudentFeedbackDto } from './public-feedback.dto.js';
import { PublicFeedbackService, STUDENT_COOLDOWN_MS } from './public-feedback.service.js';

const TOKEN = 'a'.repeat(43);
const NOW = new Date('2026-10-30T04:00:00Z'); // 09:30 IST, 30 Oct
const LINK = { id: 'link-1', schoolId: 'school-1', batchId: 'batch-1', active: true, school: { name: 'Sunrise Academy' }, batch: { name: 'JEE A' } };
const dto = (over: Partial<StudentFeedbackDto> = {}): StudentFeedbackDto =>
  ({ studentId: 'stu-1', facultyId: 'fac-1', rating: 4, comment: 'Explains kinematics clearly.', ...over }) as StudentFeedbackDto;

function build() {
  const prisma = {
    feedbackLink: { findUnique: vi.fn().mockResolvedValue(LINK) },
    student: { findMany: vi.fn().mockResolvedValue([{ id: 'stu-1', fullName: 'Aarav Sharma' }]) },
    facultyBatch: {
      findMany: vi.fn().mockResolvedValue([{ faculty: { id: 'fac-1', name: 'Vikram Rao', subjects: ['Physics'] } }]),
      findFirst: vi.fn().mockResolvedValue({ faculty: { name: 'Vikram Rao' } }),
    },
    feedback: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'fb-1' }),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'stu-1', fullName: 'Aarav Sharma' }]),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  return { prisma, service: new PublicFeedbackService(prisma as unknown as PrismaService) };
}

describe('PublicFeedbackService', () => {
  it("the form lists only the batch's active students (id and name) and its non-inactive teachers", async () => {
    const { prisma, service } = build();
    const form = await service.form(TOKEN);
    expect(form).toEqual({
      schoolName: 'Sunrise Academy',
      batchName: 'JEE A',
      cooldownMinutes: 15,
      students: [{ id: 'stu-1', name: 'Aarav Sharma' }],
      teachers: [{ id: 'fac-1', name: 'Vikram Rao', subjects: ['Physics'] }],
    });
    const students = prisma.student.findMany.mock.calls[0][0];
    expect(students.where).toEqual({ schoolId: 'school-1', batchId: 'batch-1', status: 'ACTIVE' });
    expect(students.select).toEqual({ id: true, fullName: true });
    expect(Object.keys(form.students[0]).sort()).toEqual(['id', 'name']);
    expect(prisma.facultyBatch.findMany.mock.calls[0][0].where).toEqual({ schoolId: 'school-1', batchId: 'batch-1', faculty: { status: { not: 'INACTIVE' } } });
  });

  it('an inactive, unknown or replaced link is 404 with the same message', async () => {
    const { prisma, service } = build();
    prisma.feedbackLink.findUnique.mockResolvedValueOnce({ ...LINK, active: false });
    await expect(service.form(TOKEN)).rejects.toThrow(new NotFoundException("This feedback link isn't active"));
    prisma.feedbackLink.findUnique.mockResolvedValueOnce(null); // unknown, or replaced by a new token
    await expect(service.form(TOKEN)).rejects.toThrow(new NotFoundException("This feedback link isn't active"));
    prisma.feedbackLink.findUnique.mockResolvedValueOnce(null);
    await expect(service.submit(TOKEN, dto(), NOW)).rejects.toThrow(new NotFoundException("This feedback link isn't active"));
    // A token that can't be one is refused without a lookup.
    const calls = prisma.feedbackLink.findUnique.mock.calls.length;
    await expect(service.form('not-a-token')).rejects.toThrow(new NotFoundException("This feedback link isn't active"));
    expect(prisma.feedbackLink.findUnique.mock.calls.length).toBe(calls);
  });

  it('refuses a student or teacher outside the batch', async () => {
    const { prisma, service } = build();
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await expect(service.submit(TOKEN, dto(), NOW)).rejects.toThrow(new BadRequestException('Pick your name from the list'));
    prisma.facultyBatch.findFirst.mockResolvedValueOnce(null);
    await expect(service.submit(TOKEN, dto(), NOW)).rejects.toThrow(new BadRequestException('Pick a teacher from the list'));
    expect(prisma.facultyBatch.findFirst.mock.calls[0][0].where).toEqual({
      schoolId: 'school-1',
      batchId: 'batch-1',
      facultyId: 'fac-1',
      faculty: { status: { not: 'INACTIVE' } },
    });
    expect(prisma.feedback.create).not.toHaveBeenCalled();
  });

  it('within 15 minutes of the last one: 429 with minutes left, nothing inserted', async () => {
    const { prisma, service } = build();
    prisma.feedback.findFirst.mockResolvedValue({ createdAt: new Date(NOW.getTime() - 14 * 60_000) });
    const error = await service.submit(TOKEN, dto(), NOW).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).getResponse()).toEqual({ message: 'You can send feedback again in 1 minute', retryAfterSeconds: 60 });
    expect(prisma.feedback.findFirst.mock.calls[0][0]).toMatchObject({ where: { schoolId: 'school-1', studentId: 'stu-1', direction: 'STUDENT_TO_TEACHER' }, orderBy: { createdAt: 'desc' } });
    expect(prisma.feedback.create).not.toHaveBeenCalled();

    prisma.feedback.findFirst.mockResolvedValue({ createdAt: new Date(NOW.getTime() - 2 * 60_000) });
    const later = (await service.submit(TOKEN, dto(), NOW).catch((e: unknown) => e)) as HttpException;
    expect(later.getResponse()).toEqual({ message: 'You can send feedback again in 13 minutes', retryAfterSeconds: 780 });

    prisma.feedback.findFirst.mockResolvedValue({ createdAt: new Date(NOW.getTime() - STUDENT_COOLDOWN_MS) });
    await expect(service.submit(TOKEN, dto(), NOW)).resolves.toEqual({ ok: true, nextAllowedAt: new Date(NOW.getTime() + STUDENT_COOLDOWN_MS).toISOString() });
  });

  it('stores a student-to-teacher row with names snapshotted and no creator', async () => {
    const { prisma, service } = build();
    await service.submit(TOKEN, dto(), NOW);
    expect(prisma.feedback.create.mock.calls[0][0].data).toMatchObject({
      schoolId: 'school-1',
      direction: 'STUDENT_TO_TEACHER',
      senderName: 'Aarav Sharma',
      studentId: 'stu-1',
      studentName: 'Aarav Sharma',
      batchId: 'batch-1',
      batchName: 'JEE A',
      targetFacultyId: 'fac-1',
      targetName: 'Vikram Rao',
      toAllFaculty: false,
      category: 'GENERAL',
      source: 'APP',
      rating: 4,
      content: 'Explains kinematics clearly.',
      feedbackDate: new Date('2026-10-30T00:00:00Z'),
      createdById: null,
    });
  });
});

describe('StudentFeedbackDto', () => {
  const check = async (body: object) => (await validate(plainToInstance(StudentFeedbackDto, body))).flatMap((e) => Object.values(e.constraints ?? {}));
  const valid = { studentId: '0b9f1c3e-3c1a-4c55-9b51-2f4d7e8a9b10', facultyId: '1c9f1c3e-3c1a-4c55-9b51-2f4d7e8a9b10', rating: 5, comment: '  Very   clear\nlessons.  ' };

  it('accepts a full form and tidies the comment', async () => {
    expect(await check(valid)).toEqual([]);
    expect(plainToInstance(StudentFeedbackDto, valid).comment).toBe('Very clear\nlessons.');
  });

  it('wants a rating of 1-5 and a comment of 10 to 1,000 characters', async () => {
    expect(await check({ ...valid, rating: 6 })).toContain('Give a rating of 1 to 5 stars');
    expect(await check({ ...valid, comment: '   short   ' })).toContain('Write at least 10 characters');
    expect(await check({ ...valid, comment: 'x'.repeat(1001) })).toContain('Keep it under 1,000 characters');
    expect(await check({ ...valid, studentId: 'nope' })).toContain('Pick your name from the list');
    expect(await check({ ...valid, facultyId: undefined })).toContain('Pick a teacher from the list');
  });
});
