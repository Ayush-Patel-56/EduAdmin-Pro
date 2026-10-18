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
      findFirst: vi.fn().mockResolvedValue({ studentId: 'st-1', batchId: 'b1', meetingDate: d('2026-10-18'), batch: { startDate: d('2026-04-01') } }),
      create: vi.fn().mockResolvedValue({ id: 'n1' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    batch: {
      findMany: vi.fn().mockResolvedValue([{ id: 'b1', name: 'Batch 1A', program: { name: 'JEE' }, students: [{ id: 'st-1', fullName: 'Ayush Rajeshkumar Patel', rollNumber: null }] }]),
      findFirst: vi.fn().mockResolvedValue({ id: 'b1', name: 'Batch 1A', startDate: d('2026-04-01') }),
      // The school's earliest batch start (for a note whose batch was deleted).
      aggregate: vi.fn().mockResolvedValue({ _min: { startDate: d('2026-04-01') } }),
    },
    school: { findUniqueOrThrow: vi.fn().mockResolvedValue({ createdAt: new Date('2026-06-01T05:00:00Z') }) },
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
    await expect(service.create(scope(), dto({ batchId: null }))).rejects.toEqual(new BadRequestException('Select a batch'));
    expect(prisma.ptmNote.create).not.toHaveBeenCalled();
  });

  it('a meeting is on or after the day its batch started (1900-01-01 is refused)', async () => {
    const { service, prisma } = build();
    await expect(service.create(scope(), dto({ date: '1900-01-01' }))).rejects.toEqual(new BadRequestException("The meeting can't be before the batch started (1 Apr 2026)"));
    await expect(service.create(scope(), dto({ date: '2026-03-31' }))).rejects.toThrow('before the batch started');
    await expect(service.create(scope(), dto({ date: '2026-04-01' }))).resolves.toEqual({ id: 'n1' });
    // Correcting a note checks its own batch's start; a note whose batch was deleted has no batch bound.
    await expect(service.update(scope(), 'n1', dto({ date: '2026-03-01' }))).rejects.toThrow('before the batch started');
    // A note whose batch was deleted, dated 1 Mar: keeping its day saves; moving it is bounded by the school's records.
    prisma.ptmNote.findFirst.mockResolvedValueOnce({ studentId: 'st-1', batchId: null, meetingDate: d('2026-03-01'), batch: null });
    await expect(service.update(scope(), 'n1', dto({ batchId: null, date: '2026-03-01' }))).resolves.toEqual({ id: 'n1' });
  });

  it('a note whose batch was deleted can’t move before the school’s records start (1900-01-01 refused); its own day still saves', async () => {
    const { service, prisma } = build();
    const orphan = { studentId: 'st-1', batchId: null, meetingDate: d('2026-05-10'), batch: null };
    prisma.ptmNote.findFirst.mockResolvedValue(orphan);
    // The floor is the earlier of the school's earliest batch start (1 Apr) and the day the school was set up (1 Jun).
    await expect(service.update(scope(), 'n1', dto({ batchId: null, date: '1900-01-01' }))).rejects.toEqual(
      new BadRequestException("The meeting can't be before this school's records start (1 Apr 2026)"),
    );
    expect(prisma.batch.aggregate.mock.calls[0][0]).toEqual({ where: { schoolId: 'school-1' }, _min: { startDate: true } });
    await expect(service.update(scope(), 'n1', dto({ batchId: null, date: '2026-05-10', discussion: 'Fixed a typo' }))).resolves.toEqual({ id: 'n1' });
    await expect(service.update(scope(), 'n1', dto({ batchId: null, date: '2026-04-02' }))).resolves.toEqual({ id: 'n1' });
    // With no batches left, the day the school was set up is the floor.
    prisma.batch.aggregate.mockResolvedValueOnce({ _min: { startDate: null } });
    prisma.ptmNote.findFirst.mockResolvedValueOnce({ ...orphan, meetingDate: d('2026-07-10') });
    await expect(service.update(scope(), 'n1', dto({ batchId: null, date: '2026-05-01' }))).rejects.toThrow("this school's records start (1 Jun 2026)");
  });

  it('the school floor: the day the school was set up, in India, when that is before its first batch starts (#42)', async () => {
    const { service, prisma } = build();
    prisma.ptmNote.findFirst.mockResolvedValue({ studentId: 'st-1', batchId: null, meetingDate: d('2026-05-10'), batch: null });
    // Set up at 20:00 UTC on 28 Feb, which is 1 Mar in India; the first batch starts 1 Apr.
    prisma.school.findUniqueOrThrow.mockResolvedValue({ createdAt: new Date('2026-02-28T20:00:00Z') });
    await expect(service.update(scope(), 'n1', dto({ batchId: null, date: '2026-03-01' }))).resolves.toEqual({ id: 'n1' });
    await expect(service.update(scope(), 'n1', dto({ batchId: null, date: '2026-02-28' }))).rejects.toEqual(
      new BadRequestException("The meeting can't be before this school's records start (1 Mar 2026)"),
    );
  });

  it('when every early batch is gone and the records start after the note, it can still move later, never earlier (#42)', async () => {
    const { service, prisma } = build();
    // A school set up today whose only batch (start 1 Apr) was deleted; the note is from 1 May.
    prisma.school.findUniqueOrThrow.mockResolvedValue({ createdAt: NOW });
    prisma.batch.aggregate.mockResolvedValue({ _min: { startDate: null } });
    prisma.ptmNote.findFirst.mockResolvedValue({ studentId: 'st-1', batchId: null, meetingDate: d('2026-05-01'), batch: null });
    await expect(service.update(scope(), 'n1', dto({ batchId: null, date: '2026-05-02' }))).resolves.toEqual({ id: 'n1' });
    await expect(service.update(scope(), 'n1', dto({ batchId: null, date: '2026-04-30' }))).rejects.toEqual(
      new BadRequestException("The meeting can't be before its current date (1 May 2026)"),
    );
  });

  it('after a batch’s start moves later, a text-only edit of an older note saves; changing its day, or re-pointing it, is still bounded', async () => {
    const { service, prisma } = build();
    // Batch 1A now starts 1 May; the note is from 1 Apr.
    prisma.ptmNote.findFirst.mockResolvedValue({ studentId: 'st-1', batchId: 'b1', meetingDate: d('2026-04-01'), batch: { startDate: d('2026-05-01') } });
    await expect(service.update(scope(), 'n1', dto({ date: '2026-04-01', discussion: 'Corrected spelling' }))).resolves.toEqual({ id: 'n1' });
    await expect(service.update(scope(), 'n1', dto({ date: '2026-04-15' }))).rejects.toThrow("The meeting can't be before the batch started (1 May 2026)");
    prisma.student.findFirst.mockResolvedValueOnce({ id: 'st-1' });
    prisma.batch.findFirst.mockResolvedValueOnce({ id: 'b2', name: 'Batch 2A', startDate: d('2026-05-01') });
    await expect(service.update(scope(), 'n1', dto({ batchId: 'b2', date: '2026-04-01' }))).rejects.toThrow('before the batch started (1 May 2026)');
    expect(prisma.ptmNote.updateMany).toHaveBeenCalledTimes(1);
  });

  it('a correction that leaves batchId out altogether keeps the note’s batch (an API client may omit it)', async () => {
    const { service, prisma } = build();
    const { batchId: _omit, ...withoutBatch } = { batchId: 'b1', date: '2026-10-18', studentId: 'st-1', parentName: null, parentAttended: true, discussion: 'Corrected', actionItems: null, followUpDate: null };
    const body = plainToInstance(PtmNoteDto, withoutBatch);
    expect('batchId' in body && body.batchId !== undefined).toBe(false);
    await expect(service.update(scope(), 'n1', body)).resolves.toEqual({ id: 'n1' });
    expect(prisma.ptmNote.updateMany.mock.calls[0][0].data).not.toHaveProperty('batchId');
    expect(prisma.batch.findFirst).not.toHaveBeenCalled();
  });

  it('at 01:00 in India a meeting dated today (India) is logged, though the UTC day is still yesterday', async () => {
    const { service, prisma } = build();
    vi.setSystemTime(new Date('2026-10-18T19:30:00Z')); // 01:00 IST on the 19th
    await expect(service.create(scope(), dto({ date: '2026-10-19' }))).resolves.toEqual({ id: 'n1' });
    expect(prisma.ptmNote.create.mock.calls[0][0].data.meetingDate).toEqual(d('2026-10-19'));
    await expect(service.create(scope(), dto({ date: '2026-10-20' }))).rejects.toThrow("You can't log a meeting that hasn't happened yet");
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
    // Without a faculty profile, or with an inactive one, there is nothing to list.
    await expect(service.list(scope({ facultyId: null }), {})).resolves.toEqual({ total: 0, items: [] });
    prisma.ptmNote.findMany.mockClear();
    await expect(service.list(scope({ active: false }), {})).resolves.toEqual({ total: 0, items: [] });
    expect(prisma.ptmNote.findMany).not.toHaveBeenCalled();
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

  it('a note whose batch was deleted is corrected with no batch sent, keeping its recorded batch name', async () => {
    const { service, prisma } = build();
    prisma.ptmNote.findFirst.mockResolvedValue({ studentId: 'st-1', batchId: null, meetingDate: d('2026-10-18'), batch: null });
    await expect(service.update(scope(), 'n1', dto({ batchId: '', discussion: 'Corrected' }))).resolves.toEqual({ id: 'n1' });
    const data = prisma.ptmNote.updateMany.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('batchId');
    expect(data).not.toHaveProperty('batchName');
    expect(data.discussion).toBe('Corrected');
    expect(prisma.batch.findFirst).not.toHaveBeenCalled();
    // Changing the student needs a batch to check them against.
    await expect(service.update(scope(), 'n1', dto({ batchId: null, studentId: 'st-2' }))).rejects.toEqual(new BadRequestException('Select a batch'));
    // Picking a current batch is an explicit re-point, checked like a new note.
    await service.update(scope(), 'n1', dto({ batchId: 'b1' }));
    expect(prisma.ptmNote.updateMany.mock.calls[1][0].data).toMatchObject({ batchId: 'b1', batchName: 'Batch 1A' });
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

  it('needs a date, student, attendance and discussion notes, with clear messages (the batch is checked by the service)', async () => {
    expect(await errors({ batchId: 'not-a-uuid', date: '', studentId: 'x', discussion: '   ' })).toEqual({
      batchId: 'Select a batch',
      date: 'Pick the meeting date',
      studentId: 'Select a student',
      parentAttended: 'Say whether the parent attended',
      discussion: 'Write the discussion notes',
    });
  });

  it('discussion notes and action items are at most 4000 characters', async () => {
    const base = { batchId: '6f2c1d1e-0000-4000-8000-000000000001', date: '2026-10-18', studentId: '6f2c1d1e-0000-4000-8000-000000000002', parentAttended: true };
    expect(await errors({ ...base, discussion: 'x'.repeat(4000) })).toEqual({});
    expect(await errors({ ...base, discussion: 'x'.repeat(4001) })).toEqual({ discussion: 'Keep the discussion notes under 4000 characters' });
    expect(await errors({ ...base, discussion: 'ok', actionItems: 'y'.repeat(4001) })).toEqual({ actionItems: 'Keep the action items under 4000 characters' });
    expect(await errors({ ...base, batchId: '', discussion: 'ok' })).toEqual({});
  });

  it('keeps line breaks in notes and turns blank optional fields into null', () => {
    const out = dto({ discussion: '  Progress  report\n\n\n\nAttendance ok ', actionItems: '  ', parentName: '', followUpDate: '' });
    expect(out.discussion).toBe('Progress report\n\nAttendance ok');
    expect(out.actionItems).toBeNull();
    expect(out.parentName).toBeNull();
    expect(out.followUpDate).toBeNull();
  });
});
