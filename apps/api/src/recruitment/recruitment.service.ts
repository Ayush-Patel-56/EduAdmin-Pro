import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessService } from '../academic/access.service.js';
import { parseDate, toIsoDate } from '../common/dates.js';
import { normalizeIndianMobile } from '../common/validators.js';
import type { CandidateStage, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type Actor, diff, snapshot, writeAudit } from './audit.js';
import type {
  AppraisalDto,
  CandidateDto,
  InterviewDto,
  JobRequirementDto,
} from './recruitment.dto.js';
import { ACTIVE_STAGES, PIPELINE_STAGES } from './recruitment-options.js';

type Tx = Prisma.TransactionClient;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const TX = { timeout: 20_000, maxWait: 10_000 };

const REQUIREMENT_FIELDS = [
  'title',
  'subject',
  'department',
  'vacancies',
  'status',
  'experience',
  'qualification',
  'postingDate',
  'closingDate',
] as const;
const CANDIDATE_FIELDS = [
  'fullName',
  'roleApplied',
  'email',
  'phone',
  'department',
  'experienceYears',
  'stage',
  'qualification',
  'currentOrganization',
  'expectedSalary',
  'resumeUrl',
] as const;
const INTERVIEW_FIELDS = [
  'scheduledAt',
  'mode',
  'location',
  'panel',
  'rating',
  'result',
  'feedback',
] as const;
const APPRAISAL_FIELDS = [
  'facultyId',
  'department',
  'period',
  'academicYear',
  'status',
  'teachingScore',
  'punctualityScore',
  'overallBadge',
  'remarks',
  'improvementAreas',
] as const;

const STAGE_LABEL: Record<CandidateStage, string> = {
  APPLIED: 'Applied',
  SHORTLISTED: 'Shortlisted',
  INTERVIEW_SCHEDULED: 'Interview Scheduled',
  UNDER_REVIEW: 'Under Review',
  OFFER_EXTENDED: 'Offer Extended',
  HIRED: 'Hired',
  REJECTED: 'Rejected',
};

export type ListFilters = {
  schoolId?: string;
  q?: string;
  department?: string;
  stage?: string;
};

/**
 * Recruitment & staff appraisals (PRD §4.4). Views span every school the
 * caller administers; each record belongs to one school, and every query is
 * limited to the caller's own admin schools. Every change writes an
 * immutable audit row in the same transaction.
 */
