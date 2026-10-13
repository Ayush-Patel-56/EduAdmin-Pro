-- Students hardening (review of #15), in one transaction:
--   1. A student photo belongs to one student (unique photoFileId).
--   2. Batch history survives deleting a batch: each enrollment keeps the
--      batch and program names, and batchId is cleared instead of the row
--      being deleted.
--   3. Roll numbers are stored upper-cased, so the per-batch unique index
--      treats "r5" and "R5" as the same roll number.
--
-- Before deploying, make sure none of these return rows (each would make a
-- step fail, and the whole migration roll back):
--   SELECT "photoFileId", count(*) FROM "Student" WHERE "photoFileId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
--   SELECT "batchId", upper("rollNumber"), count(*) FROM "Student" WHERE "batchId" IS NOT NULL AND "rollNumber" IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;
BEGIN;

-- 1.
CREATE UNIQUE INDEX "Student_photoFileId_key" ON "Student"("photoFileId");

-- 2.
ALTER TABLE "StudentEnrollment" DROP CONSTRAINT "StudentEnrollment_batchId_schoolId_fkey";
ALTER TABLE "StudentEnrollment" ADD COLUMN "batchName" TEXT, ADD COLUMN "programName" TEXT;
UPDATE "StudentEnrollment" e
SET "batchName" = b."name", "programName" = p."name"
FROM "Batch" b JOIN "Program" p ON p."id" = b."programId"
WHERE b."id" = e."batchId";
ALTER TABLE "StudentEnrollment"
  ALTER COLUMN "batchName" SET NOT NULL,
  ALTER COLUMN "programName" SET NOT NULL,
  ALTER COLUMN "batchId" DROP NOT NULL;
ALTER TABLE "StudentEnrollment" ADD CONSTRAINT "StudentEnrollment_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3.
UPDATE "Student" SET "rollNumber" = upper("rollNumber") WHERE "rollNumber" <> upper("rollNumber");
UPDATE "StudentEnrollment" SET "rollNumber" = upper("rollNumber") WHERE "rollNumber" <> upper("rollNumber");

COMMIT;
