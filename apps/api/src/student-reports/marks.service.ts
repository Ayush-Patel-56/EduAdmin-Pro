import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { ImportPreview } from '../academic/import-utils.js';
import { activeFacultyId, actorName, isTeacher, type Actor } from '../assessments/actor.js';
import { isForeignKeyViolation } from '../assessments/tests.service.js';
import { likeEscape } from '../common/like-escape.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  GRADE_SCALE,
  NEEDS_ATTENTION_PERCENT,
  REPORT_SUBJECTS,
  REPORT_TERMS,
  TERM_LABELS,
  gradeOf,
  looseText,
  percent,
  topicKey,
  type ReportTermKey,
} from './report-math.js';
import { batchScope, inScope, requireBatchAccess, requireWritableYear, yearChoices, yearContext } from './scope.js';
import {
  MAX_MAX_MARKS,
  MAX_REMARKS,
  REPORTS_PAGE_SIZE,
  type MarkImportRow,
  type MarkSetQuery,
  type MarksImportDto,
  type OverviewQuery,
  type ProgressKeyQuery,
  type ProgressListQuery,
  type ProgressReportDto,
  type SetsQuery,
} from './student-reports.dto.js';

const num = (v: Prisma.Decimal | string | number) => Number(v);
const WRITE_REFUSED = 'Only active faculty can change student reports';
/**
 * Topic spellings Mistake Analysis reads, most missed first (far above a
 * year's distinct topics in a scope): past the cap only the least-missed
 * spellings fall off, never the top of the list.
 */
export const MISTAKE_GROUPS = 5000;
const like = (q: string) => `%${likeEscape(q.trim())}%`;

/**
 * Term marks (PRD 4.5, 4.8): the uploaded report sheets (Import student
 * report), the class analytics over them (Uploaded Reports Overview), and the
 * Student Progress Reports built from them. A sheet is one batch's marks in
 * one subject for one term; a progress report is one student's marks for a
 * term across subjects, with remarks. Admins reach every batch of the school,
 * teachers the batches assigned to them now.
 */
@Injectable()
export class MarksService {
  /** How many topic spellings Mistake Analysis reads (MISTAKE_GROUPS; smaller in tests). */
  mistakeGroups = MISTAKE_GROUPS;

  constructor(private readonly prisma: PrismaService) {}

  /** The pickers: academic years, terms, subjects, the grade scale and the batches this person reaches. */
  async options(actor: Actor) {
    const ctx = await yearContext(this.prisma, actor.schoolId);
    const scope = batchScope(actor);
    const batches = await this.prisma.batch.findMany({
      where: { schoolId: actor.schoolId, ...(scope && { id: { in: scope } }) },
      select: { id: true, name: true, program: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    return {
      currentYear: ctx.current,
      years: yearChoices(ctx.current),
      terms: REPORT_TERMS.map((key) => ({ key, label: TERM_LABELS[key] })),
      subjects: REPORT_SUBJECTS,
      gradeScale: GRADE_SCALE.map((g) => ({ grade: g.grade, min: Number.isFinite(g.min) ? g.min : 0 })),
      needsAttentionPercent: NEEDS_ATTENTION_PERCENT,
      /** Whether this person can upload, generate and delete (an inactive teacher only reads, and sees nothing). */
      canWrite: !isTeacher(actor) || (actor.scope.active && !!actor.scope.facultyId),
      /** Only admins delete a report sheet; a teacher corrects one by uploading it again. */
      canDeleteSheets: !isTeacher(actor),
      batches: batches.map((b) => ({ id: b.id, name: b.name, program: b.program.name })),
    };
  }

  /** A batch's students, for the Generate Progress Report picker. */
  async roster(actor: Actor, batchId: string) {
    requireBatchAccess(actor, batchId);
    return this.prisma.student.findMany({
      where: { schoolId: actor.schoolId, batchId },
      select: { id: true, fullName: true, rollNumber: true, status: true },
      orderBy: [{ rollNumber: { sort: 'asc', nulls: 'last' } }, { fullName: 'asc' }, { id: 'asc' }],
    });
  }

  // Import student report

  /**
   * Checks (dry run) or saves one report sheet: Roll No and Name matched to
   * the batch's students, Marks out of Max Marks, optional Attendance % and
   * Remarks. Uploading the same sheet again updates the marks it holds.
   */
  async importMarks(actor: Actor, dto: MarksImportDto): Promise<ImportPreview> {
    activeFacultyId(actor, WRITE_REFUSED);
    requireBatchAccess(actor, dto.batchId);
    requireWritableYear(await yearContext(this.prisma, actor.schoolId), dto.year);
    const batch = await this.prisma.batch.findFirst({ where: { id: dto.batchId, schoolId: actor.schoolId }, select: { id: true, name: true } });
    if (!batch) throw new BadRequestException('Select a batch of this school');
    const check = async (db: Prisma.TransactionClient | PrismaService) => {
      const roster = await db.student.findMany({ where: { schoolId: actor.schoolId, batchId: batch.id }, select: { id: true, fullName: true, rollNumber: true } });
      const existing = await db.studentMark.findMany({
        where: { schoolId: actor.schoolId, academicYear: dto.year, term: dto.term, subject: dto.subject, studentId: { in: roster.map((s) => s.id) } },
        select: { studentId: true, batchId: true, enteredBy: true, batch: { select: { name: true } } },
      });
      const prior = new Map(existing.map((e) => [e.studentId, { batchId: e.batchId, batchName: e.batch.name, enteredBy: e.enteredBy }]));
      return checkSheet(dto.rows, batch, roster, prior, batchScope(actor));
    };
    if (dto.dryRun) {
      const { rows, ready } = await check(this.prisma);
      return summary(false, rows, ready);
    }
    const enteredBy = await actorName(this.prisma, actor);
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Batch, then students, shared-locked: a delete of either waits, then refuses (marks are records).
        await tx.$queryRaw`SELECT 1 FROM "Batch" WHERE "id" = ${batch.id} AND "schoolId" = ${actor.schoolId} FOR SHARE`;
        const { rows, ready } = await check(tx);
        if (ready.length) {
          await tx.$queryRaw`SELECT 1 FROM "Student" WHERE "id" IN (${Prisma.join(ready.map((r) => r.studentId))}) AND "schoolId" = ${actor.schoolId} FOR SHARE`;
          await upsertMarks(tx, actor, { year: dto.year, term: dto.term, source: 'IMPORT', enteredBy }, ready.map((r) => ({ ...r, batchId: batch.id, subject: dto.subject })));
        }
        return summary(true, rows, ready);
      });
    } catch (err) {
      if (isForeignKeyViolation(err)) throw new BadRequestException('A student or the batch was just changed. Upload the sheet again.');
      throw err;
    }
  }

