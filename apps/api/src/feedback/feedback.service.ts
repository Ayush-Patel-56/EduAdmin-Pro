import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { TeacherScope } from '../academic/access.service.js';
import { type ImportPreview, parseImportDate } from '../academic/import-utils.js';
import { istToday, toIsoDate } from '../common/dates.js';
import { likeEscape } from '../common/like-escape.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { FeedbackImportDto, FeedbackQuery, FeedbackStatusDto, SendFeedbackDto, TeacherFeedbackDto } from './feedback.dto.js';
import { MAX_FEEDBACK_LENGTH } from './feedback.dto.js';
import {
  CATEGORY_LABELS,
  categoriesMatching,
  DIRECTION_LABELS,
  type FeedbackCategory,
  type FeedbackDirection,
  isAllFaculty,
  parseCategory,
  parseDirection,
  sentimentKeywords,
} from './feedback-rules.js';

/** The log shows the newest this many entries of a view; a search narrows it. */
export const FEEDBACK_LIST_LIMIT = 200;
/** How many entries each column of the faculty page shows. */
export const TEACHER_LIST_LIMIT = 100;
const KEYWORD_DAYS = 30;
const PENDING = ['SUBMITTED', 'REVIEWED'] as const;
const CLOSED = ['ACTIONED', 'DISMISSED'] as const;

type Row = Prisma.FeedbackGetPayload<object>;

/** Feedback a teacher receives: to every teacher, or to them; dismissed (archived) ones drop out. */
export const receivedBy = (schoolId: string, facultyId: string): Prisma.FeedbackWhereInput => ({
  schoolId,
  direction: 'MANAGEMENT_TO_TEACHER',
  status: { not: 'DISMISSED' },
  OR: [{ toAllFaculty: true }, { targetFacultyId: facultyId }],
});

/**
 * Feedback between management and faculty (PRD 4.12 admin, 5.13 faculty).
 * Admins see and move every entry of their school; a teacher sees what was
 * sent to them (or to all faculty) and what they sent.
 */
