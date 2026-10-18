import { createHash } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { TeacherScope } from '../academic/access.service.js';
import { type ImportPreview, parseImportDate } from '../academic/import-utils.js';
import { istToday, toIsoDate } from '../common/dates.js';
import { likeEscape } from '../common/like-escape.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { FeedbackImportDto, FeedbackImportRow, FeedbackQuery, FeedbackStatusDto, SendFeedbackDto, TeacherFeedbackDto } from './feedback.dto.js';
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

  /**
   * The list for one view (and direction and search), with the KPIs, counts
   * and charts for the direction tab: All mixes both directions, the other
   * tabs show how teachers rate management or how management rates teachers.
   * Dismissed (archived) entries don't count towards ratings or keywords.
   */
  async adminList(schoolId: string, query: FeedbackQuery) {
    const view = query.view ?? 'pending';
    const scope: Prisma.FeedbackWhereInput = { schoolId, ...(query.direction && { direction: query.direction }) };
    const counted: Prisma.FeedbackWhereInput = { ...scope, status: { not: 'DISMISSED' } };
    const where: Prisma.FeedbackWhereInput = {
      ...scope,
      status: query.status ? query.status : { in: [...(view === 'pending' ? PENDING : CLOSED)] },
      ...searchWhere(query.q),
    };
    const today = istToday();
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const keywordFrom = new Date(today.getTime() - (KEYWORD_DAYS - 1) * 86_400_000);
    const [total, rows, thisMonth, ratings, byStatus, recent] = await Promise.all([
      this.prisma.feedback.count({ where }),
      this.prisma.feedback.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: FEEDBACK_LIST_LIMIT }),
      this.prisma.feedback.count({ where: { ...scope, feedbackDate: { gte: monthStart } } }),
      this.prisma.feedback.groupBy({ by: ['rating'], where: counted, _count: { _all: true } }),
      this.prisma.feedback.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
      this.prisma.feedback.findMany({
        where: { ...counted, feedbackDate: { gte: keywordFrom } },
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

  /**
   * The teacher's row is share-locked for the insert, so a profile being
   * deleted meanwhile either waits for this (and the entry keeps their name)
   * or goes first (and this is a clear 400, not a foreign-key 500).
   */
  async send(schoolId: string, userId: string, dto: SendFeedbackDto) {
    const sender = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true } });
    const row = await withTeacherGone(() =>
      this.prisma.$transaction(async (tx) => {
        let target: { toAllFaculty: boolean; targetFacultyId: string | null; targetName: string | null } = { toAllFaculty: true, targetFacultyId: null, targetName: null };
        if (dto.target.toUpperCase() !== 'ALL') {
          const [faculty] = await tx.$queryRaw<{ id: string; name: string }[]>`
            SELECT "id", "name" FROM "Faculty" WHERE "id" = ${dto.target} AND "schoolId" = ${schoolId} AND "status" <> 'INACTIVE' FOR SHARE`;
          if (!faculty) throw new BadRequestException('Select a faculty member of this school, or All Faculty');
          target = { toAllFaculty: false, targetFacultyId: faculty.id, targetName: faculty.name };
        }
        return tx.feedback.create({
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
      }),
    );
    return { id: row.id };
  }

  /** Reviewed, Actioned or Dismissed; a closed entry can be reopened as Reviewed. Scoped in the write. */
  async setStatus(schoolId: string, userId: string, id: string, dto: FeedbackStatusDto) {
    const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true } });
    const { count } = await this.prisma.feedback.updateMany({
      where: { id, schoolId },
      data: { status: dto.status, statusChangedAt: new Date(), statusChangedBy: actor.fullName, statusChangedById: userId },
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
   * category). A teacher sender must be a faculty member of the school (name,
   * email or employee ID); a teacher target must be one still active there,
   * as Send requires. A blank target, or "All Faculty" / "Staff", addresses
   * everyone.
   *
   * Each row is keyed by its cells as written, with a teacher sender or
   * target by the faculty member it resolves to (so "t1@x.test" and "Ravi
   * Kumar" for the same teacher are one row); a blank sender or date stays
   * blank, rather than becoming the importing admin or today. The key is
   * unique per school in the database, so the same sheet uploaded again (by
   * another admin, on another day, or twice at once) never stores a row
   * twice. Rows imported before the faculty-id key are matched by their old
   * key too. A large sheet comes in chunks (`firstRow`, `priorKeys`).
   */
  async import(schoolId: string, userId: string, dto: FeedbackImportDto): Promise<ImportPreview> {
    const [importer, faculty] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true } }),
      this.prisma.faculty.findMany({ where: { schoolId }, select: { id: true, name: true, email: true, employeeId: true, status: true } }),
    ]);
    const today = istToday();
    const findFaculty = (text: string) => {
      const key = text.trim().toLowerCase();
      const byId = faculty.filter((f) => f.email?.toLowerCase() === key || f.employeeId?.toLowerCase() === key);
      return byId.length ? byId : faculty.filter((f) => f.name.trim().toLowerCase() === key);
    };
    type Ready = Prisma.FeedbackCreateManyInput & { importKey: string; legacyKey: string };
    const ready: (Ready | null)[] = [];
    const firstRowNumber = dto.firstRow ?? 2;
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
      const givenDate = parseImportDate(raw.date, 'Date', errors);
      const date = givenDate ?? today;
      if (date > today) errors.push("Date can't be in the future");

      let sender = raw.sender?.trim() ?? '';
      let senderFacultyId: string | null = null;
      let target = { toAllFaculty: false, targetFacultyId: null as string | null, targetName: null as string | null };
      if (direction === 'TEACHER_TO_MANAGEMENT') {
        if (!sender) errors.push('Sender is required: the teacher who gave the feedback');
        else {
          // Any profile, active or not: a sheet can hold feedback from before someone left.
          const match = findFaculty(sender);
          if (match.length === 1) [senderFacultyId, sender] = [match[0].id, match[0].name];
          else errors.push(match.length ? `Sender ${sender} matches more than one faculty member; use their email` : `No faculty member matches sender ${sender}`);
        }
      } else if (direction === 'MANAGEMENT_TO_TEACHER') {
        sender ||= importer.fullName;
        if (isAllFaculty(raw.target)) target = { toAllFaculty: true, targetFacultyId: null, targetName: null };
        else {
          const match = findFaculty(raw.target!);
          const active = match.filter((f) => f.status !== 'INACTIVE');
          if (active.length === 1) target = { toAllFaculty: false, targetFacultyId: active[0].id, targetName: active[0].name };
          else if (active.length > 1) errors.push(`Target ${raw.target} matches more than one faculty member; use their email`);
          else errors.push(match.length ? `${match[0].name} is no longer active in this school, so feedback can't be sent to them` : `No faculty member matches target ${raw.target}`);
        }
      }
      const label = direction
        ? `${DIRECTION_LABELS[direction]}: ${sender || '?'}${direction === 'MANAGEMENT_TO_TEACHER' ? ` to ${target.toAllFaculty ? 'All Faculty' : (target.targetName ?? raw.target ?? '?')}` : ''}`
        : (raw.content?.slice(0, 40) ?? `Row ${firstRowNumber + i}`);
      if (errors.length || !direction || !category) {
        ready.push(null);
        return { row: firstRowNumber + i, label, action: 'error' as const, errors };
      }
      ready.push({
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
        importKey: importKeyOf(raw, direction, givenDate, { senderFacultyId, ...target }),
        legacyKey: legacyImportKeyOf(raw, direction, givenDate),
      });
      return { row: firstRowNumber + i, label, action: 'create' as const, errors: [] };
    });

    const skip = (i: number, error: string) => {
      rows[i] = { ...rows[i], action: 'error', errors: [error] };
      ready[i] = null;
    };
    // Twice in this file (this chunk or an earlier one): the first one counts.
    const firstRow = new Map<string, number>((dto.priorKeys ?? []).map((p) => [p.key, p.row]));
    ready.forEach((r, i) => {
      if (!r) return;
      const first = firstRow.get(r.importKey);
      if (first === undefined) firstRow.set(r.importKey, rows[i].row);
      else skip(i, `Appears twice in this file (same as row ${first})`);
    });
    // Uploaded before (by its key, or the key it had before teachers were keyed by id).
    const keys = ready.flatMap((r) => (r ? [r.importKey, r.legacyKey] : []));
    const existing = keys.length
      ? new Set((await this.prisma.feedback.findMany({ where: { schoolId, importKey: { in: keys } }, select: { importKey: true } })).map((r) => r.importKey))
      : new Set<string | null>();
    ready.forEach((r, i) => r && (existing.has(r.importKey) || existing.has(r.legacyKey)) && skip(i, 'Already imported (an earlier upload has this row)'));

    const toCreate = ready.flatMap((r) => (r ? [withoutLegacy(r)] : []));
    if (!dto.dryRun && toCreate.length) {
      const inserted = await withTeacherGone(() =>
        this.prisma.$transaction(
          async (tx) => {
            // The teachers named are share-locked, in id order, so a profile deleted or
            // deactivated since the check stops the import instead of failing it with a 500.
            const ids = [...new Set(toCreate.flatMap((r) => [r.senderFacultyId, r.targetFacultyId].filter((x): x is string => !!x)))].sort();
            if (ids.length) {
              const live = await tx.$queryRaw<{ id: string; status: string }[]>`
                SELECT "id", "status"::text AS "status" FROM "Faculty" WHERE "schoolId" = ${schoolId} AND "id" = ANY(${ids}::text[]) ORDER BY "id" FOR SHARE`;
              const gone = toCreate.find(
                (r) =>
                  (r.senderFacultyId && !live.some((f) => f.id === r.senderFacultyId)) ||
                  (r.targetFacultyId && !live.some((f) => f.id === r.targetFacultyId && f.status !== 'INACTIVE')),
              );
              if (gone) {
                throw new BadRequestException(
                  `${gone.targetName ?? gone.senderName} was removed or deactivated while the file was being checked. Nothing was imported; check the file again.`,
                );
              }
            }
            // An upload finishing at the same moment may have stored some of these: they are skipped, not doubled.
            return tx.feedback.createManyAndReturn({ data: toCreate, skipDuplicates: true, select: { importKey: true } });
          },
          { timeout: 60_000, maxWait: 10_000 },
        ),
      );
      const stored = new Set(inserted.map((r) => r.importKey));
      ready.forEach((r, i) => r && !stored.has(r.importKey) && skip(i, 'Already imported (by an upload that finished at the same time)'));
    }
    const created = ready.filter(Boolean).length;
    // Each new row's key, for the next chunk of the same file.
    ready.forEach((r, i) => r && (rows[i] = { ...rows[i], key: r.importKey }));
    return { applied: !dto.dryRun, created, updated: 0, skipped: rows.length - created, rows };
  }
}

