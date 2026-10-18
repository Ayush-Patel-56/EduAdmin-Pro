import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { TeacherScope } from '../academic/access.service.js';
import { istToday, parseDate, toIsoDate } from '../common/dates.js';
import { likeEscape } from '../common/like-escape.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PtmNoteDto, PtmNoteQuery } from './ptm-notes.dto.js';

/** The log shows a teacher's newest this many notes; a search narrows it. */
export const PTM_LIST_LIMIT = 200;

const include = {
  student: { select: { id: true, fullName: true, rollNumber: true } },
} satisfies Prisma.PtmNoteInclude;
type NoteRow = Prisma.PtmNoteGetPayload<{ include: typeof include }>;

/**
 * Parent Meeting Notes & Action Items (PRD 5.8), faculty only. A teacher logs
 * meetings with the parents of students in their own batches, and reads and
 * corrects the notes they logged. The notes are kept for the student's record
 * (the 5-in-1 report), so they name the batch and teacher as they were.
 */
@Injectable()
export class PtmNotesService {
  constructor(private readonly prisma: PrismaService) {}

  /** The form's choices: today (India), and the teacher's batches with their students. */
  async options(scope: TeacherScope) {
    const today = toIsoDate(istToday())!;
    if (!scope.active || !scope.facultyId) return { today, active: false, batches: [] };
    const batches = await this.prisma.batch.findMany({
      where: { schoolId: scope.schoolId, id: { in: scope.batchIds } },
      select: {
        id: true,
        name: true,
        program: { select: { name: true } },
        students: { select: { id: true, fullName: true, rollNumber: true }, orderBy: [{ fullName: 'asc' }, { id: 'asc' }] },
      },
      orderBy: { name: 'asc' },
    });
    return {
      today,
      active: true,
      batches: batches.map((b) => ({ id: b.id, name: b.name, program: b.program.name, students: b.students })),
    };
  }

  /** The teacher's own notes, newest meeting first. An inactive teacher has no access (as in the other teacher pages). */
  async list(scope: TeacherScope, query: PtmNoteQuery) {
    if (!scope.active || !scope.facultyId) return { total: 0, items: [] };
    const where: Prisma.PtmNoteWhereInput = { schoolId: scope.schoolId, facultyId: scope.facultyId, ...searchWhere(query.q) };
    const [total, rows] = await Promise.all([
      this.prisma.ptmNote.count({ where }),
      this.prisma.ptmNote.findMany({ where, include, orderBy: [{ meetingDate: 'desc' }, { createdAt: 'desc' }], take: PTM_LIST_LIMIT }),
    ]);
    return { total, items: rows.map(toNote) };
  }

  async create(scope: TeacherScope, dto: PtmNoteDto) {
    const facultyId = requireTeacher(scope);
    if (!dto.batchId) throw new BadRequestException('Select a batch');
    const [batch, faculty] = await Promise.all([
      this.requireStudentInBatch(scope, dto.batchId, dto.studentId),
      this.prisma.faculty.findUniqueOrThrow({ where: { id: facultyId }, select: { name: true } }),
    ]);
    const dates = meetingDates(dto, { day: batch.startDate, reason: 'the batch started' });
    const row = await studentGone(() =>
      this.prisma.ptmNote.create({
        data: {
          schoolId: scope.schoolId,
          studentId: dto.studentId,
          batchId: batch.id,
          batchName: batch.name,
          facultyId,
          teacherName: faculty.name,
          ...dates,
          ...fields(dto),
        },
        select: { id: true },
      }),
    );
    return { id: row.id };
  }

  /**
   * Corrects a note. Keeping its student and batch is always allowed (the
   * student may have moved on, or the batch been deleted, since): leave the
   * batch out, or send the one it has. Choosing another student or batch is
   * checked like a new note. Scoped in the write, so a note deleted meanwhile
   * is a 404.
   */
  async update(scope: TeacherScope, id: string, dto: PtmNoteDto) {
    const facultyId = requireTeacher(scope);
    const current = await this.prisma.ptmNote.findFirst({
      where: { id, schoolId: scope.schoolId, facultyId },
      select: { studentId: true, batchId: true, meetingDate: true, batch: { select: { startDate: true } } },
    });
    if (!current) throw new NotFoundException('Meeting note not found');
    const keep = current.studentId === dto.studentId && (!dto.batchId || dto.batchId === current.batchId);
    if (!keep && !dto.batchId) throw new BadRequestException('Select a batch');
    const batch = keep ? null : await this.requireStudentInBatch(scope, dto.batchId!, dto.studentId);
    // The earliest-day bound applies only when the day or the batch changes, so a typo in a
    // note can always be fixed (even after its batch's start date was moved later).
    const sameDay = parseDate(dto.date, 'Meeting date').getTime() === current.meetingDate.getTime();
    const floor = batch
      ? { day: batch.startDate, reason: 'the batch started' }
      : sameDay
        ? null
        : current.batch
          ? { day: current.batch.startDate, reason: 'the batch started' }
          : earlier(await this.schoolFloor(scope.schoolId), { day: current.meetingDate, reason: 'its current date' });
    const dates = meetingDates(dto, floor);
    const { count } = await studentGone(() =>
      this.prisma.ptmNote.updateMany({
        where: { id, schoolId: scope.schoolId, facultyId },
        data: { ...(batch && { studentId: dto.studentId, batchId: batch.id, batchName: batch.name }), ...dates, ...fields(dto) },
      }),
    );
    if (!count) throw new NotFoundException('Meeting note not found');
    return { id };
  }

