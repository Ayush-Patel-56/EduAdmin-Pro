import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthContext } from '../auth/session.guard.js';
import { generateJoinCode } from '../auth/tokens.js';
import { normalizeIndianMobile } from '../common/validators.js';
import type { CreateSchoolDto } from './schools.dto.js';
import {
  CLASS_OPTIONS,
  classesLabel,
  DEFAULT_SELECTION,
  MONTHS,
  orderClasses,
  STANDARD_BOARDS,
  STANDARD_PROGRAMS,
} from './school-options.js';

type Tx = Prisma.TransactionClient;
export type MouStatus = 'NOT_SET' | 'UPCOMING' | 'ACTIVE' | 'EXPIRED';

@Injectable()
export class SchoolsService {
  private readonly logger = new Logger(SchoolsService.name);

  constructor(private readonly prisma: PrismaService) {}

  options() {
    return {
      boards: STANDARD_BOARDS,
      classes: CLASS_OPTIONS,
      programs: STANDARD_PROGRAMS,
      months: MONTHS,
      defaults: DEFAULT_SELECTION,
    };
  }

  async createSchool(auth: AuthContext, dto: CreateSchoolDto) {
    await this.assertAdminAccount(auth.userId);

    const mouStart = dto.mouStartDate ? parseDate(dto.mouStartDate, 'MOU start date') : null;
    const mouEnd = dto.mouEndDate ? parseDate(dto.mouEndDate, 'MOU end date') : null;
    if (mouStart && mouEnd && mouEnd < mouStart) {
      throw new BadRequestException('MOU end date must be on or after the start date');
    }
    const programs = dedupePrograms(dto.programs);

    return this.prisma.$transaction(async (tx) => {
      const inviteCode = await uniqueSchoolCode(tx);
      let adminInviteCode = await uniqueSchoolCode(tx);
      while (adminInviteCode === inviteCode) adminInviteCode = await uniqueSchoolCode(tx);
      const school = await tx.school.create({
        data: {
          name: dto.name,
          inviteCode,
          adminInviteCode,
          board: dto.board,
          classes: orderClasses(dto.classes),
          academicYearStartMonth: dto.academicYearStartMonth ?? DEFAULT_SELECTION.academicYearStartMonth,
          mouStartDate: mouStart,
          mouEndDate: mouEnd,
          contactPerson: dto.contactPerson ?? null,
          phone: dto.phone ? normalizeIndianMobile(dto.phone) : null,
          email: dto.email?.toLowerCase() ?? null,
          address: dto.address ?? null,
          gstNumber: dto.gstNumber ?? null,
          createdById: auth.userId,
        },
      });
      if (programs.length > 0) {
        await tx.program.createMany({
          data: programs.map((name, i) => ({
            schoolId: school.id,
            name,
            isStandard: (STANDARD_PROGRAMS as readonly string[]).includes(name),
            sortOrder: i,
          })),
        });
      }
      await tx.schoolMembership.create({
        data: { userId: auth.userId, schoolId: school.id, role: 'ADMIN', status: 'ACTIVE' },
      });
      await tx.announcement.create({
        data: {
          schoolId: school.id,
          category: 'GENERAL',
          title: `Welcome to ${school.name}!`,
          createdById: auth.userId,
        },
      });
      await tx.session.update({ where: { id: auth.sessionId }, data: { activeSchoolId: school.id } });
      return { id: school.id, name: school.name };
    });
  }

