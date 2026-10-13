import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { TeacherScope } from '../academic/access.service.js';
import {
  istInstant,
  istMonthStart,
  istParts,
  istWeekStart,
  parseDate,
  toIsoDate,
} from '../common/dates.js';
import type { CounselingStatus, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StudentsService } from '../students/students.service.js';
import type {
  CounselingQuery,
  ScheduleSessionDto,
  SessionFields,
  SessionStatusDto,
} from './counseling.dto.js';

const PAGE_SIZE = 20;
const WEEK_MS = 7 * 86_400_000;

const sessionInclude = {
  student: {
    select: {
      id: true,
      fullName: true,
      rollNumber: true,
      classLevel: true,
      batch: { select: { name: true } },
    },
  },
} as const;
type SessionRow = Prisma.CounselingSessionGetPayload<{ include: typeof sessionInclude }>;

/**
 * Counseling sessions (PRD 4.13 admin registry, 5.14 faculty log). Admins see
 * and manage every session of the school; a teacher sees and logs only their
 * own sessions, with students they can see.
 */
@Injectable()
export class CounselingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly students: StudentsService,
  ) {}

  /** Who can counsel: the school's active admins and its faculty who aren't inactive. */
  async counselors(schoolId: string) {
    const [admins, faculty] = await Promise.all([
      this.prisma.schoolMembership.findMany({
        where: { schoolId, role: 'ADMIN', status: 'ACTIVE' },
        include: { user: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.faculty.findMany({
        where: { schoolId, status: { not: 'INACTIVE' } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return [
      ...admins.map((m) => ({ id: `admin:${m.user.id}`, name: m.user.fullName, kind: 'ADMIN' as const })),
      ...faculty.map((f) => ({ id: `faculty:${f.id}`, name: f.name, kind: 'FACULTY' as const })),
    ];
  }

  async adminList(schoolId: string, query: CounselingQuery) {
    const where: Prisma.CounselingSessionWhereInput = { schoolId, ...filters(query) };
    const page = query.page ?? 1;
    const now = new Date();
    const weekStart = istWeekStart(now);
    const [total, rows, thisWeek, lastWeek, upcoming, noShows, flagged] = await Promise.all([
      this.prisma.counselingSession.count({ where }),
      this.prisma.counselingSession.findMany({
        where,
        include: sessionInclude,
        orderBy: { scheduledAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.countBetween(schoolId, weekStart, new Date(weekStart.getTime() + WEEK_MS)),
      this.countBetween(schoolId, new Date(weekStart.getTime() - WEEK_MS), weekStart),
      this.prisma.counselingSession.count({
        where: { schoolId, status: 'SCHEDULED', scheduledAt: { gte: now } },
      }),
      this.prisma.counselingSession.count({
        where: { schoolId, status: 'NO_SHOW', scheduledAt: { gte: istMonthStart(now) } },
      }),
      this.prisma.counselingSession.findMany({
        where: { schoolId, flagged: true },
        distinct: ['studentId'],
        select: { studentId: true },
      }),
    ]);
    return {
      kpis: {
        sessionsThisWeek: thisWeek,
        sessionsLastWeek: lastWeek,
        upcoming,
        noShowsThisMonth: noShows,
        studentsFlagged: flagged.length,
      },
      total,
      page,
      pageSize: PAGE_SIZE,
      items: rows.map(toSession),
    };
  }

  async schedule(schoolId: string, userId: string, dto: ScheduleSessionDto) {
    await this.requireStudent(schoolId, dto.studentId);
    const counselor = await this.resolveCounselor(schoolId, dto.counselor);
    const row = await this.prisma.counselingSession.create({
      data: {
        schoolId,
        ...counselor,
        ...sessionData(dto),
        status: dto.status ?? 'SCHEDULED',
        flagged: dto.flagged ?? false,
        createdById: userId,
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  async update(schoolId: string, id: string, dto: ScheduleSessionDto) {
    const current = await this.find(schoolId, id);
    await this.requireStudent(schoolId, dto.studentId);
    // An unchanged counselor stays even if they've since left (their name is kept).
    const counselor =
      dto.counselor === counselorKey(current)
        ? {}
        : await this.resolveCounselor(schoolId, dto.counselor);
    await this.prisma.counselingSession.update({
      where: { id },
      data: {
        ...counselor,
        ...sessionData(dto),
        ...(dto.status && { status: dto.status }),
        ...(dto.flagged !== undefined && { flagged: dto.flagged }),
      },
    });
    return { id };
  }

  async setStatus(schoolId: string, id: string, dto: SessionStatusDto) {
    await this.find(schoolId, id);
    await this.prisma.counselingSession.update({
      where: { id },
      data: {
        ...(dto.status && { status: dto.status }),
        ...(dto.flagged !== undefined && { flagged: dto.flagged }),
      },
    });
    return { id };
  }

  async remove(schoolId: string, id: string) {
    await this.find(schoolId, id);
    await this.prisma.counselingSession.delete({ where: { id } });
    return { ok: true };
  }

  // Faculty

  async teacherList(scope: TeacherScope, query: CounselingQuery) {
    if (!scope.facultyId) return [];
    const rows = await this.prisma.counselingSession.findMany({
      where: {
        schoolId: scope.schoolId,
        counselorFacultyId: scope.facultyId,
        ...filters({ ...query, counselor: null }),
      },
      include: sessionInclude,
      orderBy: { scheduledAt: 'desc' },
      take: 200,
    });
    return rows.map(toSession);
  }

  /** A teacher logs a session they held (or will hold) with a student they can see. */
  async teacherLog(scope: TeacherScope, userId: string, dto: SessionFields) {
    const facultyId = this.requireTeacher(scope);
    await this.requireVisibleStudent(scope, dto.studentId);
    const faculty = await this.prisma.faculty.findUniqueOrThrow({
      where: { id: facultyId },
      select: { name: true },
    });
    const data = sessionData(dto);
    const row = await this.prisma.counselingSession.create({
      data: {
        schoolId: scope.schoolId,
        counselorFacultyId: facultyId,
        counselorName: faculty.name,
        ...data,
        // Logging a past session records it as held; a future one is scheduled.
        status: data.scheduledAt <= new Date() ? 'COMPLETED' : 'SCHEDULED',
        createdById: userId,
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  async teacherUpdate(scope: TeacherScope, id: string, dto: SessionFields & { status?: CounselingStatus }) {
    await this.ownSession(scope, id);
    await this.requireVisibleStudent(scope, dto.studentId);
    await this.prisma.counselingSession.update({
      where: { id },
      data: { ...sessionData(dto), ...(dto.status && { status: dto.status }) },
    });
    return { id };
  }

  async teacherRemove(scope: TeacherScope, id: string) {
    await this.ownSession(scope, id);
    await this.prisma.counselingSession.delete({ where: { id } });
    return { ok: true };
  }

  // Helpers

  private countBetween(schoolId: string, from: Date, to: Date) {
    return this.prisma.counselingSession.count({
      where: { schoolId, scheduledAt: { gte: from, lt: to }, status: { not: 'CANCELLED' } },
    });
  }

  private requireTeacher(scope: TeacherScope) {
    if (!scope.active || !scope.facultyId) throw new ForbiddenException('Only active faculty can log sessions');
    return scope.facultyId;
  }

  private async find(schoolId: string, id: string) {
    const row = await this.prisma.counselingSession.findFirst({
      where: { id, schoolId },
      select: { counselorUserId: true, counselorFacultyId: true },
    });
    if (!row) throw new NotFoundException('Session not found');
    return row;
  }

  private async ownSession(scope: TeacherScope, id: string) {
    const facultyId = this.requireTeacher(scope);
    const row = await this.prisma.counselingSession.findFirst({
      where: { id, schoolId: scope.schoolId, counselorFacultyId: facultyId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Session not found');
  }

  private async requireStudent(schoolId: string, studentId: string) {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, schoolId },
      select: { id: true },
    });
    if (!student) throw new BadRequestException('Select a student from this school');
  }

  private async requireVisibleStudent(scope: TeacherScope, studentId: string) {
    const visible = this.students.teacherWhere(scope);
    const student = visible
      ? await this.prisma.student.findFirst({
          where: { AND: [visible, { id: studentId }] },
          select: { id: true },
        })
      : null;
    if (!student) throw new BadRequestException('Select one of your students');
  }

  private async resolveCounselor(schoolId: string, key: string) {
    const [kind, id] = key.split(':');
    if (kind === 'admin') {
      const membership = await this.prisma.schoolMembership.findFirst({
        where: { schoolId, userId: id, role: 'ADMIN', status: 'ACTIVE' },
        include: { user: { select: { fullName: true } } },
      });
      if (!membership) throw new BadRequestException('Select a counselor from this school');
      return { counselorUserId: id, counselorFacultyId: null, counselorName: membership.user.fullName };
    }
    const faculty = await this.prisma.faculty.findFirst({
      where: { id, schoolId, status: { not: 'INACTIVE' } },
      select: { name: true },
    });
    if (!faculty) throw new BadRequestException('Select a counselor from this school');
    return { counselorUserId: null, counselorFacultyId: id, counselorName: faculty.name };
  }
}

function counselorKey(s: { counselorUserId: string | null; counselorFacultyId: string | null }) {
  if (s.counselorUserId) return `admin:${s.counselorUserId}`;
  if (s.counselorFacultyId) return `faculty:${s.counselorFacultyId}`;
  return null;
}

function filters(query: CounselingQuery): Prisma.CounselingSessionWhereInput {
  const q = query.q?.trim();
  const [kind, id] = query.counselor?.split(':') ?? [];
  return {
    ...(query.status && { status: query.status }),
    ...(query.type && { type: query.type }),
    ...(query.flagged && { flagged: true }),
    ...(query.studentId && { studentId: query.studentId }),
    ...(kind === 'admin' && { counselorUserId: id }),
    ...(kind === 'faculty' && { counselorFacultyId: id }),
    ...(q && {
      OR: [
        { student: { fullName: { contains: q, mode: 'insensitive' } } },
        { counselorName: { contains: q, mode: 'insensitive' } },
      ],
    }),
  };
}

function sessionData(dto: SessionFields) {
  return {
    studentId: dto.studentId,
    type: dto.type,
    scheduledAt: istInstant(dto.date, dto.time, 'Date'),
    durationMinutes: dto.durationMinutes,
    nextSessionDate: dto.nextSessionDate ? parseDate(dto.nextSessionDate, 'Next session date') : null,
    notes: dto.notes ?? null,
    actionItems: dto.actionItems ?? null,
  };
}

function toSession(s: SessionRow) {
  const [date, time] = istParts(s.scheduledAt);
  return {
    id: s.id,
    student: {
      id: s.student.id,
      fullName: s.student.fullName,
      rollNumber: s.student.rollNumber,
      classLevel: s.student.classLevel,
      batch: s.student.batch?.name ?? null,
    },
    counselor: { key: counselorKey(s), name: s.counselorName },
    type: s.type,
    status: s.status,
    scheduledAt: s.scheduledAt.toISOString(),
    date,
    time,
    durationMinutes: s.durationMinutes,
    nextSessionDate: toIsoDate(s.nextSessionDate),
    notes: s.notes,
    actionItems: s.actionItems,
    flagged: s.flagged,
  };
}
