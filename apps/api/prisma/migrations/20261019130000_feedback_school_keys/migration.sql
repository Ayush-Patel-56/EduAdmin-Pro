-- Feedback and daily reports: the faculty links are tied to the row's school
-- (HLD 7: composite references preventing cross-school links), so no entry
-- can point at another school's teacher. Deleting a faculty profile still
-- nulls only that link (the row keeps the name): ON DELETE SET NULL with a
-- column list (PostgreSQL 15+), so schoolId is never touched.
BEGIN;
SET LOCAL lock_timeout = '10s';

-- DropForeignKey
ALTER TABLE "Feedback" DROP CONSTRAINT "Feedback_senderFacultyId_fkey";
ALTER TABLE "Feedback" DROP CONSTRAINT "Feedback_targetFacultyId_fkey";
ALTER TABLE "DailyReport" DROP CONSTRAINT "DailyReport_facultyId_fkey";

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_senderFacultyId_schoolId_fkey" FOREIGN KEY ("senderFacultyId", "schoolId") REFERENCES "Faculty"("id", "schoolId") ON DELETE SET NULL ("senderFacultyId") ON UPDATE CASCADE;
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_targetFacultyId_schoolId_fkey" FOREIGN KEY ("targetFacultyId", "schoolId") REFERENCES "Faculty"("id", "schoolId") ON DELETE SET NULL ("targetFacultyId") ON UPDATE CASCADE;
ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_facultyId_schoolId_fkey" FOREIGN KEY ("facultyId", "schoolId") REFERENCES "Faculty"("id", "schoolId") ON DELETE SET NULL ("facultyId") ON UPDATE CASCADE;

COMMIT;