  // Uploaded Reports Overview

  /** The uploaded sheets (one per batch, term and subject), newest first, a page at a time. */
  async sets(actor: Actor, query: SetsQuery) {
    const ctx = await yearContext(this.prisma, actor.schoolId, query.year);
    const page = query.page ?? 1;
    const where = Prisma.sql`
      WHERE m."schoolId" = ${actor.schoolId} AND m."academicYear" = ${ctx.year}
      ${query.term ? Prisma.sql`AND m."term" = ${query.term}::"ReportTerm"` : Prisma.empty}
      ${query.batchId ? Prisma.sql`AND m."batchId" = ${query.batchId}` : Prisma.empty}
      ${query.subject ? Prisma.sql`AND m."subject" = ${query.subject}` : Prisma.empty}
      ${inScope('m."batchId"', batchScope(actor))}
      ${query.q?.trim() ? Prisma.sql`AND (b."name" ILIKE ${like(query.q)} OR m."subject" ILIKE ${like(query.q)})` : Prisma.empty}`;
    const from = Prisma.sql`FROM "StudentMark" m JOIN "Batch" b ON b."id" = m."batchId" AND b."schoolId" = m."schoolId"`;
    const [rows, [count]] = await Promise.all([
      this.prisma.$queryRaw<{ batchId: string; batchName: string; term: ReportTermKey; subject: string; students: number; average: number; highest: number; lowest: number; updatedAt: Date; enteredBy: string; manual: boolean }[]>`
        SELECT m."batchId", b."name" AS "batchName", m."term"::text AS "term", m."subject", count(*)::int AS "students",
          round(avg(m."marks" / m."maxMarks" * 100), 2)::float AS "average",
          round(max(m."marks" / m."maxMarks" * 100), 2)::float AS "highest",
          round(min(m."marks" / m."maxMarks" * 100), 2)::float AS "lowest",
          max(m."updatedAt") AS "updatedAt", (array_agg(m."enteredBy" ORDER BY m."updatedAt" DESC, m."id"))[1] AS "enteredBy",
          bool_and(m."source" = 'MANUAL') AS "manual"
        ${from} ${where}
        GROUP BY m."batchId", b."name", m."term", m."subject"
        ORDER BY max(m."updatedAt") DESC, b."name", m."subject", m."term"
        LIMIT ${REPORTS_PAGE_SIZE} OFFSET ${(page - 1) * REPORTS_PAGE_SIZE}`,
      this.prisma.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS "total" FROM (SELECT 1 ${from} ${where} GROUP BY m."batchId", m."term", m."subject") x`,
    ]);
    return {
      year: { year: ctx.year, label: ctx.label },
      total: count?.total ?? 0,
      page,
      pageSize: REPORTS_PAGE_SIZE,
      items: rows.map((r) => ({
        batch: { id: r.batchId, name: r.batchName },
        term: r.term,
        termLabel: TERM_LABELS[r.term],
        subject: r.subject,
        students: r.students,
        average: r.average,
        grade: gradeOf(r.average),
        highest: r.highest,
        lowest: r.lowest,
        enteredBy: r.enteredBy,
        source: r.manual ? 'MANUAL' : 'IMPORT',
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  }

  /** One sheet's rows: each student's marks, percentage and grade. */
  async set(actor: Actor, query: MarkSetQuery) {
    requireBatchAccess(actor, query.batchId);
    const rows = await this.prisma.studentMark.findMany({
      where: { schoolId: actor.schoolId, batchId: query.batchId, academicYear: query.year, term: query.term, subject: query.subject },
      select: { marks: true, maxMarks: true, attendance: true, remarks: true, source: true, enteredBy: true, updatedAt: true, student: { select: { id: true, fullName: true, rollNumber: true } } },
      orderBy: [{ student: { rollNumber: { sort: 'asc', nulls: 'last' } } }, { student: { fullName: 'asc' } }],
    });
    return rows.map((r) => {
      const p = percent(num(r.marks), num(r.maxMarks));
      return {
        student: r.student,
        marks: num(r.marks),
        maxMarks: num(r.maxMarks),
        percent: p,
        grade: gradeOf(p),
        attendance: r.attendance === null ? null : num(r.attendance),
        remarks: r.remarks,
        source: r.source,
        enteredBy: r.enteredBy,
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }

  /**
   * Deletes one sheet's marks (uploaded to the wrong batch, term or subject),
   * and any progress report left with no marks. Admins only: a teacher
   * corrects a sheet by uploading it again (#50).
   */
  async removeSet(actor: Actor, query: MarkSetQuery) {
    if (isTeacher(actor)) throw new ForbiddenException('Only an admin can delete a report sheet. Upload the corrected sheet instead.');
    return this.prisma.$transaction(async (tx) => {
      const where = { schoolId: actor.schoolId, batchId: query.batchId, academicYear: query.year, term: query.term, subject: query.subject };
      const students = await tx.studentMark.findMany({ where, select: { studentId: true } });
      if (!students.length) throw new NotFoundException('No marks for that batch, term and subject');
      await tx.studentMark.deleteMany({ where });
      await this.dropEmptyReports(tx, actor.schoolId, students.map((s) => s.studentId), query.year, query.term);
      return { deleted: students.length };
    });
  }

  /**
   * Class analytics over the sheets in the filters (PRD 4.5): the average per
   * subject across the year's terms (trend), Top Performers, subjects that
   * need attention (averaging below 65%), and the most-missed test topics.
   */
  async overview(actor: Actor, query: OverviewQuery) {
    const ctx = await yearContext(this.prisma, actor.schoolId, query.year);
    const scope = batchScope(actor);
    const base = Prisma.sql`m."schoolId" = ${actor.schoolId} AND m."academicYear" = ${ctx.year}
      ${query.batchId ? Prisma.sql`AND m."batchId" = ${query.batchId}` : Prisma.empty}
      ${query.subject ? Prisma.sql`AND m."subject" = ${query.subject}` : Prisma.empty}
      ${inScope('m."batchId"', scope)}`;
    const withTerm = Prisma.sql`${base} ${query.term ? Prisma.sql`AND m."term" = ${query.term}::"ReportTerm"` : Prisma.empty}`;
    const [trend, [kpis], top, subjects, mistakes] = await Promise.all([
      this.prisma.$queryRaw<{ term: ReportTermKey; subject: string; average: number; students: number }[]>`
        SELECT m."term"::text AS "term", m."subject", round(avg(m."marks" / m."maxMarks" * 100), 2)::float AS "average", count(*)::int AS "students"
        FROM "StudentMark" m WHERE ${base} GROUP BY m."term", m."subject"`,
      this.prisma.$queryRaw<{ students: number; marks: number; average: number | null; sets: number }[]>`
        SELECT count(DISTINCT m."studentId")::int AS "students", count(*)::int AS "marks", round(avg(m."marks" / m."maxMarks" * 100), 2)::float AS "average",
          count(DISTINCT (m."batchId", m."term", m."subject"))::int AS "sets"
        FROM "StudentMark" m WHERE ${withTerm}`,
      this.prisma.$queryRaw<{ studentId: string; fullName: string; rollNumber: string | null; batchName: string; percent: number; subjects: number }[]>`
        SELECT m."studentId", s."fullName", s."rollNumber", b."name" AS "batchName", round(sum(m."marks") / sum(m."maxMarks") * 100, 2)::float AS "percent", count(*)::int AS "subjects"
        FROM "StudentMark" m
        JOIN "Student" s ON s."id" = m."studentId" AND s."schoolId" = m."schoolId"
        LEFT JOIN "Batch" b ON b."id" = s."batchId" AND b."schoolId" = s."schoolId"
        WHERE ${withTerm}
        GROUP BY m."studentId", s."fullName", s."rollNumber", b."name"
        ORDER BY "percent" DESC, s."fullName", m."studentId" LIMIT 5`,
      this.prisma.$queryRaw<{ subject: string; average: number; students: number }[]>`
        SELECT m."subject", round(avg(m."marks" / m."maxMarks" * 100), 2)::float AS "average", count(DISTINCT m."studentId")::int AS "students"
        FROM "StudentMark" m WHERE ${withTerm} GROUP BY m."subject" ORDER BY "average", m."subject"`,
      this.mistakeTopics(actor.schoolId, scope, query.batchId ?? null, query.subject ?? null, ctx.fromInstant, ctx.toInstant),
    ]);
    return {
      year: { year: ctx.year, label: ctx.label },
      kpis: { students: kpis?.students ?? 0, sets: kpis?.sets ?? 0, average: kpis?.average ?? null, grade: gradeOf(kpis?.average ?? null) },
      trend: REPORT_TERMS.filter((t) => trend.some((r) => r.term === t)).map((t) => ({
        term: t,
        label: TERM_LABELS[t],
        subjects: Object.fromEntries(trend.filter((r) => r.term === t).map((r) => [r.subject, r.average])),
      })),
      subjects: [...new Set(trend.map((r) => r.subject))].sort(),
      topPerformers: top.map((t) => ({ student: { id: t.studentId, fullName: t.fullName, rollNumber: t.rollNumber, batch: t.batchName }, percent: t.percent, grade: gradeOf(t.percent), subjects: t.subjects })),
      subjectAverages: subjects.map((s) => ({ ...s, grade: gradeOf(s.average), needsAttention: s.average < NEEDS_ATTENTION_PERCENT })),
      needsAttention: subjects.filter((s) => s.average < NEEDS_ATTENTION_PERCENT).map((s) => ({ ...s, grade: gradeOf(s.average) })),
      mistakes,
    };
  }

  /**
   * Mistake Analysis: the test topics most often answered wrong or skipped this
   * year, in the batches in view. Topics are matched in any letter case,
   * spacing or punctuation (topicKey, as in topic strength) and named as on
   * the latest paper.
   */
  private async mistakeTopics(schoolId: string, scope: string[] | null, batchId: string | null, subject: string | null, from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<{ subject: string; topic: string; latest: Date; wrong: number; skipped: number; answers: number }[]>`
      SELECT q."subject", (array_agg(q."topic" ORDER BY t."startsAt" DESC, q."position"))[1] AS "topic", max(t."startsAt") AS "latest",
        count(*) FILTER (WHERE a."outcome" IN ('INCORRECT', 'PARTIAL'))::int AS "wrong",
        count(*) FILTER (WHERE a."outcome" = 'UNATTEMPTED')::int AS "skipped",
        count(*)::int AS "answers"
      FROM "TestAnswer" a
      JOIN "TestQuestion" q ON q."id" = a."testQuestionId" AND q."schoolId" = a."schoolId"
      JOIN "Test" t ON t."id" = a."testId" AND t."schoolId" = a."schoolId"
      WHERE a."schoolId" = ${schoolId} AND t."status" = 'SCHEDULED' AND t."startsAt" >= ${from} AND t."startsAt" < ${to}
        ${batchId ? Prisma.sql`AND t."batchId" = ${batchId}` : Prisma.empty}
        ${subject ? Prisma.sql`AND q."subject" = ${subject}` : Prisma.empty}
        ${inScope('t."batchId"', scope)}
      GROUP BY q."subject", lower(btrim(q."topic"))
      ORDER BY count(*) FILTER (WHERE a."outcome" <> 'CORRECT') DESC, max(t."startsAt") DESC, q."subject", lower(btrim(q."topic"))
      LIMIT ${this.mistakeGroups}`;
    // Spellings of one topic merged (topicKey), named as on the latest paper.
    const merged = new Map<string, { subject: string; topic: string; latest: Date; wrong: number; skipped: number; answers: number }>();
    for (const r of rows) {
      const key = topicKey(r.subject, r.topic);
      const m = merged.get(key);
      if (!m) merged.set(key, { ...r });
      else {
        if (r.latest > m.latest) [m.topic, m.latest] = [r.topic, r.latest];
        m.wrong += r.wrong;
        m.skipped += r.skipped;
        m.answers += r.answers;
      }
    }
    return [...merged.values()]
      .filter((m) => m.wrong + m.skipped > 0)
      .sort((a, b) => b.wrong + b.skipped - (a.wrong + a.skipped) || a.subject.localeCompare(b.subject) || a.topic.localeCompare(b.topic))
      .slice(0, 8)
      .map(({ latest: _latest, ...m }) => ({ ...m, missRate: percent(m.wrong + m.skipped, m.answers) }));
  }

  // Student Progress Reports (PRD 4.8)

  /**
   * The progress report cards in the filters, newest first, with the KPIs
   * (total, average, top three). A card is one student's marks for a term;
   * its rank and percentile are among the students with marks for that term
   * in the same batch, worked out on every read (Recalculate Ranks re-reads).
   */
  async progressList(actor: Actor, query: ProgressListQuery) {
    const ctx = await yearContext(this.prisma, actor.schoolId, query.year);
    const page = query.page ?? 1;
    const cards = Prisma.sql`
      WITH cards AS (
        SELECT m."studentId", m."term", (array_agg(m."batchId" ORDER BY m."updatedAt" DESC, m."id"))[1] AS "batchId",
          sum(m."marks") AS "marks", sum(m."maxMarks") AS "maxMarks", max(m."updatedAt") AS "updatedAt"
        FROM "StudentMark" m
        WHERE m."schoolId" = ${actor.schoolId} AND m."academicYear" = ${ctx.year}
          ${query.term ? Prisma.sql`AND m."term" = ${query.term}::"ReportTerm"` : Prisma.empty}
        GROUP BY m."studentId", m."term"
      ), ranked AS (
        SELECT c.*, round(c."marks" / c."maxMarks" * 100, 2) AS "percent",
          rank() OVER (PARTITION BY c."batchId", c."term" ORDER BY round(c."marks" / c."maxMarks" * 100, 2) DESC) AS "rank",
          count(*) OVER (PARTITION BY c."batchId", c."term") AS "of"
        FROM cards c
      )`;
    const from = Prisma.sql`
      FROM ranked r
      JOIN "Student" s ON s."id" = r."studentId" AND s."schoolId" = ${actor.schoolId}
      JOIN "Batch" b ON b."id" = r."batchId" AND b."schoolId" = ${actor.schoolId}
      WHERE true
        ${query.batchId ? Prisma.sql`AND r."batchId" = ${query.batchId}` : Prisma.empty}
        ${inScope('r."batchId"', batchScope(actor))}
        ${query.q?.trim() ? Prisma.sql`AND (s."fullName" ILIKE ${like(query.q)} OR s."rollNumber" ILIKE ${like(query.q)})` : Prisma.empty}`;
    type Card = { studentId: string; term: ReportTermKey; batchId: string; batchName: string; fullName: string; rollNumber: string | null; marks: string; maxMarks: string; percent: number; rank: number; of: number; updatedAt: Date };
    const select = Prisma.sql`SELECT r."studentId", r."term"::text AS "term", r."batchId", b."name" AS "batchName", s."fullName", s."rollNumber",
      r."marks"::text AS "marks", r."maxMarks"::text AS "maxMarks", r."percent"::float AS "percent", r."rank"::int AS "rank", r."of"::int AS "of", r."updatedAt"`;
    const [rows, [kpis], toppers] = await Promise.all([
      this.prisma.$queryRaw<Card[]>`${cards} ${select} ${from} ORDER BY r."updatedAt" DESC, s."fullName", r."studentId", r."term" LIMIT ${REPORTS_PAGE_SIZE} OFFSET ${(page - 1) * REPORTS_PAGE_SIZE}`,
      this.prisma.$queryRaw<{ total: number; average: number | null }[]>`${cards} SELECT count(*)::int AS "total", round(avg(r."percent"), 2)::float AS "average" ${from}`,
      this.prisma.$queryRaw<Card[]>`${cards} ${select} ${from} ORDER BY r."percent" DESC, s."fullName", r."studentId", r."term" LIMIT 3`,
    ]);
    const keys = rows.map((r) => ({ studentId: r.studentId, academicYear: ctx.year, term: r.term }));
    const [marks, reports] = keys.length
      ? await Promise.all([
          this.prisma.studentMark.findMany({ where: { schoolId: actor.schoolId, OR: keys }, select: { studentId: true, term: true, subject: true, marks: true, maxMarks: true, attendance: true, remarks: true, enteredBy: true, updatedAt: true }, orderBy: { subject: 'asc' } }),
          this.prisma.progressReport.findMany({ where: { schoolId: actor.schoolId, OR: keys }, select: { studentId: true, term: true, teacherRemarks: true, principalRemarks: true, updatedBy: true, updatedAt: true } }),
        ])
      : [[], []];
    const card = (r: Card) => ({
      student: { id: r.studentId, fullName: r.fullName, rollNumber: r.rollNumber },
      batch: { id: r.batchId, name: r.batchName },
      year: ctx.year,
      term: r.term,
      termLabel: TERM_LABELS[r.term],
      marks: num(r.marks),
      maxMarks: num(r.maxMarks),
      percent: r.percent,
      grade: gradeOf(r.percent),
      rank: r.rank,
      of: r.of,
      percentile: Math.round(((r.of - r.rank + 1) / r.of) * 10000) / 100,
    });
    return {
      year: { year: ctx.year, label: ctx.label },
      kpis: { total: kpis?.total ?? 0, average: kpis?.average ?? null, toppers: toppers.map(card) },
      total: kpis?.total ?? 0,
      page,
      pageSize: REPORTS_PAGE_SIZE,
      items: rows.map((r) => {
        const mine = marks.filter((m) => m.studentId === r.studentId && m.term === r.term);
        const report = reports.find((p) => p.studentId === r.studentId && p.term === r.term);
        const latest = mine.reduce<(typeof mine)[number] | null>((a, m) => (!a || m.updatedAt > a.updatedAt ? m : a), null);
        return {
          ...card(r),
          subjects: mine.map((m) => {
            const p = percent(num(m.marks), num(m.maxMarks));
            return { subject: m.subject, marks: num(m.marks), maxMarks: num(m.maxMarks), percent: p, grade: gradeOf(p), attendance: m.attendance === null ? null : num(m.attendance), remarks: m.remarks };
          }),
          teacherRemarks: report?.teacherRemarks ?? null,
          principalRemarks: report?.principalRemarks ?? null,
          reportedBy: report && (!latest || report.updatedAt >= latest.updatedAt) ? report.updatedBy : (latest?.enteredBy ?? null),
          updatedAt: r.updatedAt.toISOString(),
        };
      }),
    };
  }

  /** One student's report for a term, to edit it. */
  async progressOne(actor: Actor, query: ProgressKeyQuery) {
    const key = { schoolId: actor.schoolId, studentId: query.studentId, academicYear: query.year, term: query.term };
    const [student, marks, report] = await Promise.all([
      this.prisma.student.findFirst({ where: { id: query.studentId, schoolId: actor.schoolId }, select: { id: true, fullName: true, rollNumber: true, batchId: true } }),
      this.prisma.studentMark.findMany({ where: key, select: { subject: true, marks: true, maxMarks: true, batchId: true, updatedAt: true }, orderBy: { subject: 'asc' } }),
      this.prisma.progressReport.findFirst({ where: key, select: { teacherRemarks: true, principalRemarks: true } }),
    ]);
    if (!student) throw new NotFoundException('Student not found');
    const batchId = latestBatch(marks) ?? student.batchId;
    if (!batchId || (isTeacher(actor) && !actor.scope.batchIds.includes(batchId))) throw new NotFoundException('Student not found');
    return {
      student: { id: student.id, fullName: student.fullName, rollNumber: student.rollNumber },
      batchId,
      exists: marks.length > 0,
      subjects: marks.map((m) => ({ subject: m.subject, marks: num(m.marks), maxMarks: num(m.maxMarks) })),
      teacherRemarks: report?.teacherRemarks ?? null,
      principalRemarks: report?.principalRemarks ?? null,
    };
  }

  /**
   * Generate / Edit Progress Report: the term's subject marks become exactly
   * the rows given (a subject left out is removed; the attendance and remarks
   * an uploaded sheet gave a subject are kept), and the remarks are saved.
   * A new report is in the student's batch now; an existing one stays in its
   * batch. Admins and teachers of that batch may write both remarks. Only
   * the marks that change are written, each keeping the batch it was entered
   * in; a teacher can't change or remove a mark entered in a batch that isn't
   * theirs (a student who moved batch): only an admin can.
   */
  async saveProgress(actor: Actor, dto: ProgressReportDto) {
    activeFacultyId(actor, WRITE_REFUSED);
    requireWritableYear(await yearContext(this.prisma, actor.schoolId), dto.year);
    const subjects = dto.subjects.map((s) => s.subject);
    if (new Set(subjects).size !== subjects.length) throw new BadRequestException('Each subject can be on the report once');
    for (const s of dto.subjects) if (s.marks > s.maxMarks) throw new BadRequestException(`${s.subject}: marks obtained can't be more than the total marks`);
    const updatedBy = await actorName(this.prisma, actor);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const [student] = await tx.$queryRaw<{ id: string; batchId: string | null }[]>`SELECT "id", "batchId" FROM "Student" WHERE "id" = ${dto.studentId} AND "schoolId" = ${actor.schoolId} FOR SHARE`;
        if (!student) throw new NotFoundException('Student not found');
        const key = { schoolId: actor.schoolId, studentId: dto.studentId, academicYear: dto.year, term: dto.term };
        // Lock the card's marks first, so a sheet or report delete running now
        // either waits for this save, then sees the report with its marks, or
        // goes first, and this save then sees the marks gone and writes them
        // back as new. Otherwise an unchanged save (which writes no marks)
        // could recreate the remarks after the delete dropped them, leaving a
        // report with no marks. FOR UPDATE, not FOR SHARE: two saves of one card
        // would each hold a share lock and then deadlock updating the rows.
        await tx.$queryRaw`SELECT 1 FROM "StudentMark" WHERE "schoolId" = ${actor.schoolId} AND "studentId" = ${dto.studentId} AND "academicYear" = ${dto.year}::int AND "term" = ${dto.term}::"ReportTerm" ORDER BY "id" FOR UPDATE`;
        const existing = await tx.studentMark.findMany({ where: key, select: { subject: true, batchId: true, marks: true, maxMarks: true, updatedAt: true, batch: { select: { name: true } } } });
        const batchId = latestBatch(existing) ?? student.batchId;
        if (!batchId) throw new BadRequestException('Assign the student to a batch before generating a report');
        if (isTeacher(actor) && !actor.scope.batchIds.includes(batchId)) throw new ForbiddenException("You aren't assigned to this student's batch");
        const own = batchScope(actor);
        const bySubject = new Map(existing.map((m) => [m.subject, m]));
        const changed = dto.subjects.filter((s) => {
          const m = bySubject.get(s.subject);
          return !m || num(m.marks) !== s.marks || num(m.maxMarks) !== s.maxMarks;
        });
        for (const m of existing) {
          if (own === null || own.includes(m.batchId)) continue;
          if (!subjects.includes(m.subject)) throw new ForbiddenException(`${m.subject} was entered in ${m.batch.name}; only an admin can remove it`);
          if (changed.some((s) => s.subject === m.subject)) throw new ForbiddenException(`${m.subject} was entered in ${m.batch.name}; only an admin can change it`);
        }
        await tx.$queryRaw`SELECT 1 FROM "Batch" WHERE "id" = ${batchId} AND "schoolId" = ${actor.schoolId} FOR SHARE`;
        await tx.studentMark.deleteMany({ where: { ...key, subject: { notIn: subjects } } });
        if (changed.length) {
          const rows = changed.map((s) => ({ batchId: bySubject.get(s.subject)?.batchId ?? batchId, studentId: dto.studentId, subject: s.subject, marks: s.marks, maxMarks: s.maxMarks, attendance: undefined, remarks: undefined }));
          await upsertMarks(tx, actor, { year: dto.year, term: dto.term, source: 'MANUAL', enteredBy: updatedBy }, rows);
        }
        const remarks = { teacherRemarks: dto.teacherRemarks ?? null, principalRemarks: dto.principalRemarks ?? null, updatedById: actor.userId, updatedBy };
        await tx.progressReport.upsert({
          where: { studentId_academicYear_term: { studentId: dto.studentId, academicYear: dto.year, term: dto.term } },
          create: { ...key, ...remarks },
          update: remarks,
        });
        return { created: existing.length === 0 };
      });
    } catch (err) {
      if (isForeignKeyViolation(err)) throw new BadRequestException('The student or batch was just changed. Refresh and try again.');
      throw err;
    }
  }

  /** Deletes a student's report for a term: its subject marks and remarks (a teacher's only when every mark is from their batches). */
  async removeProgress(actor: Actor, query: ProgressKeyQuery) {
    activeFacultyId(actor, WRITE_REFUSED);
    return this.prisma.$transaction(async (tx) => {
      const key = { schoolId: actor.schoolId, studentId: query.studentId, academicYear: query.year, term: query.term };
      const marks = await tx.studentMark.findMany({ where: key, select: { batchId: true, updatedAt: true, batch: { select: { name: true } } } });
      const batchId = latestBatch(marks);
      if (!batchId || (isTeacher(actor) && !actor.scope.batchIds.includes(batchId))) throw new NotFoundException('Progress report not found');
      const foreign = isTeacher(actor) ? marks.find((m) => !actor.scope.batchIds.includes(m.batchId)) : undefined;
      if (foreign) throw new ForbiddenException(`Some of this report's marks were entered in ${foreign.batch.name}; only an admin can delete them`);
      await tx.studentMark.deleteMany({ where: key });
      await tx.progressReport.deleteMany({ where: key });
      return { ok: true };
    });
  }

  /** Remarks of reports that no longer have any marks go too (a report is its marks plus remarks). */
  private async dropEmptyReports(tx: Prisma.TransactionClient, schoolId: string, studentIds: string[], year: number, term: ReportTermKey) {
    const left = await tx.studentMark.findMany({ where: { schoolId, academicYear: year, term, studentId: { in: studentIds } }, select: { studentId: true }, distinct: ['studentId'] });
    const keep = new Set(left.map((l) => l.studentId));
    const empty = studentIds.filter((id) => !keep.has(id));
    if (empty.length) await tx.progressReport.deleteMany({ where: { schoolId, academicYear: year, term, studentId: { in: empty } } });
  }
}

