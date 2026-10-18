import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SUBJECTS } from '../academic/academic-options.js';
import { istInstant, istParts, istWeekStart, parseDate } from '../common/dates.js';
import { likeEscape } from '../common/like-escape.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type Actor, activeFacultyId, actorName, isTeacher } from './actor.js';
import {
  DIFFICULTIES,
  type PaperDto,
  QUESTION_DEFAULTS,
  QUESTION_TYPES,
  type ResultInput,
  type ResultsDto,
  TEST_DEFAULTS,
  TEST_TYPES,
  type TestDto,
  type TestQuery,
  type TestStatusDto,
} from './assessments.dto.js';
import { averagePercent, classStats, gradeAnswer, type GradedAnswer, PASS_PERCENT, type PaperQuestion, percentOf, phaseOf, rankAndPercentile, type TestPhase, totalsOf } from './scoring.js';

const PAGE_SIZE = 20;
const DAY = 86_400_000;
const STUDENTS_CHANGED = "Some students aren't in this test's batch. Refresh and try again.";
const TX = { timeout: 60_000, maxWait: 10_000 };

const testInclude = {
  batch: { select: { id: true, name: true, program: { select: { id: true, name: true } } } },
  _count: { select: { questions: true, results: true } },
} satisfies Prisma.TestInclude;
type TestRow = Prisma.TestGetPayload<{ include: typeof testInclude }>;
type Db = Prisma.TransactionClient | PrismaService;

const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

/**
 * Tests, their papers and results (PRD 4.10, 5.11, 5.12; HLD 9.6). Tests are
 * administered outside the platform: staff schedule them, build the paper from
 * the bank, and enter each student's result, question by question when there
 * is a paper (what topic strength and mistake history need) or as totals.
 */
