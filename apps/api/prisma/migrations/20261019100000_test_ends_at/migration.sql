-- Tests: when each one ends (startsAt + durationMinutes), stored so lists can
-- filter Scheduled / Ongoing / Completed and page in the database. Existing
-- rows get it from their start and length; a CHECK keeps it that way.
BEGIN;
SET LOCAL lock_timeout = '10s';

-- AlterTable
ALTER TABLE "Test" ADD COLUMN "endsAt" TIMESTAMPTZ(3);
UPDATE "Test" SET "endsAt" = "startsAt" + "durationMinutes" * interval '1 minute';
ALTER TABLE "Test" ALTER COLUMN "endsAt" SET NOT NULL;
ALTER TABLE "Test" ADD CONSTRAINT "Test_endsAt_check" CHECK ("endsAt" = "startsAt" + "durationMinutes" * interval '1 minute');

-- CreateIndex
CREATE INDEX "Test_schoolId_endsAt_idx" ON "Test"("schoolId", "endsAt");

COMMIT;
