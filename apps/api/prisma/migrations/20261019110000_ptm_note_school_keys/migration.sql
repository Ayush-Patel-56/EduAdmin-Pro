-- PTM notes: the batch and faculty links are tied to the note's school, like
-- the student link, so no note can point at another school's batch or
-- faculty (HLD 7: composite references preventing cross-school links).
-- Deleting the batch or the faculty profile still nulls only that link (the
-- note keeps its batch and teacher names): ON DELETE SET NULL with a column
-- list (PostgreSQL 15+), so schoolId is never touched.
BEGIN;
SET LOCAL lock_timeout = '10s';

-- DropForeignKey
ALTER TABLE "PtmNote" DROP CONSTRAINT "PtmNote_batchId_fkey";
ALTER TABLE "PtmNote" DROP CONSTRAINT "PtmNote_facultyId_fkey";

-- AddForeignKey
ALTER TABLE "PtmNote" ADD CONSTRAINT "PtmNote_batchId_schoolId_fkey" FOREIGN KEY ("batchId", "schoolId") REFERENCES "Batch"("id", "schoolId") ON DELETE SET NULL ("batchId") ON UPDATE CASCADE;
ALTER TABLE "PtmNote" ADD CONSTRAINT "PtmNote_facultyId_schoolId_fkey" FOREIGN KEY ("facultyId", "schoolId") REFERENCES "Faculty"("id", "schoolId") ON DELETE SET NULL ("facultyId") ON UPDATE CASCADE;

COMMIT;