@Injectable()
export class TestsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The pickers both portals need: subjects, types, defaults, chapters, batches (and, for admins, faculty and programs). */
  async options(actor: Actor) {
    const teacher = isTeacher(actor);
    const [chapters, batches, faculty, programs] = await Promise.all([
      this.prisma.curriculumChapter.findMany({ where: { schoolId: actor.schoolId }, select: { id: true, name: true, subject: true }, orderBy: [{ subject: 'asc' }, { name: 'asc' }] }),
      this.prisma.batch.findMany({
        where: { schoolId: actor.schoolId, ...(teacher && { id: { in: actor.scope.batchIds } }) },
        select: { id: true, name: true, program: { select: { id: true, name: true } } },
        orderBy: { name: 'asc' },
      }),
      teacher ? [] : this.prisma.faculty.findMany({ where: { schoolId: actor.schoolId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      teacher ? [] : this.prisma.program.findMany({ where: { schoolId: actor.schoolId }, select: { id: true, name: true }, orderBy: { sortOrder: 'asc' } }),
    ]);
    return {
      today: istParts(new Date())[0],
      active: !teacher || actor.scope.active,
      /** The signed-in teacher's faculty id (they manage the tests and questions they created); null for admins. */
      facultyId: teacher ? actor.scope.facultyId : null,
      subjects: SUBJECTS,
      difficulties: DIFFICULTIES,
      questionTypes: QUESTION_TYPES,
      testTypes: TEST_TYPES,
      defaults: { ...TEST_DEFAULTS, marks: QUESTION_DEFAULTS.marks, negativeMarks: QUESTION_DEFAULTS.negativeMarks, source: QUESTION_DEFAULTS.source },
      chapters,
      batches,
      faculty,
      programs,
    };
  }

  // Tests

  async list(actor: Actor, query: TestQuery) {
    const where: Prisma.TestWhereInput = {
      schoolId: actor.schoolId,
      ...this.visible(actor),
      ...(query.batchId && { batchId: query.batchId }),
      ...(query.programId && { batch: { programId: query.programId } }),
      ...(query.type && { type: query.type }),
      ...(query.author === 'admin' ? { facultyId: null } : query.author ? { facultyId: query.author } : {}),
      ...rangeWhere(query.from, query.to),
      ...(query.q?.trim() && {
        OR: [
          { title: { contains: likeEscape(query.q.trim()), mode: 'insensitive' as const } },
          { subject: { contains: likeEscape(query.q.trim()), mode: 'insensitive' as const } },
          { batch: { name: { contains: likeEscape(query.q.trim()), mode: 'insensitive' as const } } },
        ],
      }),
    };
    const now = new Date();
    if (query.status) Object.assign(where, phaseWhere(query.status, now));
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? PAGE_SIZE;
    const [total, rows] = await Promise.all([
      this.prisma.test.count({ where }),
      this.prisma.test.findMany({ where, include: testInclude, orderBy: [{ startsAt: query.from ? 'asc' : 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { total, page, pageSize, items: rows.map((t) => toTest(t, now)) };
  }

  async create(actor: Actor, dto: TestDto) {
    const facultyId = activeFacultyId(actor);
    await this.requireBatch(actor, dto.batchId);
    const startsAt = testStart(dto, null);
    const row = await this.prisma.test.create({
      data: {
        schoolId: actor.schoolId,
        title: dto.title,
        type: dto.type,
        subject: dto.subject,
        batchId: dto.batchId,
        startsAt,
        endsAt: endOf(startsAt, dto.durationMinutes),
        durationMinutes: dto.durationMinutes,
        totalMarks: dto.totalMarks,
        facultyId,
        createdByName: await actorName(this.prisma, actor),
        createdById: actor.userId,
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  /**
   * Edits a test. Once results are recorded it stays with its batch (they are
   * that batch's results), it can't move to a time still to come (it was
   * held), and its total can't drop below a recorded score.
   */
  async update(actor: Actor, id: string, dto: TestDto) {
    await this.requireBatch(actor, dto.batchId);
    return this.prisma.$transaction(async (tx) => {
      const test = await this.lockOwned(tx, actor, id);
      const startsAt = testStart(dto, test.startsAt);
      const later = startsAt > new Date() && startsAt.getTime() !== test.startsAt.getTime();
      if (test.batchId !== dto.batchId || test.totalMarks > dto.totalMarks || later) {
        const recorded = await tx.testResult.aggregate({ where: { testId: id, schoolId: actor.schoolId }, _count: { _all: true }, _max: { marks: true } });
        if (recorded._count._all && test.batchId !== dto.batchId) throw new ConflictException("Results are recorded for this test, so it can't move to another batch");
        if (recorded._count._all && later) throw new ConflictException("Results are recorded for this test, so it can't move to a time still to come");
        const best = num(recorded._max.marks);
        if (best !== null && best > dto.totalMarks) throw new ConflictException(`A student scored ${best}, so total marks can't be less than that`);
      }
      await tx.test.update({
        where: { id },
        data: {
          title: dto.title,
          type: dto.type,
          subject: dto.subject,
          batchId: dto.batchId,
          startsAt,
          endsAt: endOf(startsAt, dto.durationMinutes),
          durationMinutes: dto.durationMinutes,
          totalMarks: dto.totalMarks,
        },
      });
      return { id };
    }, TX);
  }

  async setStatus(actor: Actor, id: string, dto: TestStatusDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockOwned(tx, actor, id);
      await tx.test.update({ where: { id }, data: dto.cancelled ? { status: 'CANCELLED', cancelledAt: new Date() } : { status: 'SCHEDULED', cancelledAt: null } });
      return { id, status: dto.cancelled ? 'CANCELLED' : 'SCHEDULED' };
    }, TX);
  }

  /** Deletes a test with no results; one with results is a record (cancel it instead). */
  async remove(actor: Actor, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockOwned(tx, actor, id);
      const results = await tx.testResult.count({ where: { testId: id, schoolId: actor.schoolId } });
      if (results) throw new ConflictException(`${results} result${results === 1 ? ' is' : 's are'} recorded for this test. Cancel it instead.`);
      await tx.test.delete({ where: { id } });
      return { ok: true };
    }, TX);
  }

  // Paper

  async detail(actor: Actor, id: string) {
    const test = await this.find(actor, id);
    const questions = await this.prisma.testQuestion.findMany({ where: { testId: id, schoolId: actor.schoolId }, orderBy: { position: 'asc' } });
    const answered = await this.prisma.testAnswer.count({ where: { schoolId: actor.schoolId, testQuestion: { testId: id } } });
    return {
      test: toTest(test, new Date()),
      paper: {
        questions: questions.map(toPaperQuestion),
        totalMarks: questions.reduce((n, q) => n + q.marks, 0),
        // Once answers are entered question by question, the paper is fixed.
        locked: answered > 0,
      },
      canEdit: this.canEdit(actor, test),
    };
  }

  /**
   * Sets the paper, in order. A question already on it keeps its copy (as it
   * was attached, even if since deleted from the bank); a new one is copied
   * from the bank now. Fixed once answers are recorded against it.
   */
  async setPaper(actor: Actor, id: string, dto: PaperDto) {
    activeFacultyId(actor);
    await this.find(actor, id);
    return this.prisma.$transaction(async (tx) => {
      await lockTest(tx, actor.schoolId, id);
      const answered = await tx.testAnswer.count({ where: { schoolId: actor.schoolId, testQuestion: { testId: id } } });
      if (answered) throw new ConflictException("Answers are recorded against this paper, so it can't change");
      const current = await tx.testQuestion.findMany({ where: { testId: id, schoolId: actor.schoolId } });
      const onPaper = new Map<string, (typeof current)[number]>();
      for (const q of current) {
        onPaper.set(q.id, q);
        if (q.questionId) onPaper.set(q.questionId, q);
      }
      const fresh = dto.questionIds.filter((qid) => !onPaper.has(qid));
      const bank = fresh.length ? await tx.question.findMany({ where: { id: { in: fresh }, schoolId: actor.schoolId } }) : [];
      if (bank.length !== fresh.length) throw new BadRequestException('The paper or the question bank changed since you opened it. Refresh and choose again.');
      const byId = new Map(bank.map((q) => [q.id, q]));
      const picked = dto.questionIds.map((qid) => {
        const kept = onPaper.get(qid);
        return kept ? { copy: kept, questionId: kept.questionId, keptId: kept.id } : { copy: byId.get(qid)!, questionId: qid, keptId: null };
      });
      // One question named twice (by its paper id and its bank id) would be on the paper twice.
      const keys = picked.map((p) => p.keptId ?? p.questionId);
      const bankIds = picked.flatMap((p) => (p.questionId ? [p.questionId] : []));
      if (new Set(keys).size !== keys.length || new Set(bankIds).size !== bankIds.length) throw new BadRequestException('A question can be on the paper only once');
      await tx.testQuestion.deleteMany({ where: { testId: id, schoolId: actor.schoolId } });
      if (picked.length) {
        await tx.testQuestion.createMany({
          data: picked.map(({ copy: q, questionId }, i) => {
            return {
              schoolId: actor.schoolId,
              testId: id,
              questionId,
              position: i + 1,
              subject: q.subject,
              chapterName: q.chapterName,
              topic: q.topic,
              difficulty: q.difficulty,
              type: q.type,
              text: q.text,
              options: q.options,
              correctAnswer: q.correctAnswer,
              marks: q.marks,
              negativeMarks: q.negativeMarks,
            };
          }),
        });
      }
      return { id, questions: dto.questionIds.length };
    }, TX);
  }

  // Results

  /** Test Results Entry (PRD 5.12): the batch's students, their results, ranks and the class performance. */
  async results(actor: Actor, id: string) {
    const test = await this.find(actor, id);
    return this.resultsView(this.prisma, actor, test);
  }

  /**
   * Saves results for students of the test's batch (or already graded on it).
   * With answers, marks and counts are worked out from them (every question of
   * the paper gets an outcome); without, the marks given are stored with any
   * counts. Under a lock on the test, so two saves can't interleave.
   */
  async saveResults(actor: Actor, id: string, dto: ResultsDto) {
    activeFacultyId(actor);
    const found = await this.find(actor, id);
    const grader = await actorName(this.prisma, actor);
    try {
      await this.prisma.$transaction(async (tx) => {
        // The batch first (shared), as deleting a batch locks it before counting
        // results: a batch delete and a save queue instead of losing results.
        await tx.$queryRaw`SELECT 1 FROM "Batch" WHERE "id" = ${found.batchId} AND "schoolId" = ${actor.schoolId} FOR SHARE`;
        const test = await lockTest(tx, actor.schoolId, id);
        if (test.status === 'CANCELLED') throw new ConflictException('This test is cancelled. Restore it before entering results.');
        if (test.startsAt > new Date()) throw new BadRequestException("This test hasn't started yet");
        const ids = dto.results.map((r) => r.studentId);
        if (new Set(ids).size !== ids.length) throw new BadRequestException('Each student can be graded only once');
        // The students too (shared): deleting a student locks it before counting
        // its results, so a delete running now waits and then refuses (409)
        // instead of the save failing on a student that just went.
        if (ids.length) await tx.$queryRaw`SELECT 1 FROM "Student" WHERE "id" IN (${Prisma.join(ids)}) AND "schoolId" = ${actor.schoolId} FOR SHARE`;
        const [roster, paper] = await Promise.all([this.roster(tx, actor.schoolId, test.id, test.batchId), tx.testQuestion.findMany({ where: { testId: id, schoolId: actor.schoolId }, orderBy: { position: 'asc' } })]);
        const students = new Map(roster.map((s) => [s.id, s]));
        const prepared = dto.results.map((r) => {
          const student = students.get(r.studentId);
          if (!student) throw new BadRequestException(STUDENTS_CHANGED);
          try {
            return { studentId: r.studentId, ...prepareResult(r, paper.map(toScoring), test.totalMarks) };
          } catch (err) {
            throw new BadRequestException(`${student.fullName}${student.rollNumber ? ` (${student.rollNumber})` : ''}: ${err instanceof Error ? err.message : 'invalid result'}`);
          }
        });
        // Three statements however many students: the results (insert or update), then their answers replaced.
        const saved = await upsertResults(tx, actor.schoolId, id, prepared, { id: actor.userId, name: grader });
        const resultOf = new Map(saved.map((r) => [r.studentId, r.id]));
        await tx.testAnswer.deleteMany({ where: { schoolId: actor.schoolId, resultId: { in: saved.map((r) => r.id) } } });
        const answers = prepared.flatMap((p) =>
          p.answers.map((a) => ({ schoolId: actor.schoolId, testId: id, resultId: resultOf.get(p.studentId)!, testQuestionId: a.testQuestionId, response: a.response, outcome: a.outcome, marksAwarded: a.marksAwarded })),
        );
        if (answers.length) await tx.testAnswer.createMany({ data: answers });
      }, TX);
    } catch (err) {
      // A student removed by another request mid-save (the locks make this rare).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') throw new BadRequestException(STUDENTS_CHANGED);
      throw err;
    }
    // Built after the save commits, so the locks aren't held while the whole sheet is read.
    if (dto.summaryOnly) return { saved: dto.results.length };
    const full = await this.prisma.test.findUniqueOrThrow({ where: { id }, include: testInclude });
    return this.resultsView(this.prisma, actor, full);
  }

  /** Removes one student's result (it was entered by mistake). */
  async clearResult(actor: Actor, id: string, studentId: string) {
    activeFacultyId(actor);
    await this.find(actor, id);
    const { count } = await this.prisma.testResult.deleteMany({ where: { testId: id, studentId, schoolId: actor.schoolId } });
    if (!count) throw new NotFoundException('No result for that student');
    return { ok: true };
  }

  // Admin overview (PRD 4.10)

  /** KPIs, this week's tests and the average per batch on its latest graded mock test. */
  async overview(schoolId: string) {
    const now = new Date();
    const weekStart = istWeekStart(now);
    const weekEnd = new Date(weekStart.getTime() + 7 * DAY);
    const [week, totalQuestions, [avg], completed, mocks] = await Promise.all([
      this.prisma.test.findMany({ where: { schoolId, startsAt: { gte: weekStart, lt: weekEnd } }, include: testInclude, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }] }),
      this.prisma.question.count({ where: { schoolId } }),
      this.prisma.$queryRaw<{ average: number | null }[]>`
        SELECT round(avg(r."marks" / t."totalMarks" * 100), 2)::float AS "average"
        FROM "TestResult" r JOIN "Test" t ON t."id" = r."testId" AND t."schoolId" = r."schoolId"
        WHERE r."schoolId" = ${schoolId} AND r."present" AND t."status" = 'SCHEDULED'`,
      // Tests that ended in the last year, with their result counts.
      this.prisma.test.findMany({
        where: { schoolId, ...phaseWhere('COMPLETED', now), endsAt: { lte: now, gte: new Date(now.getTime() - 365 * DAY) } },
        select: { id: true, batchId: true, _count: { select: { results: true } } },
      }),
      this.prisma.test.findMany({
        where: { schoolId, status: 'SCHEDULED', type: 'MOCK', startsAt: { lt: now }, results: { some: { present: true } } },
        select: { id: true, title: true, batchId: true, totalMarks: true, startsAt: true, batch: { select: { name: true } }, results: { where: { present: true }, select: { marks: true } } },
        orderBy: { startsAt: 'desc' },
        take: 200,
      }),
    ]);
    // Pending grading: ended tests where fewer students have a result than the batch has active students.
    const rosters = completed.length
      ? await this.prisma.student.groupBy({ by: ['batchId'], where: { schoolId, status: 'ACTIVE', batchId: { in: [...new Set(completed.map((t) => t.batchId))] } }, _count: { _all: true } })
      : [];
    const rosterOf = new Map(rosters.map((r) => [r.batchId, r._count._all]));
    const pendingGrading = completed.filter((t) => (rosterOf.get(t.batchId) ?? 0) > t._count.results).length;
    const seen = new Set<string>();
    const batchAverages = mocks.flatMap((t) => {
      if (seen.has(t.batchId)) return [];
      seen.add(t.batchId);
      const marks = t.results.map((r) => Number(r.marks));
      return [{ batch: { id: t.batchId, name: t.batch.name }, test: { id: t.id, title: t.title, date: istParts(t.startsAt)[0] }, averagePercent: averagePercent(marks, t.totalMarks)!, students: marks.length }];
    });
    return {
      kpis: {
        scheduledThisWeek: week.filter((t) => t.status === 'SCHEDULED').length,
        totalQuestions,
        averageScore: avg?.average ?? null,
        pendingGrading,
      },
      week: { from: istParts(weekStart)[0], tests: week.map((t) => toTest(t, now)) },
      batchAverages,
    };
  }

  // Access

  /** Teachers see the tests of their batches; admins every test of the school. */
  private visible(actor: Actor): Prisma.TestWhereInput {
    return isTeacher(actor) ? { batchId: { in: actor.scope.batchIds } } : {};
  }

  private async find(actor: Actor, id: string): Promise<TestRow> {
    const test = await this.prisma.test.findFirst({ where: { id, schoolId: actor.schoolId, ...this.visible(actor) }, include: testInclude });
    if (!test) throw new NotFoundException('Test not found');
    return test;
  }

  /** Admins can change any test; a teacher the ones they created, for a batch still theirs. */
  private canEdit(actor: Actor, test: { facultyId: string | null; batchId: string }) {
    return !isTeacher(actor) || (actor.scope.active && !!actor.scope.facultyId && test.facultyId === actor.scope.facultyId && actor.scope.batchIds.includes(test.batchId));
  }

  /** The test, locked for the change, if this person may change it. */
  private async lockOwned(tx: Prisma.TransactionClient, actor: Actor, id: string) {
    activeFacultyId(actor);
    const test = await lockTest(tx, actor.schoolId, id);
    if (isTeacher(actor) && !actor.scope.batchIds.includes(test.batchId)) throw new NotFoundException('Test not found');
    if (!this.canEdit(actor, test)) throw new ForbiddenException('Only the teacher who created this test (or an admin) can change it');
    return test;
  }

  private async requireBatch(actor: Actor, batchId: string) {
    if (isTeacher(actor) && !actor.scope.batchIds.includes(batchId)) throw new ForbiddenException("You aren't assigned to that batch");
    const batch = await this.prisma.batch.findFirst({ where: { id: batchId, schoolId: actor.schoolId }, select: { id: true } });
    if (!batch) throw new BadRequestException('Select a batch of this school');
  }

  /** Who can be graded: the batch's active students now, and anyone already graded on this test. */
  private roster(db: Db, schoolId: string, testId: string, batchId: string) {
    return db.student.findMany({
      where: { schoolId, OR: [{ batchId, status: 'ACTIVE' }, { testResults: { some: { testId } } }] },
      select: { id: true, fullName: true, rollNumber: true, batchId: true },
      orderBy: [{ rollNumber: { sort: 'asc', nulls: 'last' } }, { fullName: 'asc' }, { id: 'asc' }],
    });
  }

  private async resultsView(db: Db, actor: Actor, test: TestRow) {
    const [roster, results, paper] = await Promise.all([
      this.roster(db, actor.schoolId, test.id, test.batchId),
      db.testResult.findMany({ where: { testId: test.id, schoolId: actor.schoolId }, include: { answers: { select: { testQuestionId: true, response: true, outcome: true, marksAwarded: true } } } }),
      db.testQuestion.findMany({ where: { testId: test.id, schoolId: actor.schoolId }, orderBy: { position: 'asc' } }),
    ]);
    const byStudent = new Map(results.map((r) => [r.studentId, r]));
    const scores = results.map((r) => ({ studentId: r.studentId, present: r.present, marks: num(r.marks) }));
    const ranks = rankAndPercentile(scores);
    return {
      test: toTest(test, new Date()),
      paper: paper.map(toPaperQuestion),
      stats: { ...classStats(scores, test.totalMarks), students: roster.length, passPercent: PASS_PERCENT },
      canGrade: !isTeacher(actor) || (actor.scope.active && !!actor.scope.facultyId),
      rows: roster.map((s) => {
        const r = byStudent.get(s.id);
        const marks = r ? num(r.marks) : null;
        const percent = marks === null ? null : percentOf(marks, test.totalMarks);
        return {
          student: { id: s.id, fullName: s.fullName, rollNumber: s.rollNumber, inBatch: s.batchId === test.batchId },
          result: r
            ? {
                present: r.present,
                marks,
                correct: r.correct,
                incorrect: r.incorrect,
                unattempted: r.unattempted,
                remarks: r.remarks,
                percent,
                passed: percent === null ? null : percent >= PASS_PERCENT,
                rank: ranks.get(s.id)?.rank ?? null,
                percentile: ranks.get(s.id)?.percentile ?? null,
                gradedBy: r.gradedBy,
                updatedAt: r.updatedAt.toISOString(),
                answers: r.answers.map((a) => ({ testQuestionId: a.testQuestionId, response: a.response, outcome: a.outcome, marksAwarded: Number(a.marksAwarded) })),
              }
            : null,
        };
      }),
    };
  }
}

/** One student's result checked and worked out (see TestsService.saveResults). */
export function prepareResult(r: ResultInput, paper: PaperQuestion[], totalMarks: number) {
  const remarks = r.remarks ?? null;
  if (!r.present) {
    if (r.answers?.length || (r.marks !== null && r.marks !== undefined)) throw new Error("An absent student can't have marks or answers");
    return { present: false, marks: null, correct: null, incorrect: null, unattempted: null, remarks, answers: [] as GradedAnswer[] };
  }
  if (r.answers?.length) {
    if (!paper.length) throw new Error('This test has no paper; enter total marks instead');
    const given = new Map<string, (typeof r.answers)[number]>();
    for (const a of r.answers) {
      if (given.has(a.testQuestionId)) throw new Error('A question was answered twice');
      given.set(a.testQuestionId, a);
    }
    if ([...given.keys()].some((qid) => !paper.some((q) => q.id === qid))) throw new Error('An answer is for a question not on this paper');
    // Every question of the paper gets an outcome: one not entered is unattempted.
    const answers = paper.map((q, i) => {
      try {
        return gradeAnswer(q, given.get(q.id) ?? {});
      } catch (err) {
        throw new Error(`Q${i + 1}: ${err instanceof Error ? err.message : 'invalid answer'}`);
      }
    });
    const totals = totalsOf(answers);
    if (totals.marks > totalMarks) throw new Error(`Scores ${totals.marks}, more than the test's ${totalMarks} marks; raise the test's total marks to the paper's`);
    return { present: true, ...totals, remarks, answers };
  }
  if (r.marks === null || r.marks === undefined) throw new Error('Enter the marks, or mark the student absent');
  if (r.marks > totalMarks || r.marks < -totalMarks) throw new Error(`Marks must be within ${totalMarks}`);
  const counts = [r.correct, r.incorrect, r.unattempted];
  if (paper.length && counts.reduce<number>((n, c) => n + (c ?? 0), 0) > paper.length) throw new Error(`Correct, incorrect and unattempted add up to more than the paper's ${paper.length} questions`);
  return { present: true, marks: r.marks, correct: r.correct ?? null, incorrect: r.incorrect ?? null, unattempted: r.unattempted ?? null, remarks, answers: [] as GradedAnswer[] };
}

type PreparedResult = ReturnType<typeof prepareResult> & { studentId: string };

/**
 * Inserts or updates the results of one test in one statement (one row per
 * student, by the test + student unique key), returning each result's id.
 */
async function upsertResults(tx: Prisma.TransactionClient, schoolId: string, testId: string, results: PreparedResult[], grader: { id: string; name: string }) {
  if (!results.length) return [];
  const rows = results.map(
    (p) =>
      Prisma.sql`(${randomUUID()}, ${schoolId}, ${testId}, ${p.studentId}, ${p.present}::boolean, ${p.marks}::numeric, ${p.correct}::int, ${p.incorrect}::int, ${p.unattempted}::int, ${p.remarks}::text, ${grader.id}, ${grader.name}, now(), now())`,
  );
  return tx.$queryRaw<{ id: string; studentId: string }[]>`
    INSERT INTO "TestResult" ("id", "schoolId", "testId", "studentId", "present", "marks", "correct", "incorrect", "unattempted", "remarks", "gradedById", "gradedBy", "createdAt", "updatedAt")
    VALUES ${Prisma.join(rows)}
    ON CONFLICT ("testId", "studentId") DO UPDATE SET
      "present" = EXCLUDED."present", "marks" = EXCLUDED."marks", "correct" = EXCLUDED."correct", "incorrect" = EXCLUDED."incorrect",
      "unattempted" = EXCLUDED."unattempted", "remarks" = EXCLUDED."remarks", "gradedById" = EXCLUDED."gradedById", "gradedBy" = EXCLUDED."gradedBy", "updatedAt" = now()
    RETURNING "id", "studentId"`;
}

async function lockTest(tx: Prisma.TransactionClient, schoolId: string, id: string) {
  const [row] = await tx.$queryRaw<{ id: string; batchId: string; facultyId: string | null; status: string; startsAt: Date; totalMarks: number }[]>`
    SELECT "id", "batchId", "facultyId", "status"::text AS "status", "startsAt", "totalMarks" FROM "Test" WHERE "id" = ${id} AND "schoolId" = ${schoolId} FOR UPDATE`;
  if (!row) throw new NotFoundException('Test not found');
  return row;
}

/** When a test with this start and length ends. */
const endOf = (startsAt: Date, minutes: number) => new Date(startsAt.getTime() + minutes * 60_000);

/** Tests are scheduled within a year either side of today; an edit may keep an older time as it is. */
function testStart(dto: TestDto, current: Date | null): Date {
  const startsAt = istInstant(dto.date, dto.time, 'Test date');
  if (current && startsAt.getTime() === current.getTime()) return startsAt;
  if (Math.abs(startsAt.getTime() - Date.now()) > 366 * DAY) throw new BadRequestException('Pick a test date within a year of today');
  return startsAt;
}

/** The tests in a phase, in the database: Ongoing and Completed follow from the clock (as in phaseOf). */
export function phaseWhere(phase: TestPhase, now: Date): Prisma.TestWhereInput {
  if (phase === 'CANCELLED') return { status: 'CANCELLED' };
  if (phase === 'SCHEDULED') return { status: 'SCHEDULED', startsAt: { gt: now } };
  if (phase === 'ONGOING') return { status: 'SCHEDULED', startsAt: { lte: now }, endsAt: { gt: now } };
  return { status: 'SCHEDULED', endsAt: { lte: now } };
}

/** Tests starting on the days from..to, in India (both inclusive). */
function rangeWhere(from: string | null | undefined, to: string | null | undefined): Prisma.TestWhereInput {
  if (!from && !to) return {};
  const IST = 5.5 * 3_600_000;
  const start = from ? new Date(parseDate(from, 'From').getTime() - IST) : undefined;
  const end = to ? new Date(parseDate(to, 'To').getTime() + DAY - IST) : undefined;
  if (start && end && end <= start) throw new BadRequestException("To can't be before from");
  return { startsAt: { ...(start && { gte: start }), ...(end && { lt: end }) } };
}

const toScoring = (q: { id: string; type: string; correctAnswer: string | null; marks: number; negativeMarks: number }): PaperQuestion => ({
  id: q.id,
  type: q.type as PaperQuestion['type'],
  correctAnswer: q.correctAnswer,
  marks: q.marks,
  negativeMarks: q.negativeMarks,
});

function toPaperQuestion(q: Prisma.TestQuestionGetPayload<object>) {
  return {
    id: q.id,
    questionId: q.questionId,
    position: q.position,
    subject: q.subject,
    chapterName: q.chapterName,
    topic: q.topic,
    difficulty: q.difficulty,
    type: q.type,
    text: q.text,
    options: q.options,
    correctAnswer: q.correctAnswer,
    marks: q.marks,
    negativeMarks: q.negativeMarks,
  };
}

export function toTest(t: TestRow, now: Date) {
  const [date, time] = istParts(t.startsAt);
  return {
    id: t.id,
    title: t.title,
    type: t.type,
    subject: t.subject,
    batch: { id: t.batch.id, name: t.batch.name },
    program: t.batch.program,
    date,
    time,
    startsAt: t.startsAt.toISOString(),
    durationMinutes: t.durationMinutes,
    totalMarks: t.totalMarks,
    phase: phaseOf(t, now),
    faculty: { id: t.facultyId, name: t.createdByName },
    questions: t._count.questions,
    results: t._count.results,
  };
}
