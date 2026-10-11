// Read-only checks run before `prisma migrate deploy` (see db-preflight.ts).
//
// Several migrations add unique indexes and fail if duplicates exist. Two of
// them (20261012010000, 20261012030000) and the recruitment hardening
// migration (20261012050000) are not wrapped in a transaction, so a failure
// part-way leaves the schema half-changed. They are already applied on dev
// and can't be edited without changing their checksums, so instead every
// condition that can make them fail is checked here first, and nothing is
// deployed while any check fails.

export type Query = (sql: string) => Promise<Record<string, unknown>[]>;

export type Check = {
  name: string;
  /** Tables the query needs; the check is skipped when one doesn't exist yet. */
  tables: string[];
  sql: string;
  fix: string;
};

const dupes = (
  name: string,
  table: string,
  columns: string[],
  fix: string,
): Check => ({
  name,
  tables: [table],
  sql: `SELECT ${columns.join(', ')}, count(*)::int AS copies FROM "${table}" GROUP BY ${columns
    .map((_, i) => i + 1)
    .join(', ')} HAVING count(*) > 1 LIMIT 20`,
  fix,
});

export const CHECKS: Check[] = [
  dupes(
    'Accounts whose emails differ only by letter case (20261011210000)',
    'User',
    ['lower("email")'],
    'Merge or rename those accounts.',
  ),
  dupes(
    'Duplicate syllabus chapter titles in a batch + subject (20261012010000)',
    'SyllabusItem',
    ['"batchId"', '"subject"', 'lower("title")'],
    'Rename or delete the extra chapters.',
  ),
  dupes(
    'Duplicate program names in a school (20261012010000)',
    'Program',
    ['"schoolId"', 'lower("name")'],
    'Rename or delete the extra programs.',
  ),
  dupes(
    'Duplicate batch names in a program (20261012010000)',
    'Batch',
    ['"programId"', 'lower("name")'],
    'Rename or delete the extra batches.',
  ),
  dupes(
    'Duplicate concept names in a chapter (20261012030000)',
    'CurriculumConcept',
    ['"chapterId"', 'lower("name")'],
    'Rename or delete the extra concepts.',
  ),
  dupes(
    'Duplicate curriculum chapters (20261012030000)',
    'CurriculumChapter',
    [
      '"schoolId"',
      '"subject"',
      'lower("name")',
      `coalesce("board", '')`,
      `coalesce("classLevel", '')`,
      `coalesce("programId", '')`,
    ],
    'Rename or delete the extra chapters.',
  ),
  dupes(
    'Duplicate appraisals for a teacher, period and year (20261012050000)',
    'TeacherAppraisal',
    ['"facultyId"', '"period"', '"academicYear"'],
    'Delete or change the extra appraisals.',
  ),
  {
    name: 'Migrations that failed part-way',
    tables: ['_prisma_migrations'],
    sql: `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`,
    fix: 'Recover it first: see docs/deploy.md for that migration. Do not just mark it rolled back and redeploy.',
  },
  {
    name: 'Recruitment hardening half-applied without being recorded (20261012050000)',
    tables: ['Candidate', '_prisma_migrations'],
    sql: `SELECT 'Candidate.facultyId exists but 20261012050000_recruitment_hardening is not applied' AS problem
          WHERE EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Candidate' AND column_name = 'facultyId')
            AND NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261012050000_recruitment_hardening' AND finished_at IS NOT NULL)`,
    fix: 'See "If the recruitment hardening migration failed" in docs/deploy.md.',
  },
  {
    name: 'Database session time zone is not UTC (the API refuses to start)',
    tables: [],
    sql: `SELECT current_setting('TimeZone') AS timezone WHERE extract(timezone FROM now()) <> 0`,
    fix: `ALTER DATABASE <db> SET timezone TO 'UTC';`,
  },
];

export type Problem = { check: Check; rows: Record<string, unknown>[] };

export async function runChecks(
  query: Query,
  checks: Check[] = CHECKS,
): Promise<Problem[]> {
  const problems: Problem[] = [];
  for (const check of checks) {
    if (check.tables.length > 0) {
      const [row] = await query(
        `SELECT ${check.tables
          .map((t, i) => `to_regclass('"${t}"') IS NOT NULL AS t${i}`)
          .join(', ')}`,
      );
      if (!row || Object.values(row).some((exists) => !exists)) continue;
    }
    const rows = await query(check.sql);
    if (rows.length > 0) problems.push({ check, rows });
  }
  return problems;
}
