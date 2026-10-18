import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '../generated/prisma/client.js';
import type { TeacherScope } from '../academic/access.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { PtmNoteDto } from './ptm-notes.dto.js';
import { PTM_LIST_LIMIT, PtmNotesService } from './ptm-notes.service.js';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const NOW = new Date('2026-10-18T05:00:00Z'); // 10:30 IST, 18 Oct
const scope = (over: Partial<TeacherScope> = {}): TeacherScope => ({ schoolId: 'school-1', facultyId: 'fac-1', batchIds: ['b1', 'b2'], programIds: [], active: true, ...over });
const dto = (over: Partial<PtmNoteDto> = {}) =>
  plainToInstance(PtmNoteDto, { batchId: 'b1', date: '2026-10-18', studentId: 'st-1', parentName: 'Mr. Patel', parentAttended: true, discussion: 'Progress report', actionItems: null, followUpDate: null, ...over });

function build() {
  const prisma = {
    ptmNote: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue({ studentId: 'st-1', batchId: 'b1' }),
      create: vi.fn().mockResolvedValue({ id: 'n1' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    batch: {
      findMany: vi.fn().mockResolvedValue([{ id: 'b1', name: 'Batch 1A', program: { name: 'JEE' }, students: [{ id: 'st-1', fullName: 'Ayush Rajeshkumar Patel', rollNumber: null }] }]),
      findFirst: vi.fn().mockResolvedValue({ id: 'b1', name: 'Batch 1A' }),
    },
    student: { findFirst: vi.fn().mockResolvedValue({ id: 'st-1' }) },
    faculty: { findUniqueOrThrow: vi.fn().mockResolvedValue({ name: 'Ayush' }) },
  };
  return { prisma, service: new PtmNotesService(prisma as unknown as PrismaService) };
}

beforeEach(() => vi.useFakeTimers({ now: NOW }));
afterEach(() => vi.useRealTimers());

describe('PtmNotesService', () => {
  it("the form's choices: today in India, and the teacher's batches with their students", async () => {
    const { service, prisma } = build();
    vi.setSystemTime(new Date('2026-10-18T19:00:00Z')); // 00:30 IST on the 19th
    await expect(service.options(scope())).resolves.toEqual({
      today: '2026-10-19',
      active: true,
      batches: [{ id: 'b1', name: 'Batch 1A', program: 'JEE', students: [{ id: 'st-1', fullName: 'Ayush Rajeshkumar Patel', rollNumber: null }] }],
    });
    expect(prisma.batch.findMany.mock.calls[0][0].where).toEqual({ schoolId: 'school-1', id: { in: ['b1', 'b2'] } });
    await expect(service.options(scope({ active: false }))).resolves.toMatchObject({ active: false, batches: [] });
  });

  it('logs a meeting for a student of one of the teacher’s batches, naming the batch and teacher', async () => {
    const { service, prisma } = build();
    await expect(service.create(scope(), dto({ actionItems: 'Daily 1-hour self-study', followUpDate: '2026-11-01' }))).resolves.toEqual({ id: 'n1' });
    expect(prisma.student.findFirst.mock.calls[0][0].where).toEqual({ id: 'st-1', schoolId: 'school-1', batchId: 'b1' });
    expect(prisma.batch.findFirst.mock.calls[0][0].where).toEqual({ id: 'b1', schoolId: 'school-1' });
    expect(prisma.ptmNote.create.mock.calls[0][0].data).toEqual({
      schoolId: 'school-1',
      studentId: 'st-1',
      batchId: 'b1',
      batchName: 'Batch 1A',
      facultyId: 'fac-1',
      teacherName: 'Ayush',
      meetingDate: d('2026-10-18'),
      followUpDate: d('2026-11-01'),
      parentName: 'Mr. Patel',
      parentAttended: true,
      discussion: 'Progress report',
      actionItems: 'Daily 1-hour self-study',
    });
  });

  it('refuses another batch, a student not in the batch, an inactive teacher, a future meeting and an early follow-up', async () => {
    const { service, prisma } = build();
    await expect(service.create(scope(), dto({ batchId: 'b-x' }))).rejects.toEqual(new ForbiddenException("You aren't assigned to that batch"));
    prisma.student.findFirst.mockResolvedValueOnce(null);
    await expect(service.create(scope(), dto())).rejects.toEqual(new BadRequestException('Select a student of this batch'));
    await expect(service.create(scope({ active: false }), dto())).rejects.toEqual(new ForbiddenException('Only active faculty can log parent meetings'));
    await expect(service.create(scope(), dto({ date: '2026-10-19' }))).rejects.toThrow("You can't log a meeting that hasn't happened yet");
    await expect(service.create(scope(), dto({ date: '2026-10-10', followUpDate: '2026-10-09' }))).rejects.toThrow("The follow-up can't be before the meeting");
    await expect(service.create(scope(), dto({ date: '2026-02-30' }))).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.ptmNote.create).not.toHaveBeenCalled();
  });

  it('a student removed at the same moment is a 400, not a foreign-key 500', async () => {
    const { service, prisma } = build();
    prisma.ptmNote.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 't' }));
    await expect(service.create(scope(), dto())).rejects.toEqual(new BadRequestException('That student was just removed. Refresh and pick again.'));
  });

  it('the log: only the teacher’s own notes, newest meeting first, searchable across fields with % taken literally', async () => {
    const { service, prisma } = build();
    prisma.ptmNote.count.mockResolvedValue(1);
    prisma.ptmNote.findMany.mockResolvedValue([
      {
        id: 'n1',
        meetingDate: d('2026-10-18'),
        followUpDate: null,
        student: { id: 'st-1', fullName: 'Ayush Rajeshkumar Patel', rollNumber: null },
        batchId: 'b1',
        batchName: 'Batch 1A',
        teacherName: 'Ayush',
        parentName: null,
        parentAttended: true,
        discussion: 'progress report',
        actionItems: null,
        createdAt: new Date('2026-10-18T05:00:00Z'),
      },
    ]);
    await expect(service.list(scope(), { q: '50%' })).resolves.toEqual({
      total: 1,
      items: [
        {
          id: 'n1',
          date: '2026-10-18',
          student: { id: 'st-1', fullName: 'Ayush Rajeshkumar Patel', rollNumber: null },
          batch: { id: 'b1', name: 'Batch 1A' },
          teacherName: 'Ayush',
          parentName: null,
          parentAttended: true,
          discussion: 'progress report',
          actionItems: null,
          followUpDate: null,
          createdAt: '2026-10-18T05:00:00.000Z',
        },
      ],
    });
    const args = prisma.ptmNote.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ schoolId: 'school-1', facultyId: 'fac-1' });
    expect(args.where.OR).toContainEqual({ student: { fullName: { contains: '50\\%', mode: 'insensitive' } } });
    expect(args.where.OR).toContainEqual({ discussion: { contains: '50\\%', mode: 'insensitive' } });
    expect(args.orderBy).toEqual([{ meetingDate: 'desc' }, { createdAt: 'desc' }]);
    expect(args.take).toBe(PTM_LIST_LIMIT);
    // Without a faculty profile there is nothing to list.
    await expect(service.list(scope({ facultyId: null }), {})).resolves.toEqual({ total: 0, items: [] });
  });

  it('editing keeps the student and batch without re-checking (the student may have moved on); another one is checked', async () => {
    const { service, prisma } = build();
    prisma.student.findFirst.mockResolvedValue(null); // no longer in Batch 1A
    await expect(service.update(scope(), 'n1', dto({ discussion: 'Corrected notes' }))).resolves.toEqual({ id: 'n1' });
    const call = prisma.ptmNote.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'n1', schoolId: 'school-1', facultyId: 'fac-1' });
    expect(call.data).toEqual({ meetingDate: d('2026-10-18'), followUpDate: null, parentName: 'Mr. Patel', parentAttended: true, discussion: 'Corrected notes', actionItems: null });
    await expect(service.update(scope(), 'n1', dto({ studentId: 'st-2' }))).rejects.toThrow('Select a student of this batch');
    prisma.student.findFirst.mockResolvedValueOnce({ id: 'st-2' });
    prisma.batch.findFirst.mockResolvedValueOnce({ id: 'b2', name: 'Batch 2A' });
    await service.update(scope(), 'n1', dto({ studentId: 'st-2', batchId: 'b2' }));
    expect(prisma.ptmNote.updateMany.mock.calls[1][0].data).toMatchObject({ studentId: 'st-2', batchId: 'b2', batchName: 'Batch 2A' });
  });

  it("another teacher's note, or one deleted meanwhile, is a 404; writes are scoped to the teacher", async () => {
    const { service, prisma } = build();
    prisma.ptmNote.findFirst.mockResolvedValueOnce(null);
    await expect(service.update(scope(), 'n-x', dto())).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.ptmNote.findFirst.mock.calls[0][0].where).toEqual({ id: 'n-x', schoolId: 'school-1', facultyId: 'fac-1' });
    prisma.ptmNote.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.update(scope(), 'n1', dto())).rejects.toThrow('Meeting note not found');
    prisma.ptmNote.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.remove(scope(), 'n1')).rejects.toThrow('Meeting note not found');
    expect(prisma.ptmNote.deleteMany.mock.calls[0][0].where).toEqual({ id: 'n1', schoolId: 'school-1', facultyId: 'fac-1' });
    await expect(service.remove(scope(), 'n1')).resolves.toEqual({ ok: true });
    await expect(service.remove(scope({ active: false }), 'n1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('PtmNoteDto', () => {
  const errors = async (plain: object) =>
    Object.fromEntries((await validate(plainToInstance(PtmNoteDto, plain))).map((e) => [e.property, Object.values(e.constraints ?? {})[0]]));

  it('needs a batch, date, student, attendance and discussion notes, with clear messages', async () => {
    expect(await errors({ batchId: '', date: '', studentId: 'x', discussion: '   ' })).toEqual({
      batchId: 'Select a batch',
      date: 'Pick the meeting date',
      studentId: 'Select a student',
      parentAttended: 'Say whether the parent attended',
      discussion: 'Write the discussion notes',
    });
  });

  it('keeps line breaks in notes and turns blank optional fields into null', () => {
    const out = dto({ discussion: '  Progress  report\n\n\n\nAttendance ok ', actionItems: '  ', parentName: '', followUpDate: '' });
    expect(out.discussion).toBe('Progress report\n\nAttendance ok');
    expect(out.actionItems).toBeNull();
    expect(out.parentName).toBeNull();
    expect(out.followUpDate).toBeNull();
  });
});
