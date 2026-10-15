-- #17: an enrollment can't end before it began. Promotion used to end the open
-- enrollments of students leaving a class batch on the year boundary, even
-- when they had joined the batch after it (e.g. 2026-10-13 -> 2026-04-01).
-- Those rows are repaired the way the fixed promotion ends them,
-- GREATEST("enrolledOn", boundary), which for them is their start date; then a
-- CHECK keeps it from coming back. Preflight (the rows this will repair):
--   SELECT "id", "studentId", "batchName", "enrolledOn", "endedOn" FROM "StudentEnrollment" WHERE "endedOn" < "enrolledOn";
BEGIN;

UPDATE "StudentEnrollment" SET "endedOn" = "enrolledOn" WHERE "endedOn" < "enrolledOn";

ALTER TABLE "StudentEnrollment"
  ADD CONSTRAINT "StudentEnrollment_end_check" CHECK ("endedOn" IS NULL OR "endedOn" >= "enrolledOn");

COMMIT;
