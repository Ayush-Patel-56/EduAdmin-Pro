-- Tests & Question Bank: every link is tied to the row's school (HLD 7:
-- composite references preventing cross-school links), and an answer to its
-- result's test.
--  * A paper copy's bank question, and a question's or test's faculty member,
--    are composite keys with ON DELETE SET NULL on the one column
--    (PostgreSQL 15+), so deleting the question or profile still nulls only
--    that link and never schoolId.
--  * TestAnswer carries testId (filled from its result), and both its links
--    include it, so a result and a paper question of different tests can't be
--    paired.
BEGIN;
SET LOCAL lock_timeout = '10s';

-- DropForeignKey
ALTER TABLE "Question" DROP CONSTRAINT "Question_facultyId_fkey";
ALTER TABLE "Test" DROP CONSTRAINT "Test_facultyId_fkey";
ALTER TABLE "TestQuestion" DROP CONSTRAINT "TestQuestion_questionId_fkey";
ALTER TABLE "TestAnswer" DROP CONSTRAINT "TestAnswer_resultId_schoolId_fkey";
ALTER TABLE "TestAnswer" DROP CONSTRAINT "TestAnswer_testQuestionId_schoolId_fkey";

-- AlterTable: an answer's test, from its result
ALTER TABLE "TestAnswer" ADD COLUMN "testId" TEXT;
UPDATE "TestAnswer" a SET "testId" = r."testId" FROM "TestResult" r WHERE r."id" = a."resultId";
ALTER TABLE "TestAnswer" ALTER COLUMN "testId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "TestQuestion_id_testId_schoolId_key" ON "TestQuestion"("id", "testId", "schoolId");
CREATE UNIQUE INDEX "TestResult_id_testId_schoolId_key" ON "TestResult"("id", "testId", "schoolId");

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_facultyId_schoolId_fkey" FOREIGN KEY ("facultyId", "schoolId") REFERENCES "Faculty"("id", "schoolId") ON DELETE SET NULL ("facultyId") ON UPDATE CASCADE;
ALTER TABLE "Test" ADD CONSTRAINT "Test_facultyId_schoolId_fkey" FOREIGN KEY ("facultyId", "schoolId") REFERENCES "Faculty"("id", "schoolId") ON DELETE SET NULL ("facultyId") ON UPDATE CASCADE;
ALTER TABLE "TestQuestion" ADD CONSTRAINT "TestQuestion_questionId_schoolId_fkey" FOREIGN KEY ("questionId", "schoolId") REFERENCES "Question"("id", "schoolId") ON DELETE SET NULL ("questionId") ON UPDATE CASCADE;
ALTER TABLE "TestAnswer" ADD CONSTRAINT "TestAnswer_resultId_testId_schoolId_fkey" FOREIGN KEY ("resultId", "testId", "schoolId") REFERENCES "TestResult"("id", "testId", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestAnswer" ADD CONSTRAINT "TestAnswer_testQuestionId_testId_schoolId_fkey" FOREIGN KEY ("testQuestionId", "testId", "schoolId") REFERENCES "TestQuestion"("id", "testId", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