@Injectable()
export class RecruitmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  /** The caller's admin schools, or just `schoolId` if it is one of them. */
  async scope(userId: string, schoolId?: string) {
    const ids = await this.access.adminSchoolIds(userId);
    if (ids.length === 0) {
      // Teacher accounts never reach recruitment; an admin without schools just sees nothing.
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { accountType: true },
      });
      if (user.accountType !== 'ADMIN')
        throw new ForbiddenException('Recruitment is for school admins');
    }
    if (schoolId) {
      if (!ids.includes(schoolId))
        throw new NotFoundException('School not found');
      return [schoolId];
    }
    return ids;
  }

  async actor(
    userId: string,
    ip: string | undefined,
    userAgent: string | undefined,
  ): Promise<Actor> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { fullName: true },
    });
    return {
      userId,
      name: user.fullName,
      ip: ip ?? null,
      userAgent: userAgent ?? null,
    };
  }

  // Overview

  async overview(userId: string, schoolId?: string) {
    const all = await this.scope(userId);
    const board = schoolId ? await this.scope(userId, schoolId) : all;
    const inAll = { schoolId: { in: all } };
    const now = new Date();
    const weekAgo = new Date(now.getTime() - WEEK_MS);
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));

    const [
      openReqs,
      activeCandidates,
      upcoming,
      pendingAppraisals,
      hiredThisYear,
      newThisWeek,
      pipeline,
      counts,
    ] = await Promise.all([
      this.prisma.jobRequirement.findMany({
        where: { ...inAll, status: 'OPEN' },
        select: { vacancies: true, createdAt: true },
      }),
      this.prisma.candidate.findMany({
        where: { ...inAll, stage: { in: [...ACTIVE_STAGES] } },
        select: { createdAt: true },
      }),
      this.prisma.interview.findMany({
        where: { ...inAll, result: 'PENDING', scheduledAt: { gte: now } },
        select: { createdAt: true },
      }),
      this.prisma.teacherAppraisal.findMany({
        where: { ...inAll, status: { not: 'COMPLETED' } },
        select: { createdAt: true },
      }),
      this.prisma.candidate.findMany({
        where: { ...inAll, stage: 'HIRED', hiredAt: { gte: yearStart } },
        select: { hiredAt: true },
      }),
      Promise.resolve(weekAgo),
      this.prisma.candidate.findMany({
        where: { schoolId: { in: board }, stage: { in: [...PIPELINE_STAGES] } },
        orderBy: { stageChangedAt: 'desc' },
        include: { school: { select: { name: true } } },
      }),
      Promise.all([
        this.prisma.jobRequirement.count({ where: inAll }),
        this.prisma.candidate.count({ where: inAll }),
        this.prisma.interview.count({ where: inAll }),
        this.prisma.teacherAppraisal.count({ where: inAll }),
        this.prisma.recruitmentAuditLog.count({ where: inAll }),
      ]),
    ]);
    const thisWeek = (dates: (Date | null)[]) =>
      dates.filter((d) => d && d >= newThisWeek).length;

    return {
      kpis: {
        openVacancies: {
          value: openReqs.reduce((sum, r) => sum + r.vacancies, 0),
          roles: openReqs.length,
          newThisWeek: thisWeek(openReqs.map((r) => r.createdAt)),
        },
        activeCandidates: {
          value: activeCandidates.length,
          newThisWeek: thisWeek(activeCandidates.map((c) => c.createdAt)),
        },
        interviewsScheduled: {
          value: upcoming.length,
          newThisWeek: thisWeek(upcoming.map((i) => i.createdAt)),
        },
        pendingAppraisals: {
          value: pendingAppraisals.length,
          newThisWeek: thisWeek(pendingAppraisals.map((a) => a.createdAt)),
        },
        hiredThisYear: {
          value: hiredThisYear.length,
          newThisWeek: thisWeek(hiredThisYear.map((c) => c.hiredAt)),
        },
      },
      pipeline: pipeline.map((c) => ({
        id: c.id,
        fullName: c.fullName,
        roleApplied: c.roleApplied,
        department: c.department,
        stage: c.stage,
        schoolId: c.schoolId,
        schoolName: c.school.name,
        stageChangedAt: c.stageChangedAt.toISOString(),
      })),
      counts: {
        requirements: counts[0],
        candidates: counts[1],
        interviews: counts[2],
        appraisals: counts[3],
        auditEvents: counts[4],
      },
    };
  }

  // Job requirements

  async listRequirements(userId: string, f: ListFilters) {
    const ids = await this.scope(userId, f.schoolId);
    const rows = await this.prisma.jobRequirement.findMany({
      where: {
        schoolId: { in: ids },
        ...(f.department && { department: f.department }),
        ...(f.q && {
          OR: ['title', 'subject', 'department', 'qualification'].map((k) => ({
            [k]: { contains: f.q, mode: 'insensitive' },
          })),
        }),
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: { school: { select: { name: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      schoolId: r.schoolId,
      schoolName: r.school.name,
      title: r.title,
      subject: r.subject,
      department: r.department,
      vacancies: r.vacancies,
      status: r.status,
      experience: r.experience,
      qualification: r.qualification,
      postingDate: toIsoDate(r.postingDate),
      closingDate: toIsoDate(r.closingDate),
    }));
  }

  async createRequirement(actor: Actor, dto: JobRequirementDto) {
    await this.scope(actor.userId, dto.schoolId);
    const data = requirementData(dto);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.jobRequirement.create({
        data: { schoolId: dto.schoolId, ...data, createdById: actor.userId },
      });
      await writeAudit(tx, actor, {
        schoolId: row.schoolId,
        action: 'CREATE',
        entity: 'JobRequirement',
        recordId: row.id,
        summary: `Posted "${row.title}" (${row.vacancies} vacanc${row.vacancies === 1 ? 'y' : 'ies'})`,
        changes: snapshot(row, [...REQUIREMENT_FIELDS]),
      });
      return { id: row.id };
    }, TX);
  }

  async updateRequirement(actor: Actor, id: string, dto: JobRequirementDto) {
    const ids = await this.scope(actor.userId);
    const before = await this.prisma.jobRequirement.findFirst({
      where: { id, schoolId: { in: ids } },
    });
    if (!before) throw new NotFoundException('Job requirement not found');
    if (dto.schoolId !== before.schoolId)
      throw new BadRequestException(
        'A requirement can’t be moved to another school',
      );
    const data = requirementData(dto);
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.jobRequirement.update({ where: { id }, data });
      const changes = diff(before, after, [...REQUIREMENT_FIELDS]);
      if (Object.keys(changes).length > 0) {
        await writeAudit(tx, actor, {
          schoolId: after.schoolId,
          action: 'UPDATE',
          entity: 'JobRequirement',
          recordId: id,
          summary: `Updated "${after.title}": ${Object.keys(changes).join(', ')}`,
          changes,
        });
      }
      return { id };
    }, TX);
  }

  async deleteRequirement(actor: Actor, id: string) {
    const ids = await this.scope(actor.userId);
    const row = await this.prisma.jobRequirement.findFirst({
      where: { id, schoolId: { in: ids } },
    });
    if (!row) throw new NotFoundException('Job requirement not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.jobRequirement.delete({ where: { id } });
      await writeAudit(tx, actor, {
        schoolId: row.schoolId,
        action: 'DELETE',
        entity: 'JobRequirement',
        recordId: id,
        summary: `Deleted "${row.title}"`,
        changes: snapshot(row, [...REQUIREMENT_FIELDS]),
      });
    }, TX);
    return { ok: true };
  }

  // Candidates

  async listCandidates(userId: string, f: ListFilters) {
    const ids = await this.scope(userId, f.schoolId);
    const rows = await this.prisma.candidate.findMany({
      where: {
        schoolId: { in: ids },
        ...(f.stage && { stage: f.stage as CandidateStage }),
        ...(f.q && {
          OR: [
            'fullName',
            'roleApplied',
            'email',
            'department',
            'currentOrganization',
          ].map((k) => ({
            [k]: { contains: f.q, mode: 'insensitive' },
          })),
        }),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        school: { select: { name: true } },
        _count: { select: { interviews: true } },
      },
    });
    return rows.map((c) => ({
      id: c.id,
      schoolId: c.schoolId,
      schoolName: c.school.name,
      fullName: c.fullName,
      roleApplied: c.roleApplied,
      email: c.email,
      phone: c.phone,
      department: c.department,
      experienceYears: c.experienceYears,
      stage: c.stage,
      qualification: c.qualification,
      currentOrganization: c.currentOrganization,
      expectedSalary: c.expectedSalary,
      resumeUrl: c.resumeUrl,
      interviewCount: c._count.interviews,
      createdAt: c.createdAt.toISOString(),
    }));
  }

  async createCandidate(actor: Actor, dto: CandidateDto) {
    await this.scope(actor.userId, dto.schoolId);
    const data = candidateData(dto);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.candidate.create({
        data: {
          schoolId: dto.schoolId,
          ...data,
          hiredAt: data.stage === 'HIRED' ? new Date() : null,
          createdById: actor.userId,
        },
      });
      await writeAudit(tx, actor, {
        schoolId: row.schoolId,
        action: 'CREATE',
        entity: 'Candidate',
        recordId: row.id,
        summary: `Added candidate ${row.fullName} for ${row.roleApplied} (${STAGE_LABEL[row.stage]})`,
        changes: snapshot(row, [...CANDIDATE_FIELDS]),
      });
      const faculty =
        row.stage === 'HIRED' ? await onboard(tx, actor, row) : null;
      return { id: row.id, facultyCreated: faculty };
    }, TX);
  }

  async updateCandidate(actor: Actor, id: string, dto: CandidateDto) {
    const before = await this.findCandidate(actor.userId, id);
    if (dto.schoolId !== before.schoolId)
      throw new BadRequestException(
        'A candidate can’t be moved to another school',
      );
    return this.saveCandidate(actor, before, candidateData(dto));
  }

  /** Moving a card on the pipeline board. */
  async setStage(actor: Actor, id: string, stage: CandidateStage) {
    const before = await this.findCandidate(actor.userId, id);
    return this.saveCandidate(actor, before, { stage });
  }

  async deleteCandidate(actor: Actor, id: string) {
    const row = await this.findCandidate(actor.userId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.candidate.delete({ where: { id } });
      await writeAudit(tx, actor, {
        schoolId: row.schoolId,
        action: 'DELETE',
        entity: 'Candidate',
        recordId: id,
        summary: `Deleted candidate ${row.fullName} (and their interviews)`,
        changes: snapshot(row, [...CANDIDATE_FIELDS]),
      });
    }, TX);
    return { ok: true };
  }

  private async saveCandidate(
    actor: Actor,
    before: Awaited<ReturnType<RecruitmentService['findCandidate']>>,
    data: Partial<ReturnType<typeof candidateData>>,
  ) {
    const stageChanged =
      data.stage !== undefined && data.stage !== before.stage;
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.candidate.update({
        where: { id: before.id },
        data: {
          ...data,
          ...(stageChanged && {
            stageChangedAt: new Date(),
            hiredAt: data.stage === 'HIRED' ? new Date() : null,
          }),
        },
      });
      const changes = diff(before, after, [...CANDIDATE_FIELDS]);
      if (Object.keys(changes).length > 0) {
        await writeAudit(tx, actor, {
          schoolId: after.schoolId,
          action: 'UPDATE',
          entity: 'Candidate',
          recordId: after.id,
          summary: stageChanged
            ? `${after.fullName}: ${STAGE_LABEL[before.stage]} → ${STAGE_LABEL[after.stage]}`
            : `Updated ${after.fullName}: ${Object.keys(changes).join(', ')}`,
          changes,
        });
      }
      const faculty =
        stageChanged && after.stage === 'HIRED'
          ? await onboard(tx, actor, after)
          : null;
      return { id: after.id, facultyCreated: faculty };
    }, TX);
  }

  private async findCandidate(userId: string, id: string) {
    const ids = await this.scope(userId);
    const row = await this.prisma.candidate.findFirst({
      where: { id, schoolId: { in: ids } },
    });
    if (!row) throw new NotFoundException('Candidate not found');
    return row;
  }

  // Interviews

  async listInterviews(userId: string, f: ListFilters) {
    const ids = await this.scope(userId, f.schoolId);
    const rows = await this.prisma.interview.findMany({
      where: { schoolId: { in: ids } },
      orderBy: { scheduledAt: 'desc' },
      include: {
        candidate: {
          select: { id: true, fullName: true, roleApplied: true, stage: true },
        },
        school: { select: { name: true } },
      },
    });
    return rows.map((i) => ({
      id: i.id,
      schoolId: i.schoolId,
      schoolName: i.school.name,
      candidate: i.candidate,
      scheduledAt: i.scheduledAt.toISOString(),
      mode: i.mode,
      location: i.location,
      panel: i.panel,
      rating: i.rating,
      result: i.result,
      feedback: i.feedback,
    }));
  }

  /**
   * Logs an interview. A candidate still at Applied or Shortlisted moves to
   * Interview Scheduled, so the board reflects the booking.
   */
  async createInterview(actor: Actor, dto: InterviewDto) {
    const candidate = await this.findCandidate(actor.userId, dto.candidateId);
    const data = interviewData(dto);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.interview.create({
        data: {
          schoolId: candidate.schoolId,
          candidateId: candidate.id,
          ...data,
          createdById: actor.userId,
        },
      });
      await writeAudit(tx, actor, {
        schoolId: row.schoolId,
        action: 'CREATE',
        entity: 'Interview',
        recordId: row.id,
        summary: `Interview for ${candidate.fullName} on ${row.scheduledAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
        changes: snapshot(row, [...INTERVIEW_FIELDS]),
      });
      if (candidate.stage === 'APPLIED' || candidate.stage === 'SHORTLISTED') {
        await tx.candidate.update({
          where: { id: candidate.id },
          data: { stage: 'INTERVIEW_SCHEDULED', stageChangedAt: new Date() },
        });
        await writeAudit(tx, actor, {
          schoolId: row.schoolId,
          action: 'UPDATE',
          entity: 'Candidate',
          recordId: candidate.id,
          summary: `${candidate.fullName}: ${STAGE_LABEL[candidate.stage]} → Interview Scheduled (interview booked)`,
          changes: { stage: [candidate.stage, 'INTERVIEW_SCHEDULED'] },
        });
      }
      return { id: row.id };
    }, TX);
  }

  async updateInterview(actor: Actor, id: string, dto: InterviewDto) {
    const ids = await this.scope(actor.userId);
    const before = await this.prisma.interview.findFirst({
      where: { id, schoolId: { in: ids } },
      include: { candidate: { select: { fullName: true } } },
    });
    if (!before) throw new NotFoundException('Interview not found');
    if (dto.candidateId !== before.candidateId)
      throw new BadRequestException(
        'An interview can’t be moved to another candidate',
      );
    const data = interviewData(dto);
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.interview.update({ where: { id }, data });
      const changes = diff(before, after, [...INTERVIEW_FIELDS]);
      if (Object.keys(changes).length > 0) {
        await writeAudit(tx, actor, {
          schoolId: after.schoolId,
          action: 'UPDATE',
          entity: 'Interview',
          recordId: id,
          summary: `Updated interview of ${before.candidate.fullName}: ${Object.keys(changes).join(', ')}`,
          changes,
        });
      }
      return { id };
    }, TX);
  }

  async deleteInterview(actor: Actor, id: string) {
    const ids = await this.scope(actor.userId);
    const row = await this.prisma.interview.findFirst({
      where: { id, schoolId: { in: ids } },
      include: { candidate: { select: { fullName: true } } },
    });
    if (!row) throw new NotFoundException('Interview not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.interview.delete({ where: { id } });
      await writeAudit(tx, actor, {
        schoolId: row.schoolId,
        action: 'DELETE',
        entity: 'Interview',
        recordId: id,
        summary: `Deleted interview of ${row.candidate.fullName}`,
        changes: snapshot(row, [...INTERVIEW_FIELDS]),
      });
    }, TX);
    return { ok: true };
  }

  // Appraisals

  async listAppraisals(userId: string, f: ListFilters) {
    const ids = await this.scope(userId, f.schoolId);
    const rows = await this.prisma.teacherAppraisal.findMany({
      where: {
        schoolId: { in: ids },
        ...(f.department && { department: f.department }),
        ...(f.q && {
          OR: [
            { faculty: { name: { contains: f.q, mode: 'insensitive' } } },
            { appraiserName: { contains: f.q, mode: 'insensitive' } },
            { department: { contains: f.q, mode: 'insensitive' } },
          ],
        }),
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        faculty: { select: { id: true, name: true, subjects: true } },
        school: { select: { name: true } },
      },
    });
    return rows.map((a) => ({
      id: a.id,
      schoolId: a.schoolId,
      schoolName: a.school.name,
      faculty: a.faculty,
      department: a.department,
      period: a.period,
      academicYear: a.academicYear,
      status: a.status,
      teachingScore: a.teachingScore,
      punctualityScore: a.punctualityScore,
      studentAvg: a.studentAvg === null ? null : Number(a.studentAvg),
      overallBadge: a.overallBadge,
      remarks: a.remarks,
      improvementAreas: a.improvementAreas,
      appraiserName: a.appraiserName,
      updatedAt: a.updatedAt.toISOString(),
    }));
  }

  async createAppraisal(actor: Actor, dto: AppraisalDto) {
    await this.scope(actor.userId, dto.schoolId);
    const faculty = await this.findFaculty(dto.schoolId, dto.facultyId);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.teacherAppraisal.create({
        data: {
          schoolId: dto.schoolId,
          ...appraisalData(dto),
          appraiserId: actor.userId,
          appraiserName: actor.name,
        },
      });
      await writeAudit(tx, actor, {
        schoolId: row.schoolId,
        action: 'CREATE',
        entity: 'TeacherAppraisal',
        recordId: row.id,
        summary: `Started ${row.period.replace('_', ' ').toLowerCase()} appraisal of ${faculty.name} (${row.academicYear})`,
        changes: snapshot(row, [...APPRAISAL_FIELDS]),
      });
      return { id: row.id };
    }, TX);
  }

  async updateAppraisal(actor: Actor, id: string, dto: AppraisalDto) {
    const ids = await this.scope(actor.userId);
    const before = await this.prisma.teacherAppraisal.findFirst({
      where: { id, schoolId: { in: ids } },
    });
    if (!before) throw new NotFoundException('Appraisal not found');
    if (dto.schoolId !== before.schoolId)
      throw new BadRequestException(
        'An appraisal can’t be moved to another school',
      );
    const faculty = await this.findFaculty(before.schoolId, dto.facultyId);
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.teacherAppraisal.update({
        where: { id },
        data: appraisalData(dto),
      });
      const changes = diff(before, after, [...APPRAISAL_FIELDS]);
      if (Object.keys(changes).length > 0) {
        await writeAudit(tx, actor, {
          schoolId: after.schoolId,
          action: 'UPDATE',
          entity: 'TeacherAppraisal',
          recordId: id,
          summary: `Updated appraisal of ${faculty.name}: ${Object.keys(changes).join(', ')}`,
          changes,
        });
      }
      return { id };
    }, TX);
  }

  async deleteAppraisal(actor: Actor, id: string) {
    const ids = await this.scope(actor.userId);
    const row = await this.prisma.teacherAppraisal.findFirst({
      where: { id, schoolId: { in: ids } },
      include: { faculty: { select: { name: true } } },
    });
    if (!row) throw new NotFoundException('Appraisal not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.teacherAppraisal.delete({ where: { id } });
      await writeAudit(tx, actor, {
        schoolId: row.schoolId,
        action: 'DELETE',
        entity: 'TeacherAppraisal',
        recordId: id,
        summary: `Deleted appraisal of ${row.faculty.name} (${row.academicYear})`,
        changes: snapshot(row, [...APPRAISAL_FIELDS]),
      });
    }, TX);
    return { ok: true };
  }

  private async findFaculty(schoolId: string, facultyId: string) {
    // Scoped to the appraisal's school: another school's teacher is "not found".
    const faculty = await this.prisma.faculty.findFirst({
      where: { id: facultyId, schoolId },
      select: { name: true },
    });
    if (!faculty)
      throw new BadRequestException('Select a teacher from this school');
    return faculty;
  }

  // Audit trail (read-only)

  async auditLog(userId: string, schoolId?: string) {
    const ids = await this.scope(userId, schoolId);
    const [total, rows] = await Promise.all([
      this.prisma.recruitmentAuditLog.count({
        where: { schoolId: { in: ids } },
      }),
      this.prisma.recruitmentAuditLog.findMany({
        where: { schoolId: { in: ids } },
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
    ]);
    const schools = await this.prisma.school.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const schoolName = new Map(schools.map((s) => [s.id, s.name]));
    return {
      total,
      events: rows.map((r) => ({
        id: r.id,
        schoolName: schoolName.get(r.schoolId) ?? null,
        action: r.action,
        entity: r.entity,
        recordId: r.recordId,
        summary: r.summary,
        changes: r.changes,
        actorName: r.actorName,
        ip: r.ip,
        userAgent: r.userAgent,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}

/**
 * A hired candidate becomes a faculty profile in the school (unless one with
 * the same email already exists), so onboarding continues in Academic Planning.
 */
async function onboard(
  tx: Tx,
  actor: Actor,
  c: {
    schoolId: string;
    id: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    qualification: string | null;
    department: string | null;
    experienceYears: number | null;
  },
) {
  if (c.email) {
    const existing = await tx.faculty.findUnique({
      where: { schoolId_email: { schoolId: c.schoolId, email: c.email } },
      select: { id: true },
    });
    if (existing) return null;
  }
  const today = new Date();
  const faculty = await tx.faculty.create({
    data: {
      schoolId: c.schoolId,
      name: c.fullName,
      email: c.email,
      phone: c.phone,
      qualification: c.qualification,
      experienceYears: c.experienceYears,
      subjects: c.department ? [c.department] : [],
      joiningDate: new Date(
        Date.UTC(
          today.getUTCFullYear(),
          today.getUTCMonth(),
          today.getUTCDate(),
        ),
      ),
      status: 'ACTIVE',
    },
  });
  await writeAudit(tx, actor, {
    schoolId: c.schoolId,
    action: 'CREATE',
    entity: 'Faculty',
    recordId: faculty.id,
    summary: `Onboarded hired candidate ${c.fullName} as faculty`,
    changes: { candidateId: c.id, name: c.fullName, email: c.email },
  });
  return { id: faculty.id, name: faculty.name };
}

function requirementData(dto: JobRequirementDto) {
  const postingDate = dto.postingDate
    ? parseDate(dto.postingDate, 'Posting date')
    : null;
  const closingDate = dto.closingDate
    ? parseDate(dto.closingDate, 'Closing date')
    : null;
  if (postingDate && closingDate && closingDate < postingDate) {
    throw new BadRequestException(
      'Closing date must be on or after the posting date',
    );
  }
  return {
    title: dto.title,
    subject: dto.subject,
    department: dto.department,
    vacancies: dto.vacancies,
    status: dto.status,
    experience: dto.experience ?? null,
    qualification: dto.qualification ?? null,
    postingDate,
    closingDate,
  };
}

function candidateData(dto: CandidateDto) {
  return {
    fullName: dto.fullName,
    roleApplied: dto.roleApplied,
    email: dto.email?.toLowerCase() ?? null,
    phone: dto.phone ? normalizeIndianMobile(dto.phone) : null,
    department: dto.department ?? null,
    experienceYears: dto.experienceYears ?? null,
    stage: dto.stage,
    qualification: dto.qualification ?? null,
    currentOrganization: dto.currentOrganization ?? null,
    expectedSalary: dto.expectedSalary ?? null,
    resumeUrl: dto.resumeUrl ?? null,
  };
}

function interviewData(dto: InterviewDto) {
  const scheduledAt = new Date(dto.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime()))
    throw new BadRequestException('Date & time is invalid');
  return {
    scheduledAt,
    mode: dto.mode,
    location: dto.location ?? null,
    panel: dto.panel ?? null,
    rating: dto.rating ?? null,
    result: dto.result,
    feedback: dto.feedback ?? null,
  };
}

function appraisalData(dto: AppraisalDto) {
  return {
    facultyId: dto.facultyId,
    department: dto.department ?? null,
    period: dto.period,
    academicYear: dto.academicYear,
    status: dto.status,
    teachingScore: dto.teachingScore ?? null,
    punctualityScore: dto.punctualityScore ?? null,
    overallBadge: dto.overallBadge ?? null,
    remarks: dto.remarks ?? null,
    improvementAreas: dto.improvementAreas ?? null,
  };
}