/** The batch of a report's newest mark: where the report (and its rank) belongs. */
function latestBatch(marks: { batchId: string; updatedAt: Date }[]): string | null {
  return marks.reduce<{ batchId: string; updatedAt: Date } | null>((a, m) => (!a || m.updatedAt > a.updatedAt ? m : a), null)?.batchId ?? null;
}

type ReadyMark = { studentId: string; marks: number; maxMarks: number; attendance: number | null | undefined; remarks: string | null | undefined };
type PriorMark = { batchId: string; batchName: string; enteredBy: string };

/**
 * Inserts or updates marks in one statement, by the student + year + term +
 * subject key, each row in the batch it names. `undefined` attendance or
 * remarks keep what a row has (a progress report edit); null clears them (a
 * sheet that leaves them blank).
 */
async function upsertMarks(
  tx: Prisma.TransactionClient,
  actor: Actor,
  set: { year: number; term: ReportTermKey; source: 'IMPORT' | 'MANUAL'; enteredBy: string },
  rows: (ReadyMark & { batchId: string; subject: string })[],
) {
  const keepExtras = rows.every((r) => r.attendance === undefined && r.remarks === undefined);
  const values = rows.map(
    (r) =>
      Prisma.sql`(${randomUUID()}, ${actor.schoolId}, ${r.studentId}, ${r.batchId}, ${set.year}::int, ${set.term}::"ReportTerm", ${r.subject}, ${r.marks}::numeric, ${r.maxMarks}::numeric,
        ${r.attendance ?? null}::numeric, ${r.remarks ?? null}::text, ${set.source}::"MarkSource", ${actor.userId}, ${set.enteredBy}, now(), now())`,
  );
  await tx.$executeRaw`
    INSERT INTO "StudentMark" ("id", "schoolId", "studentId", "batchId", "academicYear", "term", "subject", "marks", "maxMarks", "attendance", "remarks", "source", "enteredById", "enteredBy", "createdAt", "updatedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("studentId", "academicYear", "term", "subject") DO UPDATE SET
      "batchId" = EXCLUDED."batchId", "marks" = EXCLUDED."marks", "maxMarks" = EXCLUDED."maxMarks",
      ${keepExtras ? Prisma.empty : Prisma.sql`"attendance" = EXCLUDED."attendance", "remarks" = EXCLUDED."remarks",`}
      "source" = EXCLUDED."source", "enteredById" = EXCLUDED."enteredById", "enteredBy" = EXCLUDED."enteredBy", "updatedAt" = now()`;
}

