import { SUBJECTS } from '../academic/academic-options.js';

/**
 * The rules the student reports share (PRD 4.5, 4.8; HLD 9.7). Every figure
 * is null when there is nothing to work it out from, so a screen can say
 * "insufficient data" instead of showing 0%.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The school's grade scale, highest first: A+ 80+, A 70-79, B+ 60-69, B 50-59, C 40-49, F below 40. */
export const GRADE_SCALE = [
  { grade: 'A+', min: 80 },
  { grade: 'A', min: 70 },
  { grade: 'B+', min: 60 },
  { grade: 'B', min: 50 },
  { grade: 'C', min: 40 },
  { grade: 'F', min: -Infinity },
] as const;
export type Grade = (typeof GRADE_SCALE)[number]['grade'];

export function gradeOf(percent: number | null): Grade | null {
  if (percent === null) return null;
  return GRADE_SCALE.find((g) => percent >= g.min)!.grade;
}

/** Topic strength bands: strong 75%+, average 50-74%, weak below 50% (PRD 4.5). */
export const STRONG_PERCENT = 75;
export const AVERAGE_PERCENT = 50;
export type Band = 'STRONG' | 'AVERAGE' | 'WEAK';
export function bandOf(percent: number): Band {
  return percent >= STRONG_PERCENT ? 'STRONG' : percent >= AVERAGE_PERCENT ? 'AVERAGE' : 'WEAK';
}

/** Needs Attention: subjects averaging below this (PRD 4.5). */
export const NEEDS_ATTENTION_PERCENT = 65;

/** The five rating levels of Student Ratings (PRD 5.7), 1 to 5. */
export const RATING_LEVELS = ['Unsatisfactory', 'Satisfactory', 'Good', 'Very Good', 'Excellent'] as const;

/** The terms marks are reported for, in the order of a year (PRD 4.8). */
export const REPORT_TERMS = ['UNIT_TEST_1', 'TERM_1', 'MID_TERM', 'TERM_2', 'ANNUAL'] as const;
export type ReportTermKey = (typeof REPORT_TERMS)[number];
export const TERM_LABELS: Record<ReportTermKey, string> = {
  UNIT_TEST_1: 'Unit Test 1',
  TERM_1: 'Term 1',
  MID_TERM: 'Mid-Term',
  TERM_2: 'Term 2',
  ANNUAL: 'Annual',
};

/** Subjects of term marks: the academic subjects, then the other subjects of assignments (WORKSPACE_SUBJECTS). */
export const REPORT_SUBJECTS: readonly string[] = [...SUBJECTS, 'English', 'Computer Science'];

/** How many past academic years the reports (and imports) reach back to, besides the current one. */
export const PAST_YEARS = 4;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The academic year an Indian calendar date (UTC midnight of it) falls in: the year it starts. */
export function academicYearOf(day: Date, startMonth: number): number {
  const year = day.getUTCFullYear();
  return day.getUTCMonth() + 1 >= startMonth ? year : year - 1;
}

/**
 * An academic year as calendar dates (for @db.Date columns: from inclusive,
 * to exclusive) and as instants (00:00 IST on those days, for timestamps).
 */
export function academicYearBounds(year: number, startMonth: number) {
  const fromDate = new Date(Date.UTC(year, startMonth - 1, 1));
  const toDate = new Date(Date.UTC(year + 1, startMonth - 1, 1));
  return {
    fromDate,
    toDate,
    fromInstant: new Date(fromDate.getTime() - IST_OFFSET_MS),
    toInstant: new Date(toDate.getTime() - IST_OFFSET_MS),
  };
}

/** "2026-27". */
export const yearLabel = (year: number) => `${year}-${String((year + 1) % 100).padStart(2, '0')}`;

/** Exact percentage, rounded once; null without a denominator. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? round2((part / whole) * 100) : null;
}

/**
 * Attendance rate: present or late out of the classes that count (excused
 * ones don't). Null when no class counts.
 */
export function attendanceRate(c: { present: number; late: number; absent: number; excused: number }): number | null {
  return percent(c.present + c.late, c.present + c.late + c.absent);
}

