-- Daily reports: admins flag a report for follow-up (PRD 4.8, HLD 9.5), and
-- "Edited" follows the teacher's own changes (editedAt) rather than any
-- update, so flagging a report doesn't mark it edited. Existing reports get
-- editedAt from the rule used so far (saved again over a minute after they
-- were first submitted).
BEGIN;
SET LOCAL lock_timeout = '10s';

-- AlterTable
ALTER TABLE "DailyReport" ADD COLUMN "editedAt" TIMESTAMPTZ(3),
ADD COLUMN "flagReason" TEXT,
ADD COLUMN "flaggedAt" TIMESTAMPTZ(3),
ADD COLUMN "flaggedBy" TEXT,
ADD COLUMN "flaggedById" TEXT;

UPDATE "DailyReport" SET "editedAt" = "updatedAt" WHERE "updatedAt" > "submittedAt" + interval '1 minute';

-- A flag records who and when together; a reason only on a flagged report.
ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_flag_check" CHECK (
  ("flaggedAt" IS NULL) = ("flaggedBy" IS NULL)
  AND ("flaggedAt" IS NOT NULL OR ("flaggedById" IS NULL AND "flagReason" IS NULL))
  AND ("flaggedBy" IS NULL OR btrim("flaggedBy") <> '')
);

COMMIT;