@Injectable()
export class FeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  // Admin

  async adminList(schoolId: string, query: FeedbackQuery) {
    const view = query.view ?? 'pending';
    const where: Prisma.FeedbackWhereInput = {
      schoolId,
      status: query.status ? query.status : { in: [...(view === 'pending' ? PENDING : CLOSED)] },
      ...(query.direction && { direction: query.direction }),
      ...searchWhere(query.q),
    };
    const today = istToday();
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const keywordFrom = new Date(today.getTime() - (KEYWORD_DAYS - 1) * 86_400_000);
    const [total, rows, thisMonth, ratings, byStatus, recent] = await Promise.all([
      this.prisma.feedback.count({ where }),
      this.prisma.feedback.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: FEEDBACK_LIST_LIMIT }),
      this.prisma.feedback.count({ where: { schoolId, feedbackDate: { gte: monthStart } } }),
      this.prisma.feedback.groupBy({ by: ['rating'], where: { schoolId }, _count: { _all: true } }),
      this.prisma.feedback.groupBy({ by: ['status'], where: { schoolId }, _count: { _all: true } }),
      this.prisma.feedback.findMany({
        where: { schoolId, feedbackDate: { gte: keywordFrom }, status: { not: 'DISMISSED' } },
        select: { content: true, rating: true },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
    ]);
    const statusCount = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
    const rated = ratings.reduce((n, r) => n + r._count._all, 0);
    const ratingSum = ratings.reduce((n, r) => n + r.rating * r._count._all, 0);
    return {
      kpis: {
        thisMonth,
        averageRating: rated ? Math.round((ratingSum / rated) * 10) / 10 : null,
        pending: statusCount('SUBMITTED') + statusCount('REVIEWED'),
        actioned: statusCount('ACTIONED'),
      },
      counts: { pending: statusCount('SUBMITTED') + statusCount('REVIEWED'), closed: statusCount('ACTIONED') + statusCount('DISMISSED') },
      // 5 stars first, as the chart reads.
      ratingDistribution: [5, 4, 3, 2, 1].map((stars) => ({ stars, count: ratings.find((r) => r.rating === stars)?._count._all ?? 0 })),
      keywords: sentimentKeywords(recent),
      total,
      items: rows.map(toFeedback),
    };
  }

  /** Who an admin can address: All Faculty, or a teacher still with the school. */
  async recipients(schoolId: string) {
    const faculty = await this.prisma.faculty.findMany({
      where: { schoolId, status: { not: 'INACTIVE' } },
      select: { id: true, name: true, primarySubject: true, subjects: true },
      orderBy: { name: 'asc' },
    });
    return faculty.map((f) => ({ id: f.id, name: f.name, subject: f.primarySubject ?? f.subjects[0] ?? 'General' }));
  }

  async send(schoolId: string, userId: string, dto: SendFeedbackDto) {
    const sender = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true } });
    let target: { toAllFaculty: boolean; targetFacultyId: string | null; targetName: string | null } = { toAllFaculty: true, targetFacultyId: null, targetName: null };
    if (dto.target.toUpperCase() !== 'ALL') {
      const faculty = await this.prisma.faculty.findFirst({
        where: { id: dto.target, schoolId, status: { not: 'INACTIVE' } },
        select: { id: true, name: true },
      });
      if (!faculty) throw new BadRequestException('Select a faculty member of this school, or All Faculty');
      target = { toAllFaculty: false, targetFacultyId: faculty.id, targetName: faculty.name };
    }
    const row = await this.prisma.feedback.create({
      data: {
        schoolId,
        direction: 'MANAGEMENT_TO_TEACHER',
        senderName: sender.fullName,
        createdById: userId,
        ...target,
        rating: dto.rating,
        content: dto.content,
        category: dto.category,
        feedbackDate: istToday(),
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  /** Reviewed, Actioned or Dismissed; a closed entry can be reopened as Reviewed. Scoped in the write. */
  async setStatus(schoolId: string, userId: string, id: string, dto: FeedbackStatusDto) {
    const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true } });
    const { count } = await this.prisma.feedback.updateMany({
      where: { id, schoolId },
      data: { status: dto.status, statusChangedAt: new Date(), statusChangedBy: actor.fullName },
    });
    if (!count) throw new NotFoundException('Feedback not found');
    return { id, status: dto.status };
  }

  // Faculty

  /** The faculty Feedback page: From Management and Sent to Management. */
  async teacherFeedback(scope: TeacherScope) {
    if (!scope.facultyId) return { received: [], sent: [] };
    const [received, sent] = await Promise.all([
      // Appraisal-like notes stop reaching someone who has left the school.
      scope.active
        ? this.prisma.feedback.findMany({ where: receivedBy(scope.schoolId, scope.facultyId), orderBy: { createdAt: 'desc' }, take: TEACHER_LIST_LIMIT })
        : [],
      this.prisma.feedback.findMany({
        where: { schoolId: scope.schoolId, direction: 'TEACHER_TO_MANAGEMENT', senderFacultyId: scope.facultyId },
        orderBy: { createdAt: 'desc' },
        take: TEACHER_LIST_LIMIT,
      }),
    ]);
    return { received: received.map(toFeedback), sent: sent.map(toFeedback) };
  }

  async teacherSend(scope: TeacherScope, userId: string, dto: TeacherFeedbackDto) {
    if (!scope.active || !scope.facultyId) throw new ForbiddenException('Only active faculty can send feedback');
    const faculty = await this.prisma.faculty.findUniqueOrThrow({ where: { id: scope.facultyId }, select: { name: true } });
    const row = await this.prisma.feedback.create({
      data: {
        schoolId: scope.schoolId,
        direction: 'TEACHER_TO_MANAGEMENT',
        senderName: faculty.name,
        senderFacultyId: scope.facultyId,
        createdById: userId,
        rating: dto.rating,
        content: dto.content,
        feedbackDate: istToday(),
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  // Import

  /**
   * Bulk upload (HLD: validate direction, rating, content, sender/target,
   * category). A teacher sender, and a teacher target, must be a faculty
   * member of the school (name, email or employee ID); a blank target, or
   * "All Faculty" / "Staff", addresses everyone. A row already imported
   * (same direction, people, date and text) is skipped, so a sheet can be
   * uploaded again safely.
   */
  async import(schoolId: string, userId: string, dto: FeedbackImportDto): Promise<ImportPreview> {
    const [importer, faculty] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true } }),
      this.prisma.faculty.findMany({ where: { schoolId }, select: { id: true, name: true, email: true, employeeId: true } }),
    ]);
    const today = istToday();
    const findFaculty = (text: string) => {
      const key = text.trim().toLowerCase();
      const byId = faculty.filter((f) => f.email?.toLowerCase() === key || f.employeeId?.toLowerCase() === key);
      return byId.length ? byId : faculty.filter((f) => f.name.trim().toLowerCase() === key);
    };
    type Ready = Prisma.FeedbackCreateManyInput & { key: string };
    const ready: (Ready | null)[] = [];
    const rows: ImportPreview['rows'] = dto.rows.map((raw, i) => {
      const errors: string[] = [];
      const direction = parseDirection(raw.type);
      if (!raw.type?.trim()) errors.push('Type is required');
      else if (!direction) errors.push('Type must be Teacher -> Management or Management -> Teacher');
      const rating = Number(raw.rating);
      if (!raw.rating?.trim()) errors.push('Rating is required');
      else if (!Number.isInteger(rating) || rating < 1 || rating > 5) errors.push('Rating must be a whole number from 1 to 5');
      const content = raw.content?.replace(/[ \t]+/g, ' ').trim() ?? '';
      if (!content) errors.push('Content is required');
      else if (content.length > MAX_FEEDBACK_LENGTH) errors.push(`Content must be under ${MAX_FEEDBACK_LENGTH} characters`);
      const category = parseCategory(raw.category);
      if (!category) errors.push(`Category must be one of ${Object.values(CATEGORY_LABELS).join(', ')}`);
      const date = parseImportDate(raw.date, 'Date', errors) ?? today;
      if (date > today) errors.push("Date can't be in the future");

      let sender = raw.sender?.trim() ?? '';
      let senderFacultyId: string | null = null;
      let target = { toAllFaculty: false, targetFacultyId: null as string | null, targetName: null as string | null };
      if (direction === 'TEACHER_TO_MANAGEMENT') {
        if (!sender) errors.push('Sender is required: the teacher who gave the feedback');
        else {
          const match = findFaculty(sender);
          if (match.length === 1) [senderFacultyId, sender] = [match[0].id, match[0].name];
          else errors.push(match.length ? `Sender ${sender} matches more than one faculty member; use their email` : `No faculty member matches sender ${sender}`);
        }
      } else if (direction === 'MANAGEMENT_TO_TEACHER') {
        sender ||= importer.fullName;
        if (isAllFaculty(raw.target)) target = { toAllFaculty: true, targetFacultyId: null, targetName: null };
        else {
          const match = findFaculty(raw.target!);
          if (match.length === 1) target = { toAllFaculty: false, targetFacultyId: match[0].id, targetName: match[0].name };
          else errors.push(match.length ? `Target ${raw.target} matches more than one faculty member; use their email` : `No faculty member matches target ${raw.target}`);
        }
      }
      const label = direction
        ? `${DIRECTION_LABELS[direction]}: ${sender || '?'}${direction === 'MANAGEMENT_TO_TEACHER' ? ` to ${target.toAllFaculty ? 'All Faculty' : (target.targetName ?? raw.target ?? '?')}` : ''}`
        : (raw.content?.slice(0, 40) ?? `Row ${i + 2}`);
      if (errors.length || !direction || !category) {
        ready.push(null);
        return { row: i + 2, label, action: 'error' as const, errors };
      }
      const data = {
        schoolId,
        direction,
        senderName: sender,
        senderFacultyId,
        createdById: userId,
        ...target,
        rating,
        content,
        subject: raw.subject?.trim() || null,
        category,
        feedbackDate: date,
        source: 'IMPORT' as const,
      };
      ready.push({ ...data, key: dedupeKey(data) });
      return { row: i + 2, label, action: 'create' as const, errors: [] };
    });

    // Already imported, or twice in this file.
    const dates = [...new Set(ready.flatMap((r) => (r ? [toIsoDate(r.feedbackDate as Date)!] : [])))].map((d) => new Date(`${d}T00:00:00Z`));
    const existing = dates.length
      ? await this.prisma.feedback.findMany({
          where: { schoolId, source: 'IMPORT', feedbackDate: { in: dates } },
          select: { direction: true, senderName: true, toAllFaculty: true, targetName: true, feedbackDate: true, content: true },
        })
      : [];
    const taken = new Set(existing.map(dedupeKey));
    ready.forEach((r, i) => {
      if (!r) return;
      if (taken.has(r.key)) {
        rows[i] = { ...rows[i], action: 'error', errors: ['Already imported (same people, date and feedback)'] };
        ready[i] = null;
      } else taken.add(r.key);
    });

    const toCreate = ready.flatMap((r) => (r ? [(({ key: _key, ...data }) => data)(r)] : []));
    if (!dto.dryRun && toCreate.length) await this.prisma.feedback.createMany({ data: toCreate });
    return {
      applied: !dto.dryRun,
      created: toCreate.length,
      updated: 0,
      skipped: rows.filter((r) => r.action === 'error').length,
      rows,
    };
  }
}