  /**
   * Join a school with one of its two invite codes. The role comes from the
   * code, never from the account alone:
   *  - the teacher code joins a teacher account as a teacher (and leaves any
   *    school they were in, since teachers belong to one school at a time);
   *  - the admin code joins an admin account as an admin (any number of schools).
   * A code of the wrong kind is refused, so sharing the teacher code with
   * staff can never hand out admin rights.
   */
  async joinSchool(auth: AuthContext, inviteCode: string) {
    const { accountType } = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { accountType: true },
    });
    const school = await this.prisma.school.findFirst({
      where: { OR: [{ inviteCode }, { adminInviteCode: inviteCode }] },
    });
    if (!school) throw new BadRequestException('Invalid invite code');
    const isAdminCode = school.adminInviteCode === inviteCode;
    if (isAdminCode && accountType !== 'ADMIN') {
      throw new ForbiddenException('That code is for school administrators. Ask your school for the teacher code.');
    }
    if (!isAdminCode && accountType === 'ADMIN') {
      throw new ForbiddenException('That is the teacher code. Ask the school owner for the school’s admin invite code.');
    }

    const existing = await this.prisma.schoolMembership.findUnique({
      where: { userId_schoolId: { userId: auth.userId, schoolId: school.id } },
    });
    if (existing?.status === 'ACTIVE') {
      throw new ConflictException(`You're already a member of ${school.name}`);
    }
    if (existing?.status === 'REVOKED') {
      throw new ForbiddenException(`Your access to ${school.name} was removed by its admins`);
    }
    const role = accountType === 'ADMIN' ? 'ADMIN' : 'TEACHER';
    await this.prisma.$transaction([
      ...(accountType === 'TEACHER'
        ? [
            this.prisma.schoolMembership.updateMany({
              where: { userId: auth.userId, status: 'ACTIVE', schoolId: { not: school.id } },
              data: { status: 'LEFT' },
            }),
          ]
        : []),
      this.prisma.schoolMembership.upsert({
        where: { userId_schoolId: { userId: auth.userId, schoolId: school.id } },
        create: { userId: auth.userId, schoolId: school.id, role, status: 'ACTIVE' },
        update: { role, status: 'ACTIVE' },
      }),
      this.prisma.session.update({ where: { id: auth.sessionId }, data: { activeSchoolId: school.id } }),
    ]);
    return { id: school.id, name: school.name };
  }

  /** The signed-in teacher's portal home. `school` is null until they join one. */
  async teacherDashboard(auth: AuthContext) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { accountType: true } });
    if (user.accountType !== 'TEACHER') throw new ForbiddenException('Only teacher accounts have a faculty portal');
    const membership = await this.prisma.schoolMembership.findFirst({
      where: { userId: auth.userId, role: 'TEACHER', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      include: {
        school: {
          include: {
            programs: { orderBy: { sortOrder: 'asc' }, select: { id: true, name: true } },
            announcements: {
              orderBy: { createdAt: 'desc' },
              take: 5,
              select: { id: true, category: true, title: true, createdAt: true },
            },
          },
        },
      },
    });
    const school = membership?.school;
    return {
      school: school
        ? {
            id: school.id,
            name: school.name,
            board: school.board,
            classes: school.classes,
            mouStartDate: toIsoDate(school.mouStartDate),
            mouEndDate: toIsoDate(school.mouEndDate),
            mouStatus: mouStatus(school.mouStartDate, school.mouEndDate),
          }
        : null,
      programs: school?.programs ?? [],
      announcements: school?.announcements ?? [],
      // The counts, schedule and feedback below are filled in as timetables,
      // daily reports, assignments, tests and admin feedback are built.
      stats: { todayClasses: 0, pendingDailyReports: 0, assignmentsToGrade: 0, upcomingTests: 0 },
      todaySchedule: [],
      adminFeedback: [],
    };
  }

  async dashboard(auth: AuthContext, schoolId: string) {
    await this.assertSchoolAdmin(auth.userId, schoolId);
    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      include: {
        programs: { orderBy: { sortOrder: 'asc' }, select: { id: true, name: true } },
        announcements: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, category: true, title: true, createdAt: true },
        },
      },
    });
    return {
      school: {
        id: school.id,
        name: school.name,
        inviteCode: school.inviteCode,
        adminInviteCode: school.adminInviteCode,
        board: school.board,
        classes: school.classes,
        classesLabel: classesLabel(school.classes),
        academicYearStartMonth: school.academicYearStartMonth,
        mouStartDate: toIsoDate(school.mouStartDate),
        mouEndDate: toIsoDate(school.mouEndDate),
        mouStatus: mouStatus(school.mouStartDate, school.mouEndDate),
      },
      programs: school.programs,
      announcements: school.announcements,
      // Populated once timetables exist; kept in the response shape so the UI is final.
      todaySchedule: [],
    };
  }

  /**
   * Replaces one of the school's invite codes with a fresh one; the old code
   * stops working immediately. Existing members keep their access: only new
   * joins are affected. Any admin of the school may rotate either code.
   */
  async regenerateCode(auth: AuthContext, schoolId: string, kind: 'ADMIN' | 'TEACHER') {
    await this.assertSchoolAdmin(auth.userId, schoolId);
    const school = await this.prisma.$transaction(async (tx) => {
      const code = await uniqueSchoolCode(tx);
      return tx.school.update({
        where: { id: schoolId },
        data: kind === 'ADMIN' ? { adminInviteCode: code } : { inviteCode: code },
        select: { inviteCode: true, adminInviteCode: true },
      });
    });
    this.logger.warn(`${kind} invite code of school ${schoolId} regenerated by user ${auth.userId}`);
    return school;
  }

  private async assertAdminAccount(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { accountType: true },
    });
    if (user.accountType !== 'ADMIN') {
      throw new ForbiddenException('Only administration accounts can do this');
    }
  }

  private async assertSchoolAdmin(userId: string, schoolId: string) {
    const membership = await this.prisma.schoolMembership.findUnique({
      where: { userId_schoolId: { userId, schoolId } },
    });
    if (!membership) throw new NotFoundException('School not found');
    if (membership.role !== 'ADMIN' || membership.status !== 'ACTIVE') {
      throw new ForbiddenException('Only admins of this school can view this');
    }
  }
}

/** Case-insensitive dedupe that keeps the first spelling and the user's order. */
function dedupePrograms(programs: string[]): string[] {
  const seen = new Set<string>();
  return programs.filter((p) => {
    const key = p.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseDate(value: string, label: string): Date {
  const date = new Date(`${value}T00:00:00Z`);
  // Rejects impossible dates like 2026-02-30, which Date would roll over.
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${label} is invalid`);
  }
  return date;
}

function toIsoDate(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

export function mouStatus(start: Date | null, end: Date | null, now = new Date()): MouStatus {
  if (!start && !end) return 'NOT_SET';
  const today = now.toISOString().slice(0, 10);
  if (start && today < toIsoDate(start)!) return 'UPCOMING';
  if (end && today > toIsoDate(end)!) return 'EXPIRED';
  return 'ACTIVE';
}

// Collisions are astronomically rare, but a failed insert would abort the
// surrounding transaction, so check first rather than catching the error.
async function uniqueSchoolCode(tx: Tx) {
  for (;;) {
    const code = generateJoinCode();
    // A code is unique across both columns, so one code never means two things.
    const taken = await tx.school.findFirst({
      where: { OR: [{ inviteCode: code }, { adminInviteCode: code }] },
      select: { id: true },
    });
    if (!taken) return code;
  }
}
