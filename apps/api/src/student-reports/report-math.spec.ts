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
    // Punctuation and a possessive 's don't make another topic (#50).
    expect(topicKey('Physics', "Gauss's Law")).toBe(topicKey('Physics', 'Gauss Law'));
    expect(topicKey('Physics', 'Gauss’s law.')).toBe(topicKey('Physics', 'gauss law'));
    expect(topicKey('Physics', 'Work-Energy Theorem')).toBe(topicKey('Physics', 'work energy theorem'));
    expect(topicKey('Physics', 'Heat')).not.toBe(topicKey('Physics', 'Heats'));
    // Hindi vowel signs tell topics apart; Latin accents don't (#52).
    expect(topicKey('Physics', 'किल')).not.toBe(topicKey('Physics', 'कील'));
    expect(topicKey('Physics', 'गति')).not.toBe(topicKey('Physics', 'गत'));
    expect(topicKey('Physics', 'Énergie')).toBe(topicKey('Physics', 'energie'));
    // + and # count (#53): C++, C# and C are three topics, and Na+ isn't Na.
    const c = ['C++', 'C#', 'C'].map((t) => topicKey('Computer Science', t));
    expect(new Set(c).size).toBe(3);
    expect(topicKey('Chemistry', 'Na+ ions')).not.toBe(topicKey('Chemistry', 'Na ions'));
    expect(topicKey('Computer Science', 'c++')).toBe(topicKey('Computer Science', ' C ++ '));
    // # after a letter is "sharp" (C#, F#); elsewhere it means "number" and doesn't count (#55).
    expect(topicKey('Computer Science', 'F#')).not.toBe(topicKey('Computer Science', 'F'));
    expect(topicKey('Physics', 'Topic #3')).toBe(topicKey('Physics', 'Topic 3'));
    expect(topicKey('Physics', '#1 Kinematics')).toBe(topicKey('Physics', '1 Kinematics'));
  });

  it('names a topic spelled several ways as on its latest paper, whatever the order (#52)', () => {
    const older = { subject: 'Physics', chapter: 'Electrostatics', topic: 'Gauss Law', latest: new Date('2026-08-01'), questions: 1, awarded: 4, possible: 4 };
    const newer = { subject: 'Physics', chapter: null, topic: "Gauss's Law.", latest: new Date('2026-10-01'), questions: 1, awarded: 0, possible: 4 };
    for (const order of [[older, newer], [newer, older]]) {
      expect(topicStrength(order, [])).toMatchObject([{ topic: "Gauss's Law.", chapter: 'Electrostatics', percent: 50, test: { questions: 2 } }]);
    }
  });

  it("a newer assignment's spelling names the topic too; an older one doesn't (#53)", () => {
    const test = { subject: 'Physics', chapter: 'Electrostatics', topic: 'Gauss Law', latest: new Date('2026-08-01'), questions: 1, awarded: 4, possible: 4 };
    const hw = (latest: string) => ({ subject: 'Physics', chapter: 'Electrostatics', topic: "Gauss's law (applications)", latest: new Date(latest), score: 5, total: 10 });
    expect(topicStrength([test], [hw('2026-09-01')]).map((t) => t.topic)).toEqual(['Gauss Law', "Gauss's law (applications)"]);
    const same = { ...hw('2026-09-01'), topic: "Gauss's Law." };
    expect(topicStrength([test], [same])).toMatchObject([{ topic: "Gauss's Law.", test: { questions: 1 }, assignments: { count: 1 } }]);
    expect(topicStrength([test], [{ ...same, latest: new Date('2026-07-01') }])).toMatchObject([{ topic: 'Gauss Law' }]);
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