function dedupeKey(r: { direction: string; senderName: string; toAllFaculty?: boolean | null; targetName?: string | null; feedbackDate: Date | string; content: string }) {
  const day = typeof r.feedbackDate === 'string' ? r.feedbackDate.slice(0, 10) : toIsoDate(r.feedbackDate);
  return [r.direction, r.senderName.toLowerCase(), r.toAllFaculty ? '*' : (r.targetName ?? '').toLowerCase(), day, r.content.toLowerCase()].join('|');
}

/** Content, sender, subject, target (teacher or batch) and category, in any letter case. */
function searchWhere(q: string | null | undefined): Prisma.FeedbackWhereInput {
  const text = q?.trim();
  if (!text) return {};
  const like = { contains: likeEscape(text), mode: 'insensitive' } as const;
  const categories = categoriesMatching(text);
  return {
    OR: [
      { content: like },
      { senderName: like },
      { subject: like },
      { targetName: like },
      ...(categories.length ? [{ category: { in: categories } }] : []),
      ...(text.length >= 3 && 'all faculty'.includes(text.toLowerCase()) ? [{ toAllFaculty: true }] : []),
    ],
  };
}

export function toFeedback(f: Row) {
  return {
    id: f.id,
    direction: f.direction as FeedbackDirection,
    sender: { name: f.senderName, facultyId: f.senderFacultyId },
    target: f.direction === 'MANAGEMENT_TO_TEACHER' ? (f.toAllFaculty ? { all: true, name: 'All Faculty' } : { all: false, name: f.targetName! }) : null,
    rating: f.rating,
    content: f.content,
    subject: f.subject,
    category: f.category as FeedbackCategory,
    date: toIsoDate(f.feedbackDate)!,
    status: f.status,
    statusChangedAt: f.statusChangedAt?.toISOString() ?? null,
    statusChangedBy: f.statusChangedBy,
    source: f.source,
    createdAt: f.createdAt.toISOString(),
  };
}
