import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { TestsService } from '../src/assessments/tests.service.js';
import { MarksService } from '../src/student-reports/marks.service.js';
import { RatingsService } from '../src/student-reports/ratings.service.js';
import { StudentReportService } from '../src/student-reports/student-report.service.js';
import type { MarksImportDto } from '../src/student-reports/student-reports.dto.js';

/**
 * The student reports on a real database: the raw statements (rating and
 * mark upserts, batch and term ranks, sheet groups) and the 5-in-1 report
 * worked out from tests with and without papers, a graded assignment on the
 * same topic, ratings and PTM notes. Another school's identical data never
 * shows up.
 */
describe('student reports on the database (e2e)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const db = prisma as unknown as PrismaService;
  const tests = new TestsService(db);
  const marks = new MarksService(db);
  const ratings = new RatingsService(db);
  const reports = new StudentReportService(db);
  const id = () => randomUUID();
  const ids = { school: id(), other: id(), program: id(), batch: id(), user: id(), faculty: id(), t1: id(), t2: id(), q1: id(), q2: id(), q3: id(), s1: id(), s2: id(), s3: id(), assignment: id() };
  const admin = { kind: 'ADMIN' as const, schoolId: ids.school, userId: ids.user };
  const istToday = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const now = new Date(Date.now() + 5.5 * 3_600_000);
  const year = now.getUTCMonth() + 1 >= 4 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;

  beforeAll(async () => {
    const tag = ids.school.slice(0, 8);
    await prisma.user.create({ data: { id: ids.user, email: `sr-${tag}@e2e.test`, passwordHash: 'x', fullName: 'Report Admin', accountType: 'ADMIN' } });
    for (const [school, name] of [[ids.school, 'E2E SR'], [ids.other, 'E2E SR other']] as const) {
      await prisma.school.create({ data: { id: school, name: `${name} ${tag}`, inviteCode: `SR-${school.slice(0, 8)}`, board: 'CBSE' } });
    }
    await prisma.program.create({ data: { id: ids.program, schoolId: ids.school, name: 'JEE', isStandard: true, sortOrder: 1 } });
    await prisma.batch.create({ data: { id: ids.batch, schoolId: ids.school, programId: ids.program, name: 'B1', startDate: new Date('2026-04-01T00:00:00Z') } });
    await prisma.faculty.create({ data: { id: ids.faculty, schoolId: ids.school, name: 'Ms Rao' } });
    await prisma.student.createMany({
      data: [
        { id: ids.s1, schoolId: ids.school, fullName: 'Aarav Mehta', rollNumber: 'R01', batchId: ids.batch, status: 'ACTIVE' },
        { id: ids.s2, schoolId: ids.school, fullName: 'Diya Shah', rollNumber: 'R02', batchId: ids.batch, status: 'ACTIVE' },
        { id: ids.s3, schoolId: ids.school, fullName: 'Kabir Rao', rollNumber: 'R03', batchId: ids.batch, status: 'ACTIVE' },
      ],
    });
    const startsAt = new Date(Date.now() - 4 * 3_600_000);
    const test = (tid: string, title: string, totalMarks: number) => ({ id: tid, schoolId: ids.school, title, type: 'MOCK' as const, subject: 'Physics', batchId: ids.batch, startsAt, endsAt: new Date(startsAt.getTime() + 60 * 60_000), durationMinutes: 60, totalMarks, createdByName: 'Report Admin' });
    await prisma.test.createMany({ data: [test(ids.t1, 'Mock', 13), test(ids.t2, 'Unit', 20)] });
    const q = { schoolId: ids.school, testId: ids.t1, subject: 'Physics', chapterName: 'Thermal' };
    await prisma.testQuestion.createMany({
      data: [
        { ...q, id: ids.q1, position: 1, topic: 'Heat Transfer', difficulty: 'EASY', type: 'MCQ', text: 'Q1', options: ['a', 'b', 'c', 'd'], correctAnswer: 'B', marks: 4, negativeMarks: 1 },
        { ...q, id: ids.q2, position: 2, topic: 'Optics', difficulty: 'MEDIUM', type: 'INTEGER', text: 'Q2', correctAnswer: '12', marks: 4 },
        { ...q, id: ids.q3, position: 3, topic: 'heat  transfer', difficulty: 'HARD', type: 'SUBJECTIVE', text: 'Q3', marks: 5 },
      ],
    });
    await tests.saveResults(admin, ids.t1, {
      summaryOnly: true,
      results: [
        { studentId: ids.s1, present: true, answers: [{ testQuestionId: ids.q1, response: 'B' }, { testQuestionId: ids.q2, response: '12' }, { testQuestionId: ids.q3, marksAwarded: 3 }] },
        { studentId: ids.s2, present: true, answers: [{ testQuestionId: ids.q1, response: 'A' }] },
        { studentId: ids.s3, present: false },
      ],
    } as never);
    await tests.saveResults(admin, ids.t2, {
      summaryOnly: true,
      results: [
        { studentId: ids.s1, present: true, marks: 10, correct: 5, incorrect: 3, unattempted: 2 },
        { studentId: ids.s2, present: true, marks: 18 },
        { studentId: ids.s3, present: true, marks: 8 },
      ],
    } as never);
    await prisma.assignment.create({
      data: { id: ids.assignment, schoolId: ids.school, batchId: ids.batch, subject: 'Physics', title: 'HW', chapter: 'Thermal', topic: 'Heat Transfer', type: 'HOMEWORK', dueAt: new Date(), totalMarks: 20 },
    });
    await prisma.assignmentSubmission.create({ data: { schoolId: ids.school, assignmentId: ids.assignment, studentId: ids.s1, status: 'GRADED', score: 10 } });
    await prisma.ptmNote.createMany({
      data: [true, false].map((parentAttended) => ({ schoolId: ids.school, studentId: ids.s1, batchId: ids.batch, batchName: 'B1', facultyId: ids.faculty, teacherName: 'Ms Rao', meetingDate: new Date(`${istToday}T00:00:00Z`), parentAttended, discussion: 'Progress' })),
    });
  });

  afterAll(async () => {
    await prisma.studentMark.deleteMany({ where: { schoolId: ids.school } });
    await prisma.testResult.deleteMany({ where: { schoolId: ids.school } });
    await prisma.school.delete({ where: { id: ids.school } });
    await prisma.school.delete({ where: { id: ids.other } });
    await prisma.user.delete({ where: { id: ids.user } });
    await prisma.$disconnect();
  });

  const teacher = { schoolId: ids.school, facultyId: ids.faculty, batchIds: [ids.batch], programIds: [], active: true };
  const rate = (studentId: string, a: number, b: number, c: number, d: number) => ({ studentId, attitude: a, behaviour: b, focus: c, interaction: d });

  it('ratings: one row per student, day and teacher; saving again updates it', async () => {
    await ratings.save(teacher, { date: istToday, batchId: ids.batch, ratings: [rate(ids.s1, 3, 3, 3, 3), rate(ids.s2, 2, 2, 3, 3)] } as never);
    await ratings.save(teacher, { date: istToday, batchId: ids.batch, ratings: [rate(ids.s1, 5, 4, 4, 3)] } as never);
    const rows = await prisma.dailyRating.findMany({ where: { schoolId: ids.school, studentId: ids.s1 } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ attitude: 5, behaviour: 4, focus: 4, interaction: 3, raterName: 'Ms Rao', batchId: ids.batch });
  });

  it('the 5-in-1 report: header, test ranks, analysis, blended topics, mistakes and feedback', async () => {
    const r = await reports.report(admin, ids.s1);
    expect(r.summary).toMatchObject({ overallPercent: 63.64, grade: 'B+', testsTaken: 2, accuracy: 72.73, attemptRate: 84.62, behaviourScore: 4, ptmMeetings: 2, attendanceRate: null });
    expect(r.summary.batchRank).toEqual({ rank: 1, of: 3, percentile: 100, topPercent: 33 });
    expect(r.performance.tests.map((t) => `${t.title}:${t.rank}/${t.of}`).sort()).toEqual(['Mock:1/2', 'Unit:2/3']);
    expect(r.analysis.byType.map((t) => `${t.type}:${t.questions}:${t.accuracy}`).sort()).toEqual(['INTEGER:1:100', 'MCQ:1:100', 'SUBJECTIVE:1:100']);
    // Heat Transfer: tests 7/9 = 77.78 (two questions, any letter case), assignment 10/20 = 50 -> 63.89.
    expect(r.topics.average).toEqual([{ subject: 'Physics', chapter: 'Thermal', topic: 'Heat Transfer', percent: 63.89, band: 'AVERAGE', test: { questions: 2, percent: 77.78 }, assignments: { count: 1, percent: 50 } }]);
    expect(r.topics.strong.map((t) => t.topic)).toEqual(['Optics']);
    expect(r.mistakes).toMatchObject({ incorrect: 0, partial: 1, unattempted: 0 });
    expect(r.mistakes.recent[0]).toMatchObject({ question: 3, outcome: 'PARTIAL', marksAwarded: 3, correctAnswer: null });
    expect(r.feedback.ptm).toMatchObject({ meetings: 2, parentAttended: 1, parentAttendanceRate: 50 });
    expect(r.feedback.ratings).toMatchObject({ days: 1, count: 1, score: 4 });
    // Diya's negative marks count; Kabir's absence is left out of his.
    expect((await reports.report(admin, ids.s2)).summary).toMatchObject({ overallPercent: 51.52, grade: 'B', accuracy: 0 });
    expect((await reports.report(admin, ids.s3)).summary).toMatchObject({ overallPercent: 40, grade: 'C', testsTaken: 1, testsAbsent: 1 });
  });

  it("another school sees none of it, and a past year is empty", async () => {
    await expect(reports.report({ kind: 'ADMIN', schoolId: ids.other, userId: ids.user }, ids.s1)).rejects.toThrow('Student not found');
    expect(await reports.search({ kind: 'ADMIN', schoolId: ids.other, userId: ids.user }, { q: 'Aarav' })).toEqual([]);
    expect((await reports.report(admin, ids.s1, year - 1)).summary).toMatchObject({ overallPercent: null, testsTaken: 0, ptmMeetings: 0 });
  });

  it('term marks: an imported sheet, its group, term ranks within the batch, and a progress report edit', async () => {
    const sheet = (subject: string, rows: MarksImportDto['rows']) => ({ batchId: ids.batch, year, term: 'TERM_1', subject, dryRun: false, rows }) as MarksImportDto;
    const out = await marks.importMarks(admin, sheet('Physics', [
      { rollNo: 'r01', name: 'Aarav', marks: '72', maxMarks: '100', attendance: '91', remarks: 'Good' },
      { rollNo: 'R02', name: 'Diya Shah', marks: '45', maxMarks: '100' },
      { rollNo: 'R03', name: 'Kabir', marks: '38', maxMarks: '50' },
    ]));
    expect(out).toMatchObject({ applied: true, created: 3, skipped: 0 });
    await marks.importMarks(admin, sheet('Chemistry', [{ rollNo: 'R01', name: 'Aarav', marks: '60', maxMarks: '80' }]));
    const sets = await marks.sets(admin, { year });
    expect(sets.items.map((s) => `${s.subject}:${s.students}:${s.average}`).sort()).toEqual(['Chemistry:1:75', 'Physics:3:64.33']);
    let list = await marks.progressList(admin, { year, term: 'TERM_1' });
    expect(list.items.map((c) => `${c.student.fullName}:${c.percent}:${c.rank}/${c.of}`).sort()).toEqual(['Aarav Mehta:73.33:2/3', 'Diya Shah:45:3/3', 'Kabir Rao:76:1/3']);
    expect(list.kpis).toMatchObject({ total: 3, average: 64.78 });
    expect(list.kpis.toppers.map((c) => c.student.fullName)).toEqual(['Kabir Rao', 'Aarav Mehta', 'Diya Shah']);

    // An edit of Aarav's report: Chemistry left out goes; Physics keeps the sheet's attendance and remarks.
    await marks.saveProgress(admin, { studentId: ids.s1, year, term: 'TERM_1', subjects: [{ subject: 'Physics', marks: 80, maxMarks: 100 }], teacherRemarks: 'Steady', principalRemarks: null } as never);
    const physics = await prisma.studentMark.findMany({ where: { studentId: ids.s1, academicYear: year, term: 'TERM_1' } });
    expect(physics.map((m) => [m.subject, Number(m.marks), Number(m.attendance), m.remarks, m.source])).toEqual([['Physics', 80, 91, 'Good', 'MANUAL']]);
    list = await marks.progressList(admin, { year, term: 'TERM_1', q: 'aarav' });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ percent: 80, grade: 'A+', rank: 1, of: 3, teacherRemarks: 'Steady', reportedBy: 'Report Admin' });

    const overview = await marks.overview(admin, { year });
    // Heat Transfer (either spelling): Aarav's partial and Diya's wrong answer, Diya's skipped one.
    expect(overview.needsAttention.map((s) => s.subject)).toEqual([]);
    expect(overview.topPerformers[0].student.fullName).toBe('Aarav Mehta');
    expect(overview.mistakes.map((m) => `${m.subject}:${m.topic.toLowerCase().replace(/\s+/g, ' ')}:${m.wrong}:${m.skipped}`).sort()).toEqual(['Physics:heat transfer:2:1', 'Physics:optics:0:1']);
    // Nothing of this school's in the other one's views.
    const other = { kind: 'ADMIN' as const, schoolId: ids.other, userId: ids.user };
    expect((await marks.progressList(other, { year })).total).toBe(0);
    expect((await marks.sets(other, { year })).total).toBe(0);
  });

  it("a student who moved batch: the new batch's teacher can't overwrite or delete the marks entered in the old one", async () => {
    const a2 = id();
    const [ravi, sita, r1] = [id(), id(), id()];
    await prisma.batch.create({ data: { id: a2, schoolId: ids.school, programId: ids.program, name: 'B2', startDate: new Date('2026-04-01T00:00:00Z') } });
    await prisma.faculty.createMany({ data: [{ id: ravi, schoolId: ids.school, name: 'Ravi Kumar' }, { id: sita, schoolId: ids.school, name: 'Sita Iyer' }] });
    await prisma.student.create({ data: { id: r1, schoolId: ids.school, fullName: 'Rohan Das', rollNumber: 'M01', batchId: ids.batch, status: 'ACTIVE' } });
    const asTeacher = (facultyId: string, batchId: string) => ({ kind: 'TEACHER' as const, schoolId: ids.school, userId: ids.user, scope: { schoolId: ids.school, facultyId, batchIds: [batchId], programIds: [], active: true } });
    const raviActor = asTeacher(ravi, ids.batch);
    const sitaActor = asTeacher(sita, a2);
    const sheet = (batchId: string, subject: string, marks: string, dryRun: boolean) =>
      ({ batchId, year, term: 'TERM_2', subject, dryRun, rows: [{ rollNo: 'M01', name: 'Rohan', marks, maxMarks: '50' }] }) as MarksImportDto;
    const physics = () => prisma.studentMark.findFirstOrThrow({ where: { studentId: r1, academicYear: year, term: 'TERM_2', subject: 'Physics' } });

    // Ravi enters Rohan's Physics in B1; Rohan then moves to B2.
    await marks.importMarks(raviActor, sheet(ids.batch, 'Physics', '44', false));
    await prisma.student.update({ where: { id: r1 }, data: { batchId: a2 } });

    // Sita's B2 sheet can't replace it: a row error in the preview, nothing written on apply.
    const preview = await marks.importMarks(sitaActor, sheet(a2, 'Physics', '10', true));
    expect(preview.rows[0]).toMatchObject({ action: 'error', errors: ["Rohan Das's mark for this term and subject was entered in B1 by Ravi Kumar; only an admin can replace it"] });
    expect(await marks.importMarks(sitaActor, sheet(a2, 'Physics', '10', false))).toMatchObject({ applied: true, created: 0, updated: 0, skipped: 1 });
    expect(await physics()).toMatchObject({ batchId: ids.batch, enteredBy: 'Ravi Kumar' });
    expect(Number((await physics()).marks)).toBe(44);
    // An admin sees what the row replaces.
    expect((await marks.importMarks(admin, sheet(a2, 'Physics', '10', true))).rows[0]).toMatchObject({ action: 'update', label: 'M01 · Rohan Das (replaces the mark entered in B1 by Ravi Kumar)' });

    // Sita adds Mathematics in B2, so the card is now in her batch.
    await marks.importMarks(sitaActor, sheet(a2, 'Mathematics', '30', false));
    const card = { studentId: r1, year, term: 'TERM_2' as const };
    expect((await marks.progressOne(sitaActor, card)).subjects.map((x) => x.subject)).toEqual(['Mathematics', 'Physics']);
    // Saving with only Mathematics, or with Physics changed, is refused; deleting the card too.
    await expect(marks.saveProgress(sitaActor, { ...card, subjects: [{ subject: 'Mathematics', marks: 35, maxMarks: 50 }] } as never)).rejects.toThrow('Physics was entered in B1; only an admin can remove it');
    await expect(marks.saveProgress(sitaActor, { ...card, subjects: [{ subject: 'Physics', marks: 10, maxMarks: 50 }, { subject: 'Mathematics', marks: 30, maxMarks: 50 }] } as never)).rejects.toThrow('Physics was entered in B1; only an admin can change it');
    await expect(marks.removeProgress(sitaActor, card)).rejects.toThrow("Some of this report's marks were entered in B1; only an admin can delete them");
    // Keeping Physics as it is, her own subject saves, and Physics stays B1's.
    await marks.saveProgress(sitaActor, { ...card, subjects: [{ subject: 'Physics', marks: 44, maxMarks: 50 }, { subject: 'Mathematics', marks: 36, maxMarks: 50 }], teacherRemarks: 'Settling in' } as never);
    expect(await physics()).toMatchObject({ batchId: ids.batch, enteredBy: 'Ravi Kumar' });
    expect(Number((await physics()).marks)).toBe(44);
    expect(Number((await prisma.studentMark.findFirstOrThrow({ where: { studentId: r1, term: 'TERM_2', subject: 'Mathematics' } })).marks)).toBe(36);
    // B1's sheet still lists Rohan.
    expect((await marks.set(admin, { batchId: ids.batch, year, term: 'TERM_2', subject: 'Physics' })).map((r) => r.student.fullName)).toEqual(['Rohan Das']);
    // An admin can delete the card.
    await expect(marks.removeProgress(admin, card)).resolves.toEqual({ ok: true });
    expect(await prisma.studentMark.count({ where: { studentId: r1 } })).toBe(0);
  }, 60_000);

  it('a card save that changes only the total marks is saved (and refused for a teacher on an old-batch mark)', async () => {
    const [b3, b4, r1] = [id(), id(), id()];
    await prisma.batch.createMany({ data: [{ id: b3, schoolId: ids.school, programId: ids.program, name: 'B3', startDate: new Date('2026-04-01T00:00:00Z') }, { id: b4, schoolId: ids.school, programId: ids.program, name: 'B4', startDate: new Date('2026-04-01T00:00:00Z') }] });
    await prisma.student.create({ data: { id: r1, schoolId: ids.school, fullName: 'Meera Nair', rollNumber: 'T01', batchId: b3, status: 'ACTIVE' } });
    const sheet = (batchId: string, subject: string) => ({ batchId, year, term: 'TERM_1', subject, dryRun: false, rows: [{ rollNo: 'T01', name: 'Meera', marks: '40', maxMarks: '50' }] }) as MarksImportDto;
    const card = { studentId: r1, year, term: 'TERM_1' as const };
    const mark = (subject: string) => prisma.studentMark.findFirstOrThrow({ where: { studentId: r1, term: 'TERM_1', subject } });
    await marks.importMarks(admin, sheet(b3, 'Physics'));
    await marks.saveProgress(admin, { ...card, subjects: [{ subject: 'Physics', marks: 40, maxMarks: 60 }] } as never);
    expect(Number((await mark('Physics')).maxMarks)).toBe(60);
    expect(await mark('Physics')).toMatchObject({ source: 'MANUAL', batchId: b3 });
    // Moved to B4: B4's teacher can't change only the total of B3's mark either.
    await prisma.student.update({ where: { id: r1 }, data: { batchId: b4 } });
    const b4Teacher = { kind: 'TEACHER' as const, schoolId: ids.school, userId: ids.user, scope: { schoolId: ids.school, facultyId: ids.faculty, batchIds: [b4], programIds: [], active: true } };
    await marks.importMarks(b4Teacher, sheet(b4, 'Mathematics'));
    await expect(marks.saveProgress(b4Teacher, { ...card, subjects: [{ subject: 'Physics', marks: 40, maxMarks: 50 }, { subject: 'Mathematics', marks: 40, maxMarks: 50 }] } as never)).rejects.toThrow('Physics was entered in B3; only an admin can change it');
    expect(Number((await mark('Physics')).maxMarks)).toBe(60);
    await marks.removeProgress(admin, card);
  }, 60_000);

  it('a sheet deleted while its card is saved unchanged leaves no report without marks', async () => {
    const [b5, r1] = [id(), id()];
    await prisma.batch.create({ data: { id: b5, schoolId: ids.school, programId: ids.program, name: 'B5', startDate: new Date('2026-04-01T00:00:00Z') } });
    await prisma.student.create({ data: { id: r1, schoolId: ids.school, fullName: 'Ishaan Roy', rollNumber: 'U01', batchId: b5, status: 'ACTIVE' } });
    const card = { studentId: r1, year, term: 'TERM_1' as const };
    const physics = [{ subject: 'Physics', marks: 40, maxMarks: 50 }];
    await marks.importMarks(admin, { batchId: b5, year, term: 'TERM_1', subject: 'Physics', dryRun: false, rows: [{ rollNo: 'U01', name: 'Ishaan', marks: '40', maxMarks: '50' }] } as MarksImportDto);
    await marks.saveProgress(admin, { ...card, subjects: physics, teacherRemarks: 'First' } as never);
    // The sheet delete has removed the marks and the then-empty report but not
    // committed yet, when a save of the card with Physics unchanged comes in.
    let save: Promise<unknown> = Promise.resolve();
    await prisma.$transaction(async (tx) => {
      const where = { studentId: r1, academicYear: year, term: 'TERM_1' as const };
      await tx.studentMark.deleteMany({ where });
      await tx.progressReport.deleteMany({ where });
      save = marks.saveProgress(admin, { ...card, subjects: physics, teacherRemarks: 'Second' } as never);
      save.catch(() => undefined);
      await new Promise((r) => setTimeout(r, 1000));
    }, { timeout: 20_000 });
    await save;
    // The save waited for the delete, then wrote Physics back with its remarks.
    expect(await prisma.progressReport.count({ where: { studentId: r1 } })).toBe(1);
    expect(await prisma.studentMark.count({ where: { studentId: r1 } })).toBe(1);
    await marks.removeProgress(admin, card);
  }, 60_000);

  it('ratings: the batch end day can be rated, the day after it cannot', async () => {
    const [b6, r1] = [id(), id()];
    await prisma.batch.create({ data: { id: b6, schoolId: ids.school, programId: ids.program, name: 'B6', startDate: new Date('2026-04-01T00:00:00Z'), endDate: new Date('2026-05-31T00:00:00Z') } });
    await prisma.student.create({ data: { id: r1, schoolId: ids.school, fullName: 'Tara Sen', rollNumber: 'V01', batchId: b6, status: 'ACTIVE' } });
    const scope = { ...teacher, batchIds: [b6] };
    await expect(ratings.save(scope, { date: '2026-05-31', batchId: b6, ratings: [rate(r1, 4, 4, 4, 4)] } as never)).resolves.toEqual({ saved: 1 });
    await expect(ratings.save(scope, { date: '2026-06-01', batchId: b6, ratings: [rate(r1, 4, 4, 4, 4)] } as never)).rejects.toThrow('Pick a day on or before the batch ended (31 May 2026)');
    expect(await prisma.dailyRating.count({ where: { studentId: r1 } })).toBe(1);
    await prisma.dailyRating.deleteMany({ where: { studentId: r1 } });
  });
});