function summary(applied: boolean, rows: ImportPreview['rows'], ready: unknown[]): ImportPreview {
  const created = rows.filter((r) => r.action === 'create').length;
  return { applied, created, updated: ready.length - created, skipped: rows.length - ready.length, rows };
}

const clean = (v: string | undefined) => (v ?? '').trim().replace(/\s+/g, ' ');
const nameKey = looseText;

/**
 * The same person: the full name as on the roster, ignoring letter case,
 * Latin accents, spacing and punctuation ("Mary-Jane D'Souza" = "mary jane d
 * souza"); a first name alone isn't enough (#50).
 */
export function sameName(rosterName: string, sheetName: string): boolean {
  const a = nameKey(rosterName);
  return !!a && a === nameKey(sheetName);
}

/** A number cell: blank is null; up to two decimals; "92%" reads as 92 where a percentage is allowed. */
function numberCell(value: string | undefined, label: string, errors: string[], opts: { required: boolean; percentSign?: boolean }): number | null {
  let text = clean(value).replace(/,/g, '');
  if (opts.percentSign) text = text.replace(/%$/, '').trim();
  if (!text) {
    if (opts.required) errors.push(`${label} is required`);
    return null;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    errors.push(`${label} must be a number with up to two decimals`);
    return null;
  }
  return Number(text);
}