const withoutLegacy = <T extends { legacyKey: string }>({ legacyKey: _legacy, ...row }: T) => row;

const cell = (v: string | undefined) => (v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const hash = (parts: string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

/**
 * A row's identity: its direction and cells (trimmed, spacing and letter case
 * ignored, a date in either accepted format read as the same day), with a
 * teacher sender or target as the faculty member it resolved to, however the
 * sheet wrote them; "All Faculty" / "Staff" / blank are one target. Other
 * blanks stay blank. Hashed, so a long comment still fits a unique index.
 */
export function importKeyOf(
  raw: FeedbackImportRow,
  direction: FeedbackDirection,
  date: Date | null,
  who: { senderFacultyId: string | null; toAllFaculty: boolean; targetFacultyId: string | null },
): string {
  const sender = direction === 'TEACHER_TO_MANAGEMENT' ? `faculty:${who.senderFacultyId}` : cell(raw.sender);
  const target = direction === 'MANAGEMENT_TO_TEACHER' ? (who.toAllFaculty ? 'all-faculty' : `faculty:${who.targetFacultyId}`) : cell(raw.target);
  return hash(['v2', direction, sender, target, cell(raw.rating), cell(raw.content), cell(raw.subject), cell(raw.category), date ? toIsoDate(date)! : '']);
}

/** The key rows were imported under before teachers were keyed by id: every cell as written. */
export function legacyImportKeyOf(raw: FeedbackImportRow, direction: FeedbackDirection, date: Date | null): string {
  return hash([direction, cell(raw.sender), cell(raw.target), cell(raw.rating), cell(raw.content), cell(raw.subject), cell(raw.category), date ? toIsoDate(date)! : '']);
}

/** A teacher profile deleted between the check and the insert (foreign key) is a 400, not a 500. */
async function withTeacherGone<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      throw new BadRequestException('That teacher was just removed from the school. Refresh and pick again.');
    }
    throw err;
  }
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
