-- Tests & Question Bank (PRD 4.10, 5.11, 5.12): questions, tests, their papers
-- (question copies), results and per-question answers. New enums and tables
-- only, wrapped in a transaction, so there is nothing to check before deploying.
BEGIN;

-- Fail cleanly instead of queueing every request behind a long-running query.
SET LOCAL lock_timeout = '10s';

-- CreateEnum
CREATE TYPE "QuestionDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MCQ', 'NUMERICAL', 'INTEGER', 'SUBJECTIVE');

-- CreateEnum
CREATE TYPE "TestType" AS ENUM ('UNIT_TEST', 'MOCK', 'DPP');

-- CreateEnum
CREATE TYPE "TestStatus" AS ENUM ('SCHEDULED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AnswerOutcome" AS ENUM ('CORRECT', 'PARTIAL', 'INCORRECT', 'UNATTEMPTED');

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "chapterId" TEXT,
    "chapterName" TEXT,
    "topic" TEXT NOT NULL,
    "difficulty" "QuestionDifficulty" NOT NULL,
    "type" "QuestionType" NOT NULL,
    "text" TEXT NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "correctAnswer" TEXT,
    "marks" INTEGER NOT NULL,
    "negativeMarks" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'Custom',
    "facultyId" TEXT,
    "authorName" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Test" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "TestType" NOT NULL,
    "subject" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "totalMarks" INTEGER NOT NULL,
    "status" "TestStatus" NOT NULL DEFAULT 'SCHEDULED',
    "cancelledAt" TIMESTAMPTZ(3),
    "facultyId" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Test_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestQuestion" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "questionId" TEXT,
    "position" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "chapterName" TEXT,
    "topic" TEXT NOT NULL,
    "difficulty" "QuestionDifficulty" NOT NULL,
    "type" "QuestionType" NOT NULL,
    "text" TEXT NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "correctAnswer" TEXT,
    "marks" INTEGER NOT NULL,
    "negativeMarks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TestQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestResult" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "present" BOOLEAN NOT NULL,
    "marks" DECIMAL(8,2),
    "correct" INTEGER,
    "incorrect" INTEGER,
    "unattempted" INTEGER,
    "remarks" TEXT,
    "gradedById" TEXT,
    "gradedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestAnswer" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "testQuestionId" TEXT NOT NULL,
    "response" TEXT,
    "outcome" "AnswerOutcome" NOT NULL,
    "marksAwarded" DECIMAL(6,2) NOT NULL,

    CONSTRAINT "TestAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Question_schoolId_subject_idx" ON "Question"("schoolId", "subject");

-- CreateIndex
CREATE INDEX "Question_facultyId_idx" ON "Question"("facultyId");

-- CreateIndex
CREATE INDEX "Question_chapterId_idx" ON "Question"("chapterId");

-- CreateIndex
CREATE UNIQUE INDEX "Question_id_schoolId_key" ON "Question"("id", "schoolId");

-- CreateIndex
CREATE INDEX "Test_schoolId_startsAt_idx" ON "Test"("schoolId", "startsAt");

-- CreateIndex
CREATE INDEX "Test_batchId_startsAt_idx" ON "Test"("batchId", "startsAt");

-- CreateIndex
CREATE INDEX "Test_facultyId_idx" ON "Test"("facultyId");

-- CreateIndex
CREATE UNIQUE INDEX "Test_id_schoolId_key" ON "Test"("id", "schoolId");

-- CreateIndex
CREATE INDEX "TestQuestion_questionId_idx" ON "TestQuestion"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "TestQuestion_id_schoolId_key" ON "TestQuestion"("id", "schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "TestQuestion_testId_position_key" ON "TestQuestion"("testId", "position");

-- CreateIndex
CREATE INDEX "TestResult_studentId_idx" ON "TestResult"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "TestResult_id_schoolId_key" ON "TestResult"("id", "schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "TestResult_testId_studentId_key" ON "TestResult"("testId", "studentId");

-- CreateIndex
CREATE INDEX "TestAnswer_testQuestionId_idx" ON "TestAnswer"("testQuestionId");

-- CreateIndex
CREATE UNIQUE INDEX "TestAnswer_resultId_testQuestionId_key" ON "TestAnswer"("resultId", "testQuestionId");

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "CurriculumChapter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_batchId_schoolId_fkey" FOREIGN KEY ("batchId", "schoolId") REFERENCES "Batch"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestQuestion" ADD CONSTRAINT "TestQuestion_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestQuestion" ADD CONSTRAINT "TestQuestion_testId_schoolId_fkey" FOREIGN KEY ("testId", "schoolId") REFERENCES "Test"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestQuestion" ADD CONSTRAINT "TestQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_testId_schoolId_fkey" FOREIGN KEY ("testId", "schoolId") REFERENCES "Test"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_studentId_schoolId_fkey" FOREIGN KEY ("studentId", "schoolId") REFERENCES "Student"("id", "schoolId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAnswer" ADD CONSTRAINT "TestAnswer_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAnswer" ADD CONSTRAINT "TestAnswer_resultId_schoolId_fkey" FOREIGN KEY ("resultId", "schoolId") REFERENCES "TestResult"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAnswer" ADD CONSTRAINT "TestAnswer_testQuestionId_schoolId_fkey" FOREIGN KEY ("testQuestionId", "schoolId") REFERENCES "TestQuestion"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Questions: marks 1-100 and 0-9 off for a wrong answer; an MCQ has its four
-- options and an A-D answer; Integer and Numerical answers are numbers;
-- Subjective has no options (its model answer is optional).
ALTER TABLE "Question"
  ADD CONSTRAINT "Question_marks_check" CHECK ("marks" BETWEEN 1 AND 100 AND "negativeMarks" BETWEEN 0 AND 9),
  ADD CONSTRAINT "Question_text_check" CHECK (btrim("text") <> '' AND btrim("topic") <> '' AND btrim("subject") <> '' AND btrim("source") <> '' AND btrim("authorName") <> ''),
  ADD CONSTRAINT "Question_answer_check" CHECK (
    ("type" = 'MCQ' AND cardinality("options") = 4 AND "correctAnswer" IS NOT NULL AND "correctAnswer" IN ('A', 'B', 'C', 'D'))
    OR ("type" = 'INTEGER' AND cardinality("options") = 0 AND "correctAnswer" IS NOT NULL AND "correctAnswer" ~ '^-?[0-9]+$')
    OR ("type" = 'NUMERICAL' AND cardinality("options") = 0 AND "correctAnswer" IS NOT NULL AND "correctAnswer" ~ '^-?[0-9]+(\.[0-9]+)?$')
    OR ("type" = 'SUBJECTIVE' AND cardinality("options") = 0)
  );

-- A paper's copy follows the same rules.
ALTER TABLE "TestQuestion"
  ADD CONSTRAINT "TestQuestion_marks_check" CHECK ("marks" BETWEEN 1 AND 100 AND "negativeMarks" BETWEEN 0 AND 9 AND "position" >= 1),
  ADD CONSTRAINT "TestQuestion_answer_check" CHECK (
    ("type" = 'MCQ' AND cardinality("options") = 4 AND "correctAnswer" IS NOT NULL AND "correctAnswer" IN ('A', 'B', 'C', 'D'))
    OR ("type" = 'INTEGER' AND cardinality("options") = 0 AND "correctAnswer" IS NOT NULL AND "correctAnswer" ~ '^-?[0-9]+$')
    OR ("type" = 'NUMERICAL' AND cardinality("options") = 0 AND "correctAnswer" IS NOT NULL AND "correctAnswer" ~ '^-?[0-9]+(\.[0-9]+)?$')
    OR ("type" = 'SUBJECTIVE' AND cardinality("options") = 0)
  );

-- A bank question appears on a paper at most once.
CREATE UNIQUE INDEX "TestQuestion_testId_questionId_key" ON "TestQuestion" ("testId", "questionId") WHERE "questionId" IS NOT NULL;

-- Tests: a sensible length and total, and a cancellation time exactly when cancelled.
ALTER TABLE "Test"
  ADD CONSTRAINT "Test_numbers_check" CHECK ("durationMinutes" BETWEEN 1 AND 720 AND "totalMarks" BETWEEN 1 AND 10000),
  ADD CONSTRAINT "Test_text_check" CHECK (btrim("title") <> '' AND btrim("subject") <> '' AND btrim("createdByName") <> ''),
  ADD CONSTRAINT "Test_cancelled_check" CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL));

-- Results: marks exactly when present; an absent student has no counts; counts are never negative.
-- (Marks within the test's total is checked by the API, against the test.)
ALTER TABLE "TestResult"
  ADD CONSTRAINT "TestResult_present_check" CHECK (
    ("present" AND "marks" IS NOT NULL)
    OR (NOT "present" AND "marks" IS NULL AND "correct" IS NULL AND "incorrect" IS NULL AND "unattempted" IS NULL)
  ),
  ADD CONSTRAINT "TestResult_counts_check" CHECK (coalesce("correct", 0) >= 0 AND coalesce("incorrect", 0) >= 0 AND coalesce("unattempted", 0) >= 0),
  ADD CONSTRAINT "TestResult_text_check" CHECK (btrim("gradedBy") <> '');

-- An unattempted question earns nothing.
ALTER TABLE "TestAnswer"
  ADD CONSTRAINT "TestAnswer_unattempted_check" CHECK ("outcome" <> 'UNATTEMPTED' OR "marksAwarded" = 0);

COMMIT;
