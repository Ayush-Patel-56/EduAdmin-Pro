import { Injectable, NotFoundException } from '@nestjs/common';
import { isTeacher, type Actor } from '../assessments/actor.js';
import { toIsoDate, istParts } from '../common/dates.js';
import { likeEscape } from '../common/like-escape.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  attendanceRate,
  behaviourScore,
  gradeOf,
  percent,
  rankScores,
  topicStrength,
  type AssignmentTopic,
  type TestTopic,
} from './report-math.js';
import { batchScope, yearChoices, yearContext } from './scope.js';
import type { StudentSearchQuery } from './student-reports.dto.js';

/** How many students a search returns: enough to pick from, never the roster. */
export const SEARCH_LIMIT = 20;
/** Recent incorrect answers, PTM notes and ratings listed on the report. */
export const RECENT_LIMIT = 20;
/** Tests of one student in a year that the report reads (far above any real timetable). */
const TESTS_LIMIT = 500;

const num = (v: Prisma.Decimal | string | number | null) => (v === null ? null : Number(v));

/**
 * The Student Reports Hub (PRD 4.5, 5.4; HLD 9.7): one student's 5-in-1
 * report for an academic year, worked out on demand from the records each
 * module owns. Nothing here writes. Admins open any student of their school,
 * teachers the students in their batches now; everything is read by school
 * and student, so one report never mixes in another student's or school's rows.
 */
@Injectable()
export class StudentReportService {
  constructor(private readonly prisma: PrismaService) {}

  /** Students by name, roll or admission number: just what the picker shows. */
  async search(actor: Actor, query: StudentSearchQuery) {
    const scope = batchScope(actor);
    if (scope && !scope.length) return [];
    if (query.batchId && scope && !scope.includes(query.batchId)) return [];
    const q = query.q?.trim();
    const like = q ? { contains: likeEscape(q), mode: 'insensitive' as const } : null;
    const rows = await this.prisma.student.findMany({
      where: {
        schoolId: actor.schoolId,
        ...(query.batchId ? { batchId: query.batchId } : scope ? { batchId: { in: scope } } : {}),
        ...(like && { OR: [{ fullName: like }, { rollNumber: like }, { admissionNumber: like }] }),
      },
      select: { id: true, fullName: true, rollNumber: true, status: true, batch: { select: { id: true, name: true } } },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
      take: SEARCH_LIMIT,
    });
    return rows;
  }

