-- Negative marking: a subject's marks can be below 0, down to minus the
-- paper's total. Only widens the check, so every row already passes it; in a
-- transaction, so there is nothing to check before deploying.
BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE "StudentMark" DROP CONSTRAINT "StudentMark_marks_check";
ALTER TABLE "StudentMark" ADD CONSTRAINT "StudentMark_marks_check" CHECK ("maxMarks" > 0 AND "marks" >= -"maxMarks" AND "marks" <= "maxMarks");

COMMIT;
