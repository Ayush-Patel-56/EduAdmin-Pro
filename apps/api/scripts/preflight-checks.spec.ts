import { describe, expect, it, vi } from 'vitest';
import { CHECKS, runChecks, type Query } from './preflight-checks.js';

/** A fake database: every table exists; `bad` lists checks that return rows. */
const db = (bad: string[] = [], missing: string[] = []): Query =>
  vi.fn(async (sql: string) => {
    if (sql.startsWith('SELECT to_regclass')) {
      const exists = Object.fromEntries(
        [
          ...sql.matchAll(/to_regclass\('"(\w+)"'\) IS NOT NULL AS (t\d+)/g),
        ].map(([, table, alias]) => [alias, !missing.includes(table)]),
      );
      return [exists];
    }
    const check = CHECKS.find((c) => c.sql === sql)!;
    return bad.includes(check.name) ? [{ example: 1 }] : [];
  });

const named = (fragment: string) =>
  CHECKS.find((c) => c.name.includes(fragment))!.name;

describe('deploy preflight', () => {
  it('passes a clean database', async () => {
    expect(await runChecks(db())).toEqual([]);
  });

  it('fails on duplicate appraisals (the 20261012050000 index would fail part-way)', async () => {
    const problems = await runChecks(db([named('appraisals')]));
    expect(problems.map((p) => p.check.name)).toEqual([named('appraisals')]);
  });

  it('fails on a migration that failed part-way, or a half-applied hardening migration', async () => {
    const problems = await runChecks(
      db([named('failed part-way'), named('half-applied')]),
    );
    expect(problems).toHaveLength(2);
  });

  it('fails on a non-UTC session time zone', async () => {
    expect(await runChecks(db([named('time zone')]))).toHaveLength(1);
  });

  it('skips checks whose tables do not exist yet (fresh database)', async () => {
    const query = db([named('appraisals')], ['TeacherAppraisal']);
    expect(await runChecks(query)).toEqual([]);
  });

  it('only reads', () => {
    for (const check of CHECKS) expect(check.sql.trim()).toMatch(/^SELECT /);
  });

  it('checks every unique index the non-atomic migrations add', () => {
    const sql = CHECKS.map((c) => c.sql).join('\n');
    for (const fragment of [
      'lower("email")',
      '"batchId", "subject", lower("title")',
      '"schoolId", lower("name")',
      '"programId", lower("name")',
      '"chapterId", lower("name")',
      `coalesce("programId", '')`,
      '"facultyId", "period", "academicYear"',
    ])
      expect(sql).toContain(fragment);
  });
});