  async report(actor: Actor, studentId: string, year?: number | null) {
    const scope = batchScope(actor);
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, schoolId: actor.schoolId, ...(scope && { batchId: { in: scope } }) },
      select: {
        id: true,
        fullName: true,
        rollNumber: true,
        admissionNumber: true,
        classLevel: true,
        status: true,
        batchId: true,
        batch: { select: { id: true, name: true } },
        program: { select: { name: true } },
      },
    });
    if (!student) throw new NotFoundException('Student not found');
    const ctx = await yearContext(this.prisma, actor.schoolId, year);
    const s = { schoolId: actor.schoolId, studentId };
    const testRange = { status: 'SCHEDULED' as const, startsAt: { gte: ctx.fromInstant, lt: ctx.toInstant } };
    const dayRange = { gte: ctx.fromDate, lt: ctx.toDate };
    // Ratings count only from teachers still active in the school (#50): not an inactive or deleted profile.
    const ratingWhere = { ...s, date: dayRange, faculty: { status: { not: 'INACTIVE' as const } } };
    // A teacher reads only the ratings and PTM notes they wrote; the totals and averages are everyone's (#50).
    const ownOnly = isTeacher(actor) ? { facultyId: actor.scope.facultyId ?? '' } : {};

    const [results, answerGroups, testTopics, assignments, recentMistakes, ratingAvg, ratingDays, recentRatings, attendance, ptmMeetings, ptmAttended, ptm] = await Promise.all([
      this.prisma.testResult.findMany({
        where: { ...s, test: testRange },
        select: { present: true, marks: true, correct: true, incorrect: true, unattempted: true, test: { select: { id: true, title: true, type: true, subject: true, startsAt: true, totalMarks: true } } },
        orderBy: [{ test: { startsAt: 'desc' } }, { testId: 'asc' }],
        take: TESTS_LIMIT,
      }),
      this.prisma.$queryRaw<{ type: string; difficulty: string; subject: string; outcome: string; answers: number }[]>`
        SELECT q."type"::text AS "type", q."difficulty"::text AS "difficulty", q."subject", a."outcome"::text AS "outcome", count(*)::int AS "answers"
        FROM "TestAnswer" a
        JOIN "TestResult" r ON r."id" = a."resultId" AND r."schoolId" = a."schoolId"
        JOIN "TestQuestion" q ON q."id" = a."testQuestionId" AND q."schoolId" = a."schoolId"
        JOIN "Test" t ON t."id" = a."testId" AND t."schoolId" = a."schoolId"
        WHERE a."schoolId" = ${actor.schoolId} AND r."studentId" = ${studentId} AND r."present"
          AND t."status" = 'SCHEDULED' AND t."startsAt" >= ${ctx.fromInstant} AND t."startsAt" < ${ctx.toInstant}
        GROUP BY q."type", q."difficulty", q."subject", a."outcome"`,
      this.prisma.$queryRaw<{ subject: string; chapter: string | null; topic: string; latest: Date; questions: number; awarded: string; possible: number }[]>`
        SELECT q."subject", (array_agg(q."chapterName" ORDER BY t."startsAt" DESC, q."position") FILTER (WHERE q."chapterName" IS NOT NULL))[1] AS "chapter",
          (array_agg(q."topic" ORDER BY t."startsAt" DESC, q."position"))[1] AS "topic", max(t."startsAt") AS "latest", count(*)::int AS "questions",
          sum(a."marksAwarded")::text AS "awarded", sum(q."marks")::int AS "possible"
        FROM "TestAnswer" a
        JOIN "TestResult" r ON r."id" = a."resultId" AND r."schoolId" = a."schoolId"
        JOIN "TestQuestion" q ON q."id" = a."testQuestionId" AND q."schoolId" = a."schoolId"
        JOIN "Test" t ON t."id" = a."testId" AND t."schoolId" = a."schoolId"
        WHERE a."schoolId" = ${actor.schoolId} AND r."studentId" = ${studentId} AND r."present"
          AND t."status" = 'SCHEDULED' AND t."startsAt" >= ${ctx.fromInstant} AND t."startsAt" < ${ctx.toInstant}
        GROUP BY q."subject", regexp_replace(lower(btrim(q."topic")), '[[:space:]]+', ' ', 'g')`,
      this.prisma.assignmentSubmission.findMany({
        where: { ...s, score: { not: null }, assignment: { dueAt: { gte: ctx.fromInstant, lt: ctx.toInstant } } },
        select: { score: true, assignment: { select: { subject: true, chapter: true, topic: true, totalMarks: true } } },
        take: TESTS_LIMIT * 2,
      }),
      this.prisma.testAnswer.findMany({
        where: { schoolId: actor.schoolId, outcome: { in: ['INCORRECT', 'PARTIAL'] }, result: { studentId, present: true, test: testRange } },
        select: {
          outcome: true,
          response: true,
          marksAwarded: true,
          testQuestion: { select: { position: true, subject: true, chapterName: true, topic: true, difficulty: true, type: true, text: true, correctAnswer: true, marks: true } },
          result: { select: { test: { select: { id: true, title: true, startsAt: true } } } },
        },
        orderBy: [{ result: { test: { startsAt: 'desc' } } }, { testQuestion: { position: 'asc' } }],
        take: RECENT_LIMIT,
      }),
      this.prisma.dailyRating.aggregate({ where: ratingWhere, _avg: { attitude: true, behaviour: true, focus: true, interaction: true }, _count: { _all: true } }),
      this.prisma.dailyRating.groupBy({ by: ['date'], where: ratingWhere }),
      this.prisma.dailyRating.findMany({
        where: { ...ratingWhere, ...ownOnly },
        select: { date: true, raterName: true, attitude: true, behaviour: true, focus: true, interaction: true, notes: true },
        orderBy: [{ date: 'desc' }, { raterName: 'asc' }],
        take: RECENT_LIMIT,
      }),
      this.prisma.attendanceRecord.groupBy({ by: ['status'], where: { ...s, occurrence: { date: dayRange } }, _count: { _all: true } }),
      this.prisma.ptmNote.count({ where: { ...s, meetingDate: dayRange } }),
      this.prisma.ptmNote.count({ where: { ...s, meetingDate: dayRange, parentAttended: true } }),
      this.prisma.ptmNote.findMany({
        where: { ...s, meetingDate: dayRange, ...ownOnly },
        select: { meetingDate: true, teacherName: true, parentName: true, parentAttended: true, discussion: true, actionItems: true, followUpDate: true },
        orderBy: [{ meetingDate: 'desc' }, { createdAt: 'desc' }],
        take: RECENT_LIMIT,
      }),
    ]);

    // Header and Performance Report: the tests sat this year (absent excluded).
    const sat = results.filter((r) => r.present && r.marks !== null);
    const marks = sat.reduce((a, r) => a + Number(r.marks), 0);
    const totalMarks = sat.reduce((a, r) => a + r.test.totalMarks, 0);
    const overall = percent(marks, totalMarks);
    const [testRanks, batchRank] = await Promise.all([this.testRanks(actor.schoolId, studentId, sat.map((r) => r.test.id)), this.batchRank(actor.schoolId, student, overall, ctx)]);

    const bySubject = new Map<string, { marks: number; total: number; tests: number }>();
    for (const r of sat) {
      const acc = bySubject.get(r.test.subject) ?? { marks: 0, total: 0, tests: 0 };
      acc.marks += Number(r.marks);
      acc.total += r.test.totalMarks;
      acc.tests++;
      bySubject.set(r.test.subject, acc);
    }

    // Test Analysis: counts from every result that has them; type and difficulty from answers.
    const counted = sat.filter((r) => r.correct !== null || r.incorrect !== null || r.unattempted !== null);
    const correct = counted.reduce((a, r) => a + (r.correct ?? 0), 0);
    const incorrect = counted.reduce((a, r) => a + (r.incorrect ?? 0), 0);
    const unattempted = counted.reduce((a, r) => a + (r.unattempted ?? 0), 0);
    const attempted = correct + incorrect;
    const groupBy = <K extends 'type' | 'difficulty'>(key: K) => {
      const acc = new Map<string, { questions: number; correct: number; partial: number; incorrect: number; unattempted: number }>();
      for (const g of answerGroups) {
        const a = acc.get(g[key]) ?? { questions: 0, correct: 0, partial: 0, incorrect: 0, unattempted: 0 };
        a.questions += g.answers;
        if (g.outcome === 'CORRECT') a.correct += g.answers;
        else if (g.outcome === 'PARTIAL') a.partial += g.answers;
        else if (g.outcome === 'INCORRECT') a.incorrect += g.answers;
        else a.unattempted += g.answers;
        acc.set(g[key], a);
      }
      // A partly credited answer counts as correct (as on the result), and is shown apart.
      return [...acc.entries()].map(([k, a]) => ({ [key]: k, ...a, accuracy: percent(a.correct + a.partial, a.correct + a.partial + a.incorrect), attemptRate: percent(a.questions - a.unattempted, a.questions) }) as Record<K, string> & typeof a & { accuracy: number | null; attemptRate: number | null });
    };
    const outcomeBySubject = new Map<string, { incorrect: number; partial: number; unattempted: number }>();
    for (const g of answerGroups) {
      if (g.outcome === 'CORRECT') continue;
      const a = outcomeBySubject.get(g.subject) ?? { incorrect: 0, partial: 0, unattempted: 0 };
      if (g.outcome === 'PARTIAL') a.partial += g.answers;
      else if (g.outcome === 'INCORRECT') a.incorrect += g.answers;
      else a.unattempted += g.answers;
      outcomeBySubject.set(g.subject, a);
    }
    const answered = answerGroups.reduce((a, g) => a + g.answers, 0);
    const outcomeTotal = (o: string) => answerGroups.filter((g) => g.outcome === o).reduce((a, g) => a + g.answers, 0);

    // Strength vs Weakness: test answers and graded assignments, by topic.
    const topics = topicStrength(
      testTopics.map((t): TestTopic => ({ subject: t.subject, chapter: t.chapter, topic: t.topic, latest: t.latest, questions: t.questions, awarded: Number(t.awarded), possible: t.possible })),
      assignments.map((a): AssignmentTopic => ({ subject: a.assignment.subject, chapter: a.assignment.chapter, topic: a.assignment.topic, score: Number(a.score), total: a.assignment.totalMarks })),
    );

    // Teacher Feedback: ratings, attendance, PTM notes.
    const avg = ratingAvg._avg;
    const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
    const ratings = ratingAvg._count._all
      ? {
          count: ratingAvg._count._all,
          days: ratingDays.length,
          attitude: round1(avg.attitude),
          behaviour: round1(avg.behaviour),
          focus: round1(avg.focus),
          interaction: round1(avg.interaction),
          score: behaviourScore(avg),
        }
      : null;
    const statusCount = (status: string) => attendance.find((a) => a.status === status)?._count._all ?? 0;
    const att = { present: statusCount('PRESENT'), late: statusCount('LATE'), absent: statusCount('ABSENT'), excused: statusCount('EXCUSED') };

    return {
      generatedAt: new Date().toISOString(),
      year: { year: ctx.year, label: ctx.label, from: toIsoDate(ctx.fromDate), to: toIsoDate(new Date(ctx.toDate.getTime() - 86_400_000)), current: ctx.current },
      years: yearChoices(ctx.current),
      student: {
        id: student.id,
        fullName: student.fullName,
        rollNumber: student.rollNumber,
        admissionNumber: student.admissionNumber,
        classLevel: student.classLevel,
        status: student.status,
        batch: student.batch,
        program: student.program?.name ?? null,
      },
      summary: {
        overallPercent: overall,
        grade: gradeOf(overall),
        marks: sat.length ? Math.round(marks * 100) / 100 : null,
        totalMarks: sat.length ? totalMarks : null,
        testsTaken: sat.length,
        testsAbsent: results.length - sat.length,
        batchRank,
        accuracy: percent(correct, attempted),
        attemptRate: percent(attempted, attempted + unattempted),
        behaviourScore: ratings?.score ?? null,
        attendanceRate: attendanceRate(att),
        ptmMeetings,
      },
      performance: {
        subjects: [...bySubject.entries()]
          .map(([subject, a]) => {
            const p = percent(a.marks, a.total);
            return { subject, marks: Math.round(a.marks * 100) / 100, totalMarks: a.total, percent: p, grade: gradeOf(p), tests: a.tests };
          })
          .sort((a, b) => a.subject.localeCompare(b.subject)),
        tests: results.map((r) => {
          const m = num(r.marks);
          const p = r.present && m !== null ? percent(m, r.test.totalMarks) : null;
          const rank = testRanks.get(r.test.id) ?? null;
          return {
            id: r.test.id,
            title: r.test.title,
            type: r.test.type,
            subject: r.test.subject,
            date: istParts(r.test.startsAt)[0],
            present: r.present,
            marks: m,
            totalMarks: r.test.totalMarks,
            percent: p,
            grade: gradeOf(p),
            rank: rank?.rank ?? null,
            of: rank?.of ?? null,
            percentile: rank?.percentile ?? null,
          };
        }),
      },
      analysis: {
        questions: attempted + unattempted,
        attempted,
        correct,
        incorrect,
        unattempted,
        accuracy: percent(correct, attempted),
        attemptRate: percent(attempted, attempted + unattempted),
        testsCounted: counted.length,
        answered,
        byType: groupBy('type'),
        byDifficulty: groupBy('difficulty'),
      },
      topics: {
        strong: topics.filter((t) => t.band === 'STRONG'),
        average: topics.filter((t) => t.band === 'AVERAGE'),
        weak: topics.filter((t) => t.band === 'WEAK').reverse(),
      },
      mistakes: {
        incorrect: outcomeTotal('INCORRECT'),
        partial: outcomeTotal('PARTIAL'),
        unattempted: outcomeTotal('UNATTEMPTED'),
        bySubject: [...outcomeBySubject.entries()].map(([subject, a]) => ({ subject, ...a })).sort((a, b) => b.incorrect + b.partial + b.unattempted - (a.incorrect + a.partial + a.unattempted)),
        recent: recentMistakes.map((a) => ({
          test: { id: a.result.test.id, title: a.result.test.title, date: istParts(a.result.test.startsAt)[0] },
          question: a.testQuestion.position,
          subject: a.testQuestion.subject,
          chapter: a.testQuestion.chapterName,
          topic: a.testQuestion.topic,
          difficulty: a.testQuestion.difficulty,
          type: a.testQuestion.type,
          text: a.testQuestion.text.length > 300 ? `${a.testQuestion.text.slice(0, 300)}…` : a.testQuestion.text,
          response: a.response,
          correctAnswer: a.testQuestion.type === 'SUBJECTIVE' ? null : a.testQuestion.correctAnswer,
          marksAwarded: Number(a.marksAwarded),
          marks: a.testQuestion.marks,
          outcome: a.outcome,
        })),
      },
      feedback: {
        /** The lists below hold only this teacher's own ratings and notes (the totals are everyone's). */
        ownOnly: isTeacher(actor),
        ratings,
        recentRatings: recentRatings.map((r) => ({ date: toIsoDate(r.date), raterName: r.raterName, attitude: r.attitude, behaviour: r.behaviour, focus: r.focus, interaction: r.interaction, notes: r.notes })),
        attendance: { ...att, classes: att.present + att.late + att.absent + att.excused, rate: attendanceRate(att) },
        ptm: {
          meetings: ptmMeetings,
          parentAttended: ptmAttended,
          parentAttendanceRate: percent(ptmAttended, ptmMeetings),
          notes: ptm.map((n) => ({
            date: toIsoDate(n.meetingDate),
            teacherName: n.teacherName,
            parentName: n.parentName,
            parentAttended: n.parentAttended,
            discussion: n.discussion,
            actionItems: n.actionItems,
            followUpDate: toIsoDate(n.followUpDate),
          })),
        },
      },
      /** What the report was worked out from (HLD 9.7: source coverage). */
      coverage: {
        tests: results.length,
        answers: answered,
        gradedAssignments: assignments.length,
        ratings: ratingAvg._count._all,
        classes: att.present + att.late + att.absent + att.excused,
        ptmNotes: ptmMeetings,
      },
    };
  }

  /** The student's rank and percentile on each test sat, among those present (as on the results sheet). */
  private async testRanks(schoolId: string, studentId: string, testIds: string[]) {
    if (!testIds.length) return new Map<string, { rank: number; of: number; percentile: number }>();
    const rows = await this.prisma.$queryRaw<{ testId: string; rank: number; of: number }[]>`
      SELECT x."testId", x."rank"::int AS "rank", x."of"::int AS "of" FROM (
        SELECT r."testId", r."studentId", rank() OVER (PARTITION BY r."testId" ORDER BY r."marks" DESC) AS "rank", count(*) OVER (PARTITION BY r."testId") AS "of"
        FROM "TestResult" r WHERE r."schoolId" = ${schoolId} AND r."testId" IN (${Prisma.join(testIds)}) AND r."present" AND r."marks" IS NOT NULL
      ) x WHERE x."studentId" = ${studentId}`;
    return new Map(rows.map((r) => [r.testId, { rank: r.rank, of: r.of, percentile: Math.round(((r.of - r.rank + 1) / r.of) * 10000) / 100 }]));
  }

  /**
   * Batch Rank: among the active students of the student's batch now, by
   * each one's overall percentage on the tests they sat this year. None for a
   * student without a batch, not active, or without a test sat.
   */
  private async batchRank(schoolId: string, student: { id: string; batchId: string | null; status: string }, overall: number | null, ctx: { fromInstant: Date; toInstant: Date }) {
    if (!student.batchId || student.status !== 'ACTIVE' || overall === null) return null;
    const rows = await this.prisma.$queryRaw<{ studentId: string; marks: string; total: number }[]>`
      SELECT r."studentId", sum(r."marks")::text AS "marks", sum(t."totalMarks")::int AS "total"
      FROM "TestResult" r
      JOIN "Test" t ON t."id" = r."testId" AND t."schoolId" = r."schoolId"
      JOIN "Student" s ON s."id" = r."studentId" AND s."schoolId" = r."schoolId"
      WHERE r."schoolId" = ${schoolId} AND s."batchId" = ${student.batchId} AND s."status" = 'ACTIVE' AND r."present" AND r."marks" IS NOT NULL
        AND t."status" = 'SCHEDULED' AND t."startsAt" >= ${ctx.fromInstant} AND t."startsAt" < ${ctx.toInstant}
      GROUP BY r."studentId"`;
    const ranks = rankScores(rows.filter((r) => r.total > 0).map((r) => ({ id: r.studentId, score: percent(Number(r.marks), r.total)! })));
    const mine = ranks.get(student.id);
    if (!mine) return null;
    return { ...mine, topPercent: Math.max(1, Math.round((mine.rank / mine.of) * 100)) };
  }
}
