import { averagePercent, classStats, gradeAnswer, mcqLetter, numberOf, type PaperQuestion, percentOf, phaseOf, rankAndPercentile, totalsOf } from './scoring.js';

const q = (over: Partial<PaperQuestion> = {}): PaperQuestion => ({ id: 'q1', type: 'MCQ', correctAnswer: 'B', marks: 4, negativeMarks: 1, ...over });

describe('grading one answer', () => {
  it('MCQ: right earns the marks, wrong loses the negative marks, blank is unattempted', () => {
    expect(gradeAnswer(q(), { response: 'B' })).toEqual({ testQuestionId: 'q1', response: 'B', outcome: 'CORRECT', marksAwarded: 4 });
    expect(gradeAnswer(q(), { response: '(c)' })).toEqual({ testQuestionId: 'q1', response: 'C', outcome: 'INCORRECT', marksAwarded: -1 });
    expect(gradeAnswer(q(), { response: '  ' })).toEqual({ testQuestionId: 'q1', response: null, outcome: 'UNATTEMPTED', marksAwarded: 0 });
    expect(Object.is(gradeAnswer(q({ negativeMarks: 0 }), { response: 'A' }).marksAwarded, 0)).toBe(true);
    expect(() => gradeAnswer(q(), { response: 'E' })).toThrow('An MCQ answer is A, B, C or D');
  });

  it('Integer and Numerical: compared as numbers (numerical to two decimals)', () => {
    const integer = q({ type: 'INTEGER', correctAnswer: '42', negativeMarks: 0 });
    expect(gradeAnswer(integer, { response: '42' }).outcome).toBe('CORRECT');
    expect(gradeAnswer(integer, { response: '41' })).toMatchObject({ outcome: 'INCORRECT', marksAwarded: 0 });
    expect(() => gradeAnswer(integer, { response: '4.5' })).toThrow('whole number');
    const numerical = q({ type: 'NUMERICAL', correctAnswer: '9.81' });
    expect(gradeAnswer(numerical, { response: '9.810' }).outcome).toBe('CORRECT');
    expect(gradeAnswer(numerical, { response: '9.8' }).outcome).toBe('INCORRECT');
    // To two decimals, not exactly: 3.144 against a key of 3.14 is right, 3.146 (3.15) is not.
    const pi = q({ type: 'NUMERICAL', correctAnswer: '3.14' });
    expect(gradeAnswer(pi, { response: '3.144' }).outcome).toBe('CORRECT');
    expect(gradeAnswer(pi, { response: '3.146' }).outcome).toBe('INCORRECT');
    expect(() => gradeAnswer(numerical, { response: 'nine' })).toThrow('A numerical answer is a number');
  });

  it('Subjective: the teacher’s marks decide correct, partial, incorrect or unattempted', () => {
    const s = q({ type: 'SUBJECTIVE', correctAnswer: null, marks: 5 });
    expect(gradeAnswer(s, { marksAwarded: 5 }).outcome).toBe('CORRECT');
    expect(gradeAnswer(s, { marksAwarded: 2.5 })).toMatchObject({ outcome: 'PARTIAL', marksAwarded: 2.5 });
    expect(gradeAnswer(s, { marksAwarded: 0 }).outcome).toBe('INCORRECT');
    expect(gradeAnswer(s, {}).outcome).toBe('UNATTEMPTED');
    expect(() => gradeAnswer(s, { marksAwarded: 6 })).toThrow('must be 0 to 5');
    expect(() => gradeAnswer(s, { marksAwarded: -1 })).toThrow();
  });

  it('reads MCQ letters and numbers the way staff type them', () => {
    expect(['b', '(B)', 'Option B', 'B.'].map(mcqLetter)).toEqual(['B', 'B', 'B', 'B']);
    expect(mcqLetter('Kelvin')).toBeNull();
    expect(numberOf('-3.5')).toBe(-3.5);
    expect(numberOf('3 seconds')).toBeNull();
  });
});

describe('totals and the class', () => {
  it('totals: marks summed; partial counts as correct; the counts cover the whole paper', () => {
    const answers = [
      { testQuestionId: 'a', response: 'B', outcome: 'CORRECT' as const, marksAwarded: 4 },
      { testQuestionId: 'b', response: 'A', outcome: 'INCORRECT' as const, marksAwarded: -1 },
      { testQuestionId: 'c', response: null, outcome: 'UNATTEMPTED' as const, marksAwarded: 0 },
      { testQuestionId: 'd', response: null, outcome: 'PARTIAL' as const, marksAwarded: 2.5 },
    ];
    expect(totalsOf(answers)).toEqual({ marks: 5.5, correct: 2, incorrect: 1, unattempted: 1 });
  });

  it('ranks: competition ranking among those present; percentile: share at or below (NTA)', () => {
    const ranks = rankAndPercentile([
      { studentId: 'a', present: true, marks: 100 },
      { studentId: 'b', present: true, marks: 90 },
      { studentId: 'c', present: true, marks: 90 },
      { studentId: 'd', present: true, marks: 80 },
      { studentId: 'x', present: false, marks: null },
    ]);
    expect(Object.fromEntries(ranks)).toEqual({
      a: { rank: 1, percentile: 100 },
      b: { rank: 2, percentile: 75 },
      c: { rank: 2, percentile: 75 },
      d: { rank: 4, percentile: 25 },
    });
    expect(ranks.has('x')).toBe(false);
    expect(Object.fromEntries(rankAndPercentile([{ studentId: 'solo', present: true, marks: 10 }]))).toEqual({ solo: { rank: 1, percentile: 100 } });
  });

  it('class performance: of those present only; nothing graded is "no data", not zero', () => {
    const stats = classStats(
      [
        { present: true, marks: 240 },
        { present: true, marks: 90 },
        { present: true, marks: -6 },
        { present: false, marks: null },
      ],
      300,
    );
    expect(stats).toMatchObject({ graded: 4, present: 3, absent: 1, averageMarks: 108, highest: 240, lowest: -6, passed: 1 });
    expect(stats.averagePercent).toBe(36);
    expect(stats.distribution.map((d) => d.count)).toEqual([1, 1, 0, 0, 1]);
    expect(classStats([], 300)).toMatchObject({ averageMarks: null, averagePercent: null, highest: null, lowest: null });
    expect(percentOf(150, 300)).toBe(50);
    // The average is of the exact marks, rounded once (11 and -1 of 13: 38.46%, not the mean of 84.62 and -7.69).
    expect(classStats([{ present: true, marks: 11 }, { present: true, marks: -1 }], 13).averagePercent).toBe(38.46);
    expect(averagePercent([], 13)).toBeNull();
  });

  it('a test is Scheduled, Ongoing, then Completed by the clock, unless cancelled', () => {
    const t = { status: 'SCHEDULED', startsAt: new Date('2026-10-18T04:30:00Z'), durationMinutes: 180 };
    expect(phaseOf(t, new Date('2026-10-18T04:00:00Z'))).toBe('SCHEDULED');
    expect(phaseOf(t, new Date('2026-10-18T04:30:00Z'))).toBe('ONGOING');
    expect(phaseOf(t, new Date('2026-10-18T07:29:59Z'))).toBe('ONGOING');
    expect(phaseOf(t, new Date('2026-10-18T07:30:00Z'))).toBe('COMPLETED');
    expect(phaseOf({ ...t, status: 'CANCELLED' }, new Date('2026-10-18T05:00:00Z'))).toBe('CANCELLED');
  });
});
