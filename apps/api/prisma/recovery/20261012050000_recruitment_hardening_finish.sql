-- Finishes a PARTLY applied 20261012050000_recruitment_hardening migration.
--
-- That migration isn't wrapped in a transaction, so if it fails part-way
-- (e.g. on the appraisal unique index because duplicates exist) some steps
-- are applied and some aren't, and re-running it is unsafe: it fails on the
-- column that already exists, and converting an already converted timestamp
-- column again would shift its values when the session isn't UTC.
--
-- This script does each remaining step only if it hasn't happened yet, in
-- one transaction. Use it ONLY in that situation (see docs/deploy.md):
--   1. remove the duplicate appraisals,
--   2. psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f apps/api/prisma/recovery/20261012050000_recruitment_hardening_finish.sql
--   3. pnpm --filter api exec prisma migrate resolve --applied 20261012050000_recruitment_hardening
--   4. pnpm --filter api db:deploy
BEGIN;

DO $$
DECLARE
  col record;
BEGIN
  FOR col IN
    SELECT * FROM (VALUES
      ('JobRequirement', 'createdAt'), ('JobRequirement', 'updatedAt'),
      ('Candidate', 'stageChangedAt'), ('Candidate', 'hiredAt'),
      ('Candidate', 'createdAt'), ('Candidate', 'updatedAt'),
      ('Interview', 'scheduledAt'), ('Interview', 'createdAt'), ('Interview', 'updatedAt'),
      ('TeacherAppraisal', 'createdAt'), ('TeacherAppraisal', 'updatedAt'),
      ('RecruitmentAuditLog', 'createdAt')
    ) AS t(tbl, name)
  LOOP
    -- Only columns that are still timestamp WITHOUT time zone are converted.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = col.tbl
        AND column_name = col.name AND data_type = 'timestamp without time zone'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN %I TYPE TIMESTAMPTZ(3) USING %I AT TIME ZONE ''UTC''',
        col.tbl, col.name, col.name);
      RAISE NOTICE 'converted %.%', col.tbl, col.name;
    END IF;
  END LOOP;
END $$;

ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "facultyId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Candidate_facultyId_key" ON "Candidate"("facultyId");

-- Fails (and rolls everything back) if duplicate appraisals still exist.
CREATE UNIQUE INDEX IF NOT EXISTS "TeacherAppraisal_facultyId_period_academicYear_key"
  ON "TeacherAppraisal"("facultyId", "period", "academicYear");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Candidate_facultyId_fkey') THEN
    ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_facultyId_fkey"
      FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
