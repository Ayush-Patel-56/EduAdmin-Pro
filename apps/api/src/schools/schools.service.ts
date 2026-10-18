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
import { AccessService } from '../academic/access.service.js';
import { standardProgramDefaults } from '../academic/academic-options.js';
import { deactivateFacultyProfiles, linkFacultyProfile } from '../academic/faculty-link.js';
import { actorFromUser, writeAudit } from '../recruitment/audit.js';
import type { AuthContext } from '../auth/session.guard.js';
import { generateJoinCode } from '../auth/tokens.js';
import { istToday, parseDate, toIsoDate } from '../common/dates.js';
import { normalizeIndianMobile } from '../common/validators.js';
import { duplicateAsConflict } from '../common/unique-violation.js';
import { unlinkProgramChapters } from '../curriculum/unlink-program-chapters.js';
import { pendingReports } from '../daily-reports/daily-reports.service.js';
import { receivedBy } from '../feedback/feedback.service.js';
import { FilesService } from '../storage/files.service.js';
import { ScheduleService } from '../schedule/schedule.service.js';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly files: FilesService,
    private readonly schedule: ScheduleService,
  ) {}

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

    const { mouStart, mouEnd } = mouRange(dto);
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
          data: programs.map((name, i) => newProgram(school.id, name, i)),
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
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { id: true, accountType: true, email: true, fullName: true, department: true },
    });
    const { accountType } = user;
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
    await this.prisma.$transaction(async (tx) => {
      if (accountType === 'TEACHER') {
        await tx.schoolMembership.updateMany({
          where: { userId: auth.userId, status: 'ACTIVE', schoolId: { not: school.id } },
          data: { status: 'LEFT' },
        });
        await deactivateFacultyProfiles(tx, auth.userId, school.id);
      }
      await tx.schoolMembership.upsert({
        where: { userId_schoolId: { userId: auth.userId, schoolId: school.id } },
        create: { userId: auth.userId, schoolId: school.id, role, status: 'ACTIVE' },
        update: { role, status: 'ACTIVE' },
      });
      if (accountType === 'TEACHER') await linkFacultyProfile(tx, school.id, user);
      await tx.session.update({ where: { id: auth.sessionId }, data: { activeSchoolId: school.id } });
    });
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
    // Work handed in (or late) but not graded yet, in the teacher's batches.
    const faculty = school
      ? await this.prisma.faculty.findUnique({
          where: { schoolId_userId: { schoolId: school.id, userId: auth.userId } },
          select: { id: true, status: true, batchAssignments: { select: { batchId: true } } },
        })
      : null;
    const batchIds = faculty && faculty.status !== 'INACTIVE' ? faculty.batchAssignments.map((b) => b.batchId) : [];
    const [assignmentsToGrade, today, reportedToday, adminFeedback, upcomingTests] = await Promise.all([
      batchIds.length
        ? this.prisma.assignmentSubmission.count({
            where: { schoolId: school!.id, status: { in: ['SUBMITTED', 'LATE'] }, assignment: { batchId: { in: batchIds } } },
          })
        : 0,
      // Today's classes: the teacher's slots and special classes in their batches.
      school && faculty && batchIds.length
        ? this.schedule.classesOn(school.id, istToday(), { facultyId: faculty.id, batchIds })
        : [],
      // What they've already reported for today, to count the classes still waiting for one.
      school && faculty && batchIds.length
        ? this.prisma.dailyReport.findMany({
            where: { schoolId: school.id, facultyId: faculty.id, reportDate: istToday() },
            select: { batchId: true, subject: true },
          })
        : [],
      // The latest feedback from management to them (or to all faculty), while they're active.
      school && faculty && faculty.status !== 'INACTIVE'
        ? this.prisma.feedback.findMany({
            where: receivedBy(school.id, faculty.id),
            orderBy: { createdAt: 'desc' },
            take: 3,
            select: { id: true, content: true, createdAt: true },
          })
        : [],
      // Tests of their batches starting in the next 7 days.
      school && batchIds.length
        ? this.prisma.test.count({
            where: { schoolId: school.id, batchId: { in: batchIds }, status: 'SCHEDULED', startsAt: { gte: new Date(), lt: new Date(Date.now() + 7 * 86_400_000) } },
          })
        : 0,
    ]);
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
      stats: {
        todayClasses: today.length,
        pendingDailyReports: pendingReports(today, reportedToday),
        assignmentsToGrade,
        upcomingTests,
      },
      todaySchedule: today.map((c) => ({
        id: c.key,
        time: c.time,
        className: c.title,
        type: c.type,
        subject: c.subject,
        batch: c.batch.name,
        room: c.room,
      })),
      adminFeedback: adminFeedback.map((f) => ({ id: f.id, message: f.content, createdAt: f.createdAt.toISOString() })),
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
      todaySchedule: await this.schedule.adminToday(schoolId),
    };
  }

  /** Every school the user administers, with what the Schools tab cards and edit form need. */
  async mySchools(auth: AuthContext) {
    const memberships = await this.prisma.schoolMembership.findMany({
      where: { userId: auth.userId, role: 'ADMIN', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      include: {
        school: { include: { programs: { orderBy: { sortOrder: 'asc' }, select: { name: true } } } },
      },
    });
    return memberships.map(({ school }) => ({
      id: school.id,
      name: school.name,
      inviteCode: school.inviteCode,
      adminInviteCode: school.adminInviteCode,
      board: school.board,
      classes: school.classes,
      classesLabel: classesLabel(school.classes),
      academicYearStartMonth: school.academicYearStartMonth,
      programs: school.programs.map((p) => p.name),
      mouStartDate: toIsoDate(school.mouStartDate),
      mouEndDate: toIsoDate(school.mouEndDate),
      mouStatus: mouStatus(school.mouStartDate, school.mouEndDate),
      contactPerson: school.contactPerson,
      phone: school.phone,
      email: school.email,
      address: school.address,
      gstNumber: school.gstNumber,
      isOwner: school.createdById === auth.userId,
    }));
  }

  /**
   * Owner edits the school. Programs listed in the form are kept or added;
   * a program left out is removed, but only if it has no batches.
   */
  async updateSchool(auth: AuthContext, schoolId: string, dto: CreateSchoolDto) {
    await this.access.assertOwner(auth.userId, schoolId);
    const { mouStart, mouEnd } = mouRange(dto);
    const wanted = dedupePrograms(dto.programs);
    const wantedKeys = new Set(wanted.map((p) => p.toLowerCase()));

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.program.findMany({
        where: { schoolId },
        select: { id: true, name: true, sortOrder: true, _count: { select: { batches: true } } },
      });
      const removed = existing.filter((p) => !wantedKeys.has(p.name.toLowerCase()));
      const blocked = removed.find((p) => p._count.batches > 0);
      if (blocked) {
        throw new ConflictException(
          `${blocked.name} still has ${blocked._count.batches} batch(es). Delete or move them before removing the program.`,
        );
      }
      if (removed.length > 0) {
        const ids = removed.map((p) => p.id);
        // Curriculum chapters keep existing without a program (409 if that would duplicate one).
        await unlinkProgramChapters(tx, schoolId, ids);
        await tx.student.updateMany({ where: { schoolId, programId: { in: ids } }, data: { programId: null } });
        await tx.program.deleteMany({ where: { schoolId, id: { in: ids } } });
      }
      const existingKeys = new Set(existing.map((p) => p.name.toLowerCase()));
      const added = wanted.filter((p) => !existingKeys.has(p.toLowerCase()));
      const nextOrder = Math.max(-1, ...existing.map((p) => p.sortOrder)) + 1;
      if (added.length > 0) {
        // Another request may add the same program meanwhile; the unique index decides (409, not 500).
        await duplicateAsConflict(
          () => tx.program.createMany({ data: added.map((name, i) => newProgram(schoolId, name, nextOrder + i)) }),
          'A program with one of these names was just added by someone else. Refresh and try again.',
        );
      }
      const school = await tx.school.update({
        where: { id: schoolId },
        data: {
          name: dto.name,
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
        },
      });
      return { id: school.id, name: school.name };
    });
  }

  /** What Clear All Data would remove, shown before the owner confirms. */
  async clearPreview(auth: AuthContext, schoolId: string) {
    await this.access.assertOwner(auth.userId, schoolId);
    const [programs, batches, syllabusItems, importedFaculty, announcements, promotionCycles, chapters, concepts, students, teaching, recruitment] = await Promise.all([
      this.prisma.program.count({ where: { schoolId } }),
      this.prisma.batch.count({ where: { schoolId } }),
      this.prisma.syllabusItem.count({ where: { schoolId } }),
      this.prisma.faculty.count({ where: { schoolId, userId: null } }),
      this.prisma.announcement.count({ where: { schoolId } }),
      this.prisma.promotionCycle.count({ where: { schoolId } }),
      this.prisma.curriculumChapter.count({ where: { schoolId } }),
      this.prisma.curriculumConcept.count({ where: { schoolId } }),
      this.prisma.student.count({ where: { schoolId } }),
      Promise.all([
        this.prisma.studyMaterial.count({ where: { schoolId } }),
        this.prisma.assignment.count({ where: { schoolId } }),
        this.prisma.counselingSession.count({ where: { schoolId } }),
      ]),
      Promise.all([
        this.prisma.jobRequirement.count({ where: { schoolId } }),
        this.prisma.candidate.count({ where: { schoolId } }),
        this.prisma.interview.count({ where: { schoolId } }),
        this.prisma.teacherAppraisal.count({ where: { schoolId } }),
      ]),
    ]);
    const [requirements, candidates, interviews, appraisals] = recruitment;
    const [materials, assignments, counselingSessions] = teaching;
    return {
      programs,
      batches,
      syllabusItems,
      importedFaculty,
      announcements,
      promotionCycles,
      chapters,
      concepts,
      students,
      materials,
      assignments,
      counselingSessions,
      requirements,
      candidates,
      interviews,
      appraisals,
    };
  }

  /**
   * Wipes the school's academic data but keeps the school, its members, their
   * faculty profiles and the invite code. Requires the exact school name.
   */
  async clearAllData(auth: AuthContext, schoolId: string, confirmName: string) {
    await this.access.assertOwner(auth.userId, schoolId);
    await this.assertConfirmName(schoolId, confirmName);
    const fileKeys = await this.prisma.$transaction(async (tx) => {
      const removed = await Promise.all([
        tx.jobRequirement.count({ where: { schoolId } }),
        tx.candidate.count({ where: { schoolId } }),
        tx.teacherAppraisal.count({ where: { schoolId } }),
      ]);
      await tx.interview.deleteMany({ where: { schoolId } });
      await tx.candidate.deleteMany({ where: { schoolId } });
      await tx.jobRequirement.deleteMany({ where: { schoolId } });
      await tx.teacherAppraisal.deleteMany({ where: { schoolId } });
      // The audit trail itself is never cleared; it records the wipe instead.
      await writeAudit(tx, await actorFromUser(tx, auth.userId), {
        schoolId,
        action: 'DELETE',
        entity: 'School',
        recordId: schoolId,
        summary: `Clear All Data: removed ${removed[0]} requirements, ${removed[1]} candidates (with interviews), ${removed[2]} appraisals`,
      });
      // Same transaction as the recruitment wipe above: either everything is
      // cleared (and audited) or nothing is. Students (with guardians and
      // batch history) go before the batches and programs they point at.
      await tx.counselingSession.deleteMany({ where: { schoolId } });
      // Fees: payments, then dues, then structures (each points at the one after).
      await tx.feePayment.deleteMany({ where: { schoolId } });
      await tx.feeDue.deleteMany({ where: { schoolId } });
      await tx.feeStructure.deleteMany({ where: { schoolId } });
      await tx.feeReceiptCounter.deleteMany({ where: { schoolId } });
      await tx.meeting.deleteMany({ where: { schoolId } }); // with their agenda items
      await tx.calendarEvent.deleteMany({ where: { schoolId } });
      await tx.dailyReport.deleteMany({ where: { schoolId } }); // before the batches and faculty they name
      await tx.feedback.deleteMany({ where: { schoolId } }); // before the faculty profiles it names
      await tx.ptmNote.deleteMany({ where: { schoolId } }); // before the students they are about
      await tx.dailyRating.deleteMany({ where: { schoolId } }); // before the students, batches and faculty they name
      await tx.progressReport.deleteMany({ where: { schoolId } });
      await tx.studentMark.deleteMany({ where: { schoolId } }); // before the students and batches
      await tx.testResult.deleteMany({ where: { schoolId } }); // with their answers; before the students
      await tx.test.deleteMany({ where: { schoolId } }); // with their papers; before the batches
      await tx.question.deleteMany({ where: { schoolId } }); // before the chapters and faculty they name
      // Attendance sheets (with their records) before the batches they point at.
      await tx.classOccurrence.deleteMany({ where: { schoolId } });
      await tx.specialClass.deleteMany({ where: { schoolId } });
      await tx.scheduleSlot.deleteMany({ where: { schoolId } });
      await tx.assignment.deleteMany({ where: { schoolId } }); // with their submissions
      await tx.studyMaterial.deleteMany({ where: { schoolId } });
      await tx.student.deleteMany({ where: { schoolId } });
      await tx.syllabusItem.deleteMany({ where: { schoolId } });
      await tx.curriculumConcept.deleteMany({ where: { schoolId } });
      await tx.curriculumChapter.deleteMany({ where: { schoolId } });
      await tx.facultyBatch.deleteMany({ where: { schoolId } });
      await tx.facultyProgram.deleteMany({ where: { schoolId } });
      await tx.batch.deleteMany({ where: { schoolId } });
      await tx.program.deleteMany({ where: { schoolId } });
      await tx.promotionCycle.deleteMany({ where: { schoolId } });
      await tx.announcement.deleteMany({ where: { schoolId } });
      await tx.faculty.deleteMany({ where: { schoolId, userId: null } });
      // Every uploaded file goes, except the photos of the faculty who stay.
      const unused = { schoolId, faculty: { none: {} } };
      const files = await tx.fileObject.findMany({ where: unused, select: { key: true } });
      await tx.fileObject.deleteMany({ where: unused });
      return files.map((f) => f.key);
    }, { timeout: 60_000, maxWait: 10_000 });
    // Stored bytes go once the rows are gone (best effort; nothing points at them any more).
    await this.files.removeObjects(fileKeys);
    return { ok: true };
  }

  /** Permanently deletes the school and everything in it. Owner only, name-confirmed. */
  async deleteSchool(auth: AuthContext, schoolId: string, confirmName: string) {
    await this.access.assertOwner(auth.userId, schoolId);
    await this.assertConfirmName(schoolId, confirmName);
    const fileKeys = await this.prisma.$transaction(async (tx) => {
      const files = await tx.fileObject.findMany({ where: { schoolId }, select: { key: true } });
      // Sessions only hold the id as a preference; drop it so nobody is left
      // pointing at a deleted school.
      await tx.session.updateMany({ where: { activeSchoolId: schoolId }, data: { activeSchoolId: null } });
      await writeAudit(tx, await actorFromUser(tx, auth.userId), {
        schoolId,
        action: 'DELETE',
        entity: 'School',
        recordId: schoolId,
        summary: `Deleted school "${confirmName.trim()}" with all its recruitment and appraisal records`,
      });
      await tx.school.delete({ where: { id: schoolId } });
      return files.map((f) => f.key);
    }, { timeout: 30_000 });
    await this.files.removeObjects(fileKeys);
    return { ok: true };
  }

  private async assertConfirmName(schoolId: string, confirmName: string) {
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { name: true } });
    if (confirmName.trim() !== school.name) {
      throw new BadRequestException('Type the school name exactly to confirm');
    }
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

function newProgram(schoolId: string, name: string, sortOrder: number) {
  const defaults = standardProgramDefaults(name);
  return {
    schoolId,
    name,
    type: defaults.type,
    targetExams: [...defaults.targetExams],
    themeColor: defaults.themeColor,
    isStandard: (STANDARD_PROGRAMS as readonly string[]).includes(name),
    sortOrder,
  };
}

function mouRange(dto: { mouStartDate?: string; mouEndDate?: string }) {
  const mouStart = dto.mouStartDate ? parseDate(dto.mouStartDate, 'MOU start date') : null;
  const mouEnd = dto.mouEndDate ? parseDate(dto.mouEndDate, 'MOU end date') : null;
  if (mouStart && mouEnd && mouEnd < mouStart) {
    throw new BadRequestException('MOU end date must be on or after the start date');
  }
  return { mouStart, mouEnd };
}

export function mouStatus(start: Date | null, end: Date | null, now = new Date()): MouStatus {
  if (!start && !end) return 'NOT_SET';
  // Schools run on Indian time: an MOU ending today is still active until midnight IST.
  const today = toIsoDate(istToday(now))!;
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
