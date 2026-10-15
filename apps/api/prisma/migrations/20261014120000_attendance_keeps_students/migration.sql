-- Review of #19: attendance is a record, so deleting a student no longer
-- deletes their attendance. The foreign key becomes NO ACTION (checked at the
-- end of the statement, so deleting a school still cascades through students
-- and attendance together); the API refuses to delete a student who has
-- attendance and suggests setting them Inactive or Transferred instead.
-- Nothing to check before deploying.
BEGIN;

ALTER TABLE "AttendanceRecord" DROP CONSTRAINT "AttendanceRecord_studentId_schoolId_fkey";
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_studentId_schoolId_fkey" FOREIGN KEY ("studentId", "schoolId") REFERENCES "Student"("id", "schoolId") ON DELETE NO ACTION ON UPDATE CASCADE;

COMMIT;
