-- Recruitment hardening after review.
--
-- 1. Timestamps on the recruitment tables become timestamptz, so an interview
--    time is an instant and not a wall-clock value in whatever zone the server
--    happened to run in. Existing values were written in UTC.
-- 2. Candidate.facultyId remembers the profile created when a candidate was
--    hired, so hiring never onboards the same person twice.
-- 3. One appraisal per teacher, period and academic year.
--
-- Before deploying, make sure no appraisal duplicates exist (the index
-- creation fails if they do):
--   SELECT "facultyId", "period", "academicYear", count(*) FROM "TeacherAppraisal" GROUP BY 1, 2, 3 HAVING count(*) > 1;
--
-- RecruitmentAuditLog is append-only; its trigger fires on UPDATE, DELETE and
-- TRUNCATE rows, none of which a column type change performs.

ALTER TABLE "JobRequirement"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

ALTER TABLE "Candidate"
  ALTER COLUMN "stageChangedAt" TYPE TIMESTAMPTZ(3) USING "stageChangedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "hiredAt" TYPE TIMESTAMPTZ(3) USING "hiredAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

ALTER TABLE "Interview"
  ALTER COLUMN "scheduledAt" TYPE TIMESTAMPTZ(3) USING "scheduledAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

ALTER TABLE "TeacherAppraisal"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

ALTER TABLE "RecruitmentAuditLog"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN "facultyId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_facultyId_key" ON "Candidate"("facultyId");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherAppraisal_facultyId_period_academicYear_key" ON "TeacherAppraisal"("facultyId", "period", "academicYear");

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