/** The behaviour score (/5): the mean of the four dimensions' averages, to one decimal. */
export function behaviourScore(avg: { attitude: number | null; behaviour: number | null; focus: number | null; interaction: number | null }): number | null {
  const values = [avg.attitude, avg.behaviour, avg.focus, avg.interaction];
  if (values.some((v) => v === null)) return null;
  return Math.round(((values as number[]).reduce((a, b) => a + b, 0) / 4) * 10) / 10;
}

/** How a topic is matched across tests and assignments: its subject and name, ignoring letter case and spacing. */
export function topicKey(subject: string, topic: string): string {
  return `${subject.trim().toLowerCase()}|${topic.trim().replace(/\s+/g, ' ').toLowerCase()}`;
}

export type TestTopic = { subject: string; chapter: string | null; topic: string; questions: number; awarded: number; possible: number };
export type AssignmentTopic = { subject: string; chapter: string; topic: string | null; score: number; total: number };
export type TopicStrength = {
  subject: string;
  chapter: string | null;
  topic: string;
  percent: number;
  band: Band;
  test: { questions: number; percent: number } | null;
  assignments: { count: number; percent: number } | null;
};

/**
 * Topic strength from both sources (tests and graded assignments): each
 * source's score is its marks earned out of marks possible (negative marking
 * floors a topic at 0), and the blended score is the mean of the sources a
 * topic has. An assignment without a topic counts for its chapter.
 */
export function topicStrength(tests: TestTopic[], assignments: AssignmentTopic[]): TopicStrength[] {
  type Acc = { subject: string; chapter: string | null; topic: string; questions: number; awarded: number; possible: number; count: number; score: number; total: number };
  const acc = new Map<string, Acc>();
  const at = (subject: string, topic: string, chapter: string | null) => {
    const key = topicKey(subject, topic);
    let a = acc.get(key);
    if (!a) {
      a = { subject, chapter, topic: topic.trim().replace(/\s+/g, ' '), questions: 0, awarded: 0, possible: 0, count: 0, score: 0, total: 0 };
      acc.set(key, a);
    }
    a.chapter ??= chapter;
    return a;
  };
  for (const t of tests) {
    const a = at(t.subject, t.topic, t.chapter);
    a.questions += t.questions;
    a.awarded += t.awarded;
    a.possible += t.possible;
  }
  for (const s of assignments) {
    const a = at(s.subject, s.topic?.trim() || s.chapter, s.chapter);
    a.count++;
    a.score += s.score;
    a.total += s.total;
  }
  const out: TopicStrength[] = [];
  for (const a of acc.values()) {
    const test = a.possible > 0 ? { questions: a.questions, percent: percent(Math.max(0, a.awarded), a.possible)! } : null;
    const assignments = a.total > 0 ? { count: a.count, percent: percent(a.score, a.total)! } : null;
    const parts = [test?.percent, assignments?.percent].filter((p): p is number => p !== undefined);
    if (!parts.length) continue;
    const blended = round2(parts.reduce((x, y) => x + y, 0) / parts.length);
    out.push({ subject: a.subject, chapter: a.chapter, topic: a.topic, percent: blended, band: bandOf(blended), test, assignments });
  }
  return out.sort((x, y) => y.percent - x.percent || x.subject.localeCompare(y.subject) || x.topic.localeCompare(y.topic));
}

/**
 * Competition ranks (equal scores share a rank, the next skips) with the NTA
 * percentile, among the scores given; as for a test (scoring.ts), so every
 * rank on the reports reads the same way.
 */
export function rankScores(scores: { id: string; score: number }[]) {
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const n = sorted.length;
  const out = new Map<string, { rank: number; of: number; percentile: number }>();
  let rank = 0;
  sorted.forEach((s, i) => {
    if (i === 0 || s.score !== sorted[i - 1].score) rank = i + 1;
    out.set(s.id, { rank, of: n, percentile: round2(((n - rank + 1) / n) * 100) });
  });
  return out;
}