  async remove(scope: TeacherScope, id: string) {
    const facultyId = requireTeacher(scope);
    const { count } = await this.prisma.ptmNote.deleteMany({ where: { id, schoolId: scope.schoolId, facultyId } });
    if (!count) throw new NotFoundException('Meeting note not found');
    return { ok: true };
  }

  /**
   * The earliest day a note whose batch was deleted can move to: the school's
   * earliest batch start, or the day the school was set up if that is earlier
   * (or there are no batches left).
   */
  private async schoolFloor(schoolId: string) {
    const [school, batches] = await Promise.all([
      this.prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { createdAt: true } }),
      this.prisma.batch.aggregate({ where: { schoolId }, _min: { startDate: true } }),
    ]);
    const created = istToday(school.createdAt);
    const earliest = batches._min.startDate;
    return { day: earliest && earliest < created ? earliest : created, reason: "this school's records start" };
  }

  /** One of the teacher's batches, and a student who is in it now. */
  private async requireStudentInBatch(scope: TeacherScope, batchId: string, studentId: string) {
    if (!scope.batchIds.includes(batchId)) throw new ForbiddenException("You aren't assigned to that batch");
    const [batch, student] = await Promise.all([
      this.prisma.batch.findFirst({ where: { id: batchId, schoolId: scope.schoolId }, select: { id: true, name: true, startDate: true } }),
      this.prisma.student.findFirst({ where: { id: studentId, schoolId: scope.schoolId, batchId }, select: { id: true } }),
    ]);
    if (!batch) throw new BadRequestException('Select one of your batches');
    if (!student) throw new BadRequestException('Select a student of this batch');
    return batch;
  }
}

function requireTeacher(scope: TeacherScope): string {
  if (!scope.active || !scope.facultyId) throw new ForbiddenException('Only active faculty can log parent meetings');
  return scope.facultyId;
}

/**
 * The earlier of two floors. A note whose batch was deleted is bounded by when
 * the school's records start, but never above its own day: if every early
 * batch is gone, the records can start after the note, and it can still move
 * later (#42).
 */
function earlier(a: { day: Date; reason: string }, b: { day: Date; reason: string }) {
  return b.day < a.day ? b : a;
}

const dayLabel = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });

/**
 * A meeting that has happened (up to today, India), not before the earliest
 * day allowed (its batch's start, or for a note whose batch was deleted, when
 * the school's records start; none when an edit keeps the day and batch), and
 * a follow-up on or after it.
 */
function meetingDates(dto: PtmNoteDto, floor: { day: Date; reason: string } | null) {
  const meetingDate = parseDate(dto.date, 'Meeting date');
  if (meetingDate > istToday()) throw new BadRequestException("You can't log a meeting that hasn't happened yet");
  if (floor && meetingDate < floor.day) throw new BadRequestException(`The meeting can't be before ${floor.reason} (${dayLabel.format(floor.day)})`);
  const followUpDate = dto.followUpDate ? parseDate(dto.followUpDate, 'Follow-up date') : null;
  if (followUpDate && followUpDate < meetingDate) throw new BadRequestException("The follow-up can't be before the meeting");
  return { meetingDate, followUpDate };
}

function fields(dto: PtmNoteDto) {
  return {
    parentName: dto.parentName ?? null,
    parentAttended: dto.parentAttended,
    discussion: dto.discussion,
    actionItems: dto.actionItems ?? null,
  };
}

/** A student removed between the check and the save (foreign key) is a 400, not a 500. */
async function studentGone<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      throw new BadRequestException('That student was just removed. Refresh and pick again.');
    }
    throw err;
  }
}

/** Student name or roll number, parent name, notes, action items or batch, in any letter case. */
function searchWhere(q: string | null | undefined): Prisma.PtmNoteWhereInput {
  const text = q?.trim();
  if (!text) return {};
  const like = { contains: likeEscape(text), mode: 'insensitive' } as const;
  return {
    OR: [
      { student: { fullName: like } },
      { student: { rollNumber: like } },
      { parentName: like },
      { discussion: like },
      { actionItems: like },
      { batchName: like },
    ],
  };
}

function toNote(n: NoteRow) {
  return {
    id: n.id,
    date: toIsoDate(n.meetingDate)!,
    student: n.student,
    batch: { id: n.batchId, name: n.batchName },
    teacherName: n.teacherName,
    parentName: n.parentName,
    parentAttended: n.parentAttended,
    discussion: n.discussion,
    actionItems: n.actionItems,
    followUpDate: toIsoDate(n.followUpDate),
    createdAt: n.createdAt.toISOString(),
  };
}