/**
 * Each row of a sheet checked against the batch's students (exported for the
 * tests). A student who already has a mark for the term and subject from
 * another batch (they moved since) is shown as replacing it, by whom it was
 * entered; for a teacher (`own`: their batches) who doesn't teach that batch
 * the row is refused, as only an admin can replace it.
 */
export function checkSheet(
  sheet: MarkImportRow[],
  batch: { id: string; name: string },
  roster: { id: string; fullName: string; rollNumber: string | null }[],
  existing: Map<string, PriorMark>,
  own: string[] | null,
) {
  const batchName = batch.name;
  const byRoll = new Map(roster.filter((s) => s.rollNumber).map((s) => [s.rollNumber!.toUpperCase(), s]));
  const seen = new Map<string, number>();
  const ready: ReadyMark[] = [];
  const rows: ImportPreview['rows'] = sheet.map((r, i) => {
    const row = i + 2; // the header is row 1
    const errors: string[] = [];
    const roll = clean(r.rollNo).toUpperCase();
    const name = clean(r.name);
    if (!roll) errors.push('Roll No is required');
    if (!name) errors.push('Name is required');
    const student = roll ? byRoll.get(roll) : undefined;
    if (roll && !student) errors.push(`No student with Roll No ${roll} in ${batchName}`);
    else if (student && name && !sameName(student.fullName, name)) errors.push(`Roll No ${roll} is ${student.fullName} in ${batchName}, not ${name}`);
    if (roll && seen.has(roll)) errors.push(`Roll No ${roll} appears twice in this file (row ${seen.get(roll)})`);
    else if (roll) seen.set(roll, row);
    const marks = numberCell(r.marks, 'Marks', errors, { required: true });
    const maxMarks = numberCell(r.maxMarks, 'Max Marks', errors, { required: true });
    if (maxMarks !== null && (maxMarks <= 0 || maxMarks > MAX_MAX_MARKS)) errors.push(`Max Marks must be more than 0 and at most ${MAX_MAX_MARKS}`);
    if (marks !== null && maxMarks !== null && marks > maxMarks) errors.push(`Marks (${marks}) can't be more than Max Marks (${maxMarks})`);
    const attendance = numberCell(r.attendance, 'Attendance', errors, { required: false, percentSign: true });
    if (attendance !== null && attendance > 100) errors.push('Attendance must be a percentage from 0 to 100');
    const remarks = clean(r.remarks) || null;
    if (remarks && remarks.length > MAX_REMARKS) errors.push(`Remarks must be at most ${MAX_REMARKS} characters`);
    const prior = student ? existing.get(student.id) : undefined;
    const moved = prior && prior.batchId !== batch.id ? prior : null;
    if (moved && own && !own.includes(moved.batchId)) errors.push(`${student!.fullName}'s mark for this term and subject was entered in ${moved.batchName} by ${moved.enteredBy}; only an admin can replace it`);
    const label = `${roll || '—'} · ${student?.fullName ?? (name || '(no name)')}${moved ? ` (replaces the mark entered in ${moved.batchName} by ${moved.enteredBy})` : ''}`;
    if (errors.length) return { row, label, action: 'error' as const, errors };
    ready.push({ studentId: student!.id, marks: marks!, maxMarks: maxMarks!, attendance, remarks });
    return { row, label, action: prior ? ('update' as const) : ('create' as const), errors };
  });
  return { rows, ready };
}
