-- Feedback review of #30. Wrapped in a transaction; nothing to check before
-- deploying (only imported rows get a value, and any from before this get a
-- key of their own).
BEGIN;

-- Fail cleanly instead of queueing every request behind a long-running query.
SET LOCAL lock_timeout = '10s';

-- importKey: a hash of an imported row's cells as written, so re-uploading a
-- sheet (by any admin, on any day, or twice at once) can't store a row twice.
-- statusChangedById: who last moved an entry, traceable if names repeat.
ALTER TABLE "Feedback" ADD COLUMN "importKey" TEXT,
ADD COLUMN "statusChangedById" TEXT;

UPDATE "Feedback" SET "importKey" = 'legacy:' || "id" WHERE "source" = 'IMPORT' AND "importKey" IS NULL;

CREATE UNIQUE INDEX "Feedback_schoolId_importKey_key" ON "Feedback" ("schoolId", "importKey") WHERE "importKey" IS NOT NULL;

ALTER TABLE "Feedback"
  ADD CONSTRAINT "Feedback_import_key_check" CHECK (("source" = 'IMPORT') = ("importKey" IS NOT NULL));

COMMIT;
