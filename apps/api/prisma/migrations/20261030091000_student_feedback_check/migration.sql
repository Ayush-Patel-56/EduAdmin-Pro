-- Student -> Teacher feedback in the direction rule: it names one teacher and
-- the student and batch it came from (the names stay if either is deleted),
-- never a sending teacher or every teacher. The other directions never carry a
-- student or batch. A migration of its own because Postgres won't use an enum
-- value in the transaction that added it. Feedback is small; the re-check of
-- its rows is quick.
BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE "Feedback"
  DROP CONSTRAINT "Feedback_direction_check",
  ADD CONSTRAINT "Feedback_direction_check" CHECK (
    (
      "direction" <> 'STUDENT_TO_TEACHER'
      AND "studentId" IS NULL AND "studentName" IS NULL AND "batchId" IS NULL AND "batchName" IS NULL
      AND (
        ("direction" = 'TEACHER_TO_MANAGEMENT' AND NOT "toAllFaculty" AND "targetFacultyId" IS NULL AND "targetName" IS NULL)
        OR ("direction" = 'MANAGEMENT_TO_TEACHER' AND "toAllFaculty" AND "targetFacultyId" IS NULL AND "targetName" IS NULL)
        OR ("direction" = 'MANAGEMENT_TO_TEACHER' AND NOT "toAllFaculty" AND "targetName" IS NOT NULL)
      )
    )
    OR (
      "direction" = 'STUDENT_TO_TEACHER' AND NOT "toAllFaculty" AND "senderFacultyId" IS NULL
      AND "targetName" IS NOT NULL AND "studentName" IS NOT NULL AND "batchName" IS NOT NULL
    )
  );

COMMIT;
