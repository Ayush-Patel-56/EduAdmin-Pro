-- A batch event stores only its batch; its program is read through the batch,
-- so moving a batch to another program carries its events along, and deleting
-- the old program can't cascade to them. Nothing to check before deploying.
BEGIN;

UPDATE "CalendarEvent" SET "programId" = NULL WHERE "batchId" IS NOT NULL;

ALTER TABLE "CalendarEvent"
  ADD CONSTRAINT "CalendarEvent_one_scope_check" CHECK ("programId" IS NULL OR "batchId" IS NULL);

COMMIT;
