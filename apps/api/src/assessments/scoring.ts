// Grading and cohort rules for tests (HLD 9.6, 9.7). Kept pure so the 5-in-1
// student report reads exactly the numbers the results screens show.

export type QuestionType = 'MCQ' | 'NUMERICAL' | 'INTEGER' | 'SUBJECTIVE';
export type AnswerOutcome = 'CORRECT' | 'PARTIAL' | 'INCORRECT' | 'UNATTEMPTED';
export type PaperQuestion = { id: string; type: QuestionType; correctAnswer: string | null; marks: number; negativeMarks: number };
export type GradedAnswer = { testQuestionId: string; response: string | null; outcome: AnswerOutcome; marksAwarded: number };

/** The PRD's pass line for results filters (Passed at 50% or more). */
export const PASS_PERCENT = 50;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** "b", "(B)", "Option B" or "B." all mean B; anything else is not an MCQ answer. */
export function mcqLetter(text: string): string | null {
  const m = /^\s*(?:option\s*)?\(?\s*([a-d])\s*\)?\.?\s*$/i.exec(text);
  return m ? m[1].toUpperCase() : null;
}

/** A number as written ("42", "-3", "9.81"), or null. */
export function numberOf(text: string): number | null {
  const t = text.trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

/**
 * Grades one answer. Objective questions (MCQ, Integer, Numerical) are graded
 * from the student's response against the answer key: right earns the marks,
 * wrong loses the negative marks, blank is unattempted. A numerical answer is
 * right when it matches to two decimal places. Subjective answers are marked
 * by the teacher: full marks is correct, some is partial, none is incorrect,
 * and no mark at all means unattempted. Throws a message for a bad input.
 */
export function gradeAnswer(q: PaperQuestion, input: { response?: string | null; marksAwarded?: number | null }): GradedAnswer {
  if (q.type === 'SUBJECTIVE') {
    const awarded = input.marksAwarded;
    if (awarded === null || awarded === undefined) return { testQuestionId: q.id, response: null, outcome: 'UNATTEMPTED', marksAwarded: 0 };
    if (!Number.isFinite(awarded) || awarded < 0 || awarded > q.marks) throw new Error(`Marks for a ${q.marks}-mark question must be 0 to ${q.marks}`);
    const marks = round2(awarded);
    return { testQuestionId: q.id, response: null, outcome: marks === q.marks ? 'CORRECT' : marks === 0 ? 'INCORRECT' : 'PARTIAL', marksAwarded: marks };
  }
  const raw = input.response?.trim() ?? '';
  if (!raw) return { testQuestionId: q.id, response: null, outcome: 'UNATTEMPTED', marksAwarded: 0 };
  let response: string;
  let right: boolean;
  if (q.type === 'MCQ') {
    const letter = mcqLetter(raw);
    if (!letter) throw new Error('An MCQ answer is A, B, C or D');
    response = letter;
    right = letter === q.correctAnswer;
  } else {
    const value = numberOf(raw);
    if (value === null || (q.type === 'INTEGER' && !Number.isInteger(value))) throw new Error(q.type === 'INTEGER' ? 'An integer answer is a whole number' : 'A numerical answer is a number');
    const key = numberOf(q.correctAnswer ?? '');
    response = String(value);
    right = key !== null && round2(value) === round2(key);
  }
  return { testQuestionId: q.id, response, outcome: right ? 'CORRECT' : 'INCORRECT', marksAwarded: right ? q.marks : q.negativeMarks ? -q.negativeMarks : 0 };
}

/**
 * A result's totals from its answers. A partly credited subjective answer
 * counts as correct here (it earned marks); the answers keep PARTIAL apart for
 * the detailed reports. Correct + incorrect + unattempted = the paper's size.
 */
export function totalsOf(answers: GradedAnswer[]) {
  let marks = 0;
  let correct = 0;
  let incorrect = 0;
  let unattempted = 0;
  for (const a of answers) {
    marks += a.marksAwarded;
    if (a.outcome === 'UNATTEMPTED') unattempted++;
    else if (a.outcome === 'INCORRECT') incorrect++;
    else correct++;
  }
  return { marks: round2(marks), correct, incorrect, unattempted };
}

export const percentOf = (marks: number, total: number) => round2((marks / total) * 100);

/**
 * Rank and percentile among the students who were present (absent students
 * have neither). Ranks are competition ranks: equal marks share a rank and the
 * next rank skips (100, 90, 90, 80 -> 1, 2, 2, 4). The percentile is the NTA
 * one: the share of present students who scored the same or less, so the top
 * scorer is at 100 and equal marks share a percentile.
 */
export function rankAndPercentile(results: { studentId: string; present: boolean; marks: number | null }[]) {
  const present = results.filter((r) => r.present && r.marks !== null) as { studentId: string; marks: number }[];
  const n = present.length;
  const out = new Map<string, { rank: number; percentile: number }>();
  for (const r of present) {
    const above = present.filter((o) => o.marks > r.marks).length;
    const atOrBelow = present.filter((o) => o.marks <= r.marks).length;
    out.set(r.studentId, { rank: above + 1, percentile: round2((atOrBelow / n) * 100) });
  }
  return out;
}

/** Bands for the class performance chart, by percentage (a negative score falls in the first). */
export const BANDS = [
  { label: '0-20%', min: -Infinity, max: 20 },
  { label: '20-40%', min: 20, max: 40 },
  { label: '40-60%', min: 40, max: 60 },
  { label: '60-80%', min: 60, max: 80 },
  { label: '80-100%', min: 80, max: Infinity },
] as const;

/**
 * The average percentage of some scores on one test: worked out from the
 * exact marks and rounded once, so every screen (and the student reports)
 * shows the same figure. Null when there are no scores.
 */
export function averagePercent(marks: number[], totalMarks: number): number | null {
  return marks.length ? percentOf(marks.reduce((a, b) => a + b, 0) / marks.length, totalMarks) : null;
}

/** Class Performance (PRD 5.12): average, highest and lowest of those present, and the spread. Null averages mean no one was graded. */
export function classStats(results: { present: boolean; marks: number | null }[], totalMarks: number) {
  const marks = results.filter((r) => r.present && r.marks !== null).map((r) => r.marks as number);
  // Each student's pass and band follow the percentage they're shown (rounded).
  const percents = marks.map((m) => percentOf(m, totalMarks));
  return {
    graded: results.length,
    present: marks.length,
    absent: results.filter((r) => !r.present).length,
    averageMarks: marks.length ? round2(marks.reduce((a, b) => a + b, 0) / marks.length) : null,
    averagePercent: averagePercent(marks, totalMarks),
    highest: marks.length ? Math.max(...marks) : null,
    lowest: marks.length ? Math.min(...marks) : null,
    passed: percents.filter((p) => p >= PASS_PERCENT).length,
    distribution: BANDS.map((b) => ({ label: b.label, count: percents.filter((p) => p >= b.min && p < b.max).length })),
  };
}

export type TestPhase = 'SCHEDULED' | 'ONGOING' | 'COMPLETED' | 'CANCELLED';

/** Scheduled until it starts, Ongoing while it runs, then Completed; or Cancelled. */
export function phaseOf(t: { status: string; startsAt: Date; durationMinutes: number }, now = new Date()): TestPhase {
  if (t.status === 'CANCELLED') return 'CANCELLED';
  if (now < t.startsAt) return 'SCHEDULED';
  return now.getTime() < t.startsAt.getTime() + t.durationMinutes * 60_000 ? 'ONGOING' : 'COMPLETED';
}
