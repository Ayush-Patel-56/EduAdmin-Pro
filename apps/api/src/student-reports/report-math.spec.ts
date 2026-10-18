import 'reflect-metadata';
import { WORKSPACE_SUBJECTS } from '../workspace/workspace.dto.js';
import {
  REPORT_SUBJECTS,
  academicYearBounds,
  academicYearOf,
  attendanceRate,
  bandOf,
  behaviourScore,
  gradeOf,
  percent,
  rankScores,
  topicKey,
  topicStrength,
  yearLabel,
} from './report-math.js';

describe('student report rules', () => {
  it('grades on the school scale: A+ 80, A 70, B+ 60, B 50, C 40, F below', () => {
    expect([100, 80, 79.99, 70, 69.99, 60, 59.99, 50, 49.99, 40, 39.99, 0, -5].map(gradeOf)).toEqual(['A+', 'A+', 'A', 'A', 'B+', 'B+', 'B', 'B', 'C', 'C', 'F', 'F', 'F']);
    expect(gradeOf(null)).toBeNull();
  });

  it('bands topics strong at 75, average from 50 to 74, weak below 50', () => {
    expect([100, 75, 74.99, 50, 49.99, 0].map(bandOf)).toEqual(['STRONG', 'STRONG', 'AVERAGE', 'AVERAGE', 'WEAK', 'WEAK']);
  });

  it('places a day in its academic year by the school start month, with bounds in dates and IST instants', () => {
    expect(academicYearOf(new Date('2026-03-31T00:00:00Z'), 4)).toBe(2025);
    expect(academicYearOf(new Date('2026-04-01T00:00:00Z'), 4)).toBe(2026);
    expect(academicYearOf(new Date('2026-12-31T00:00:00Z'), 1)).toBe(2026);
    const b = academicYearBounds(2026, 4);
    expect(b.fromDate.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(b.toDate.toISOString()).toBe('2027-04-01T00:00:00.000Z');
    // 00:00 IST on 1 April is 18:30 UTC the day before.
    expect(b.fromInstant.toISOString()).toBe('2026-03-31T18:30:00.000Z');
    expect(b.toInstant.toISOString()).toBe('2027-03-31T18:30:00.000Z');
    expect(yearLabel(2026)).toBe('2026-27');
    expect(yearLabel(2099)).toBe('2099-00');
  });

  it('distinguishes no data from zero', () => {
    expect(percent(0, 0)).toBeNull();
    expect(percent(0, 10)).toBe(0);
    expect(percent(2, 3)).toBe(66.67);
    // Excused classes don't count; late counts as attended.
    expect(attendanceRate({ present: 6, late: 2, absent: 2, excused: 5 })).toBe(80);
    expect(attendanceRate({ present: 0, late: 0, absent: 0, excused: 3 })).toBeNull();
    expect(behaviourScore({ attitude: 4.5, behaviour: 4, focus: 3.5, interaction: 4.25 })).toBe(4.1);
    expect(behaviourScore({ attitude: null, behaviour: null, focus: null, interaction: null })).toBeNull();
  });

  it('matches topics by subject and name in any letter case or spacing', () => {
    expect(topicKey('Physics', '  Laws of   Motion ')).toBe(topicKey('physics', 'laws of motion'));
    expect(topicKey('Physics', 'Heat')).not.toBe(topicKey('Chemistry', 'Heat'));
  });

  it('blends a topic: the mean of its test and assignment scores, with the counts of each', () => {
    const topics = topicStrength(
      [
        { subject: 'Physics', chapter: 'Thermal', topic: 'Heat Transfer', questions: 4, awarded: 12, possible: 16 },
        { subject: 'Physics', chapter: null, topic: 'heat  transfer', questions: 1, awarded: 4, possible: 4 },
        { subject: 'Physics', chapter: 'Optics', topic: 'Lenses', questions: 3, awarded: -2, possible: 12 },
      ],
      [
        { subject: 'Physics', chapter: 'Thermal', topic: 'Heat transfer', score: 6, total: 10 },
        { subject: 'Chemistry', chapter: 'Moles', topic: null, score: 45, total: 50 },
      ],
    );
    expect(topics).toEqual([
      // Assignment only, counted for its chapter.
      { subject: 'Chemistry', chapter: 'Moles', topic: 'Moles', percent: 90, band: 'STRONG', test: null, assignments: { count: 1, percent: 90 } },
      // Tests 16/20 = 80, assignment 60 -> 70.
      { subject: 'Physics', chapter: 'Thermal', topic: 'Heat Transfer', percent: 70, band: 'AVERAGE', test: { questions: 5, percent: 80 }, assignments: { count: 1, percent: 60 } },
      // Negative marking floors the topic at 0.
      { subject: 'Physics', chapter: 'Optics', topic: 'Lenses', percent: 0, band: 'WEAK', test: { questions: 3, percent: 0 }, assignments: null },
    ]);
  });

  it('ranks like a test: equal scores share a rank, the next skips, NTA percentile', () => {
    const r = rankScores([
      { id: 'a', score: 90 },
      { id: 'b', score: 95 },
      { id: 'c', score: 90 },
      { id: 'd', score: 60 },
    ]);
    expect(Object.fromEntries(r)).toEqual({
      b: { rank: 1, of: 4, percentile: 100 },
      a: { rank: 2, of: 4, percentile: 75 },
      c: { rank: 2, of: 4, percentile: 75 },
      d: { rank: 4, of: 4, percentile: 25 },
    });
  });

  it('reports marks for the academic subjects and English and Computer Science, each once', () => {
    expect(REPORT_SUBJECTS).toEqual(['Physics', 'Chemistry', 'Mathematics', 'Biology', 'Botany', 'Zoology', 'English', 'Computer Science']);
    // Every assignment subject can have term marks too.
    for (const s of WORKSPACE_SUBJECTS) expect(REPORT_SUBJECTS).toContain(s);
  });
});
