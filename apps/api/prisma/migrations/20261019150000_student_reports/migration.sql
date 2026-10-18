-- Student Reports (PRD 4.5, 4.8, 5.4, 5.7; HLD 9.7). New tables for what no
-- other module collects: daily student ratings, term marks (imported report
-- sheets and progress reports) and progress report remarks. Assignments gain
-- an optional curriculum chapter and topic, so their scores join test
-- answers in topic strength.
--
-- Every link is tied to the row's school (composite keys). Deleting a batch,
-- faculty profile or chapter nulls only that link (ON DELETE SET NULL with a
-- column list, PostgreSQL 15+), never schoolId. Marks are records: a student
-- or batch with marks can't be deleted (NO ACTION; the API says why).
--
-- New tables and two nullable columns: nothing to backfill or check first.
BEGIN;
SET LOCAL lock_timeout = '10s';

-- CreateEnum
CREATE TYPE "ReportTerm" AS ENUM ('UNIT_TEST_1', 'TERM_1', 'MID_TERM', 'TERM_2', 'ANNUAL');

-- CreateEnum
CREATE TYPE "MarkSource" AS ENUM ('IMPORT', 'MANUAL');

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "chapterId" TEXT,
ADD COLUMN     "topic" TEXT;

-- CreateTable
CREATE TABLE "DailyRating" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "batchId" TEXT,
    "facultyId" TEXT,
    "raterName" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "attitude" INTEGER NOT NULL,
    "behaviour" INTEGER NOT NULL,
    "focus" INTEGER NOT NULL,
    "interaction" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DailyRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentMark" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "academicYear" INTEGER NOT NULL,
    "term" "ReportTerm" NOT NULL,
    "subject" TEXT NOT NULL,
    "marks" DECIMAL(7,2) NOT NULL,
    "maxMarks" DECIMAL(7,2) NOT NULL,
    "attendance" DECIMAL(5,2),
    "remarks" TEXT,
    "source" "MarkSource" NOT NULL,
    "enteredById" TEXT,
    "enteredBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StudentMark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressReport" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "academicYear" INTEGER NOT NULL,
    "term" "ReportTerm" NOT NULL,
    "teacherRemarks" TEXT,
    "principalRemarks" TEXT,
    "updatedById" TEXT,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProgressReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyRating_schoolId_date_idx" ON "DailyRating"("schoolId", "date");

-- CreateIndex
CREATE INDEX "DailyRating_batchId_date_idx" ON "DailyRating"("batchId", "date");

-- CreateIndex
CREATE INDEX "DailyRating_facultyId_date_idx" ON "DailyRating"("facultyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyRating_studentId_date_facultyId_key" ON "DailyRating"("studentId", "date", "facultyId");

-- CreateIndex
CREATE INDEX "StudentMark_schoolId_academicYear_term_idx" ON "StudentMark"("schoolId", "academicYear", "term");

-- CreateIndex
CREATE INDEX "StudentMark_batchId_academicYear_term_idx" ON "StudentMark"("batchId", "academicYear", "term");

-- CreateIndex
CREATE UNIQUE INDEX "StudentMark_studentId_academicYear_term_subject_key" ON "StudentMark"("studentId", "academicYear", "term", "subject");

-- CreateIndex
CREATE INDEX "ProgressReport_schoolId_academicYear_term_idx" ON "ProgressReport"("schoolId", "academicYear", "term");

-- CreateIndex
CREATE UNIQUE INDEX "ProgressReport_studentId_academicYear_term_key" ON "ProgressReport"("studentId", "academicYear", "term");

-- CreateIndex
CREATE INDEX "Assignment_chapterId_idx" ON "Assignment"("chapterId");

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_chapterId_schoolId_fkey" FOREIGN KEY ("chapterId", "schoolId") REFERENCES "CurriculumChapter"("id", "schoolId") ON DELETE SET NULL ("chapterId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyRating" ADD CONSTRAINT "DailyRating_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyRating" ADD CONSTRAINT "DailyRating_studentId_schoolId_fkey" FOREIGN KEY ("studentId", "schoolId") REFERENCES "Student"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyRating" ADD CONSTRAINT "DailyRating_batchId_schoolId_fkey" FOREIGN KEY ("batchId", "schoolId") REFERENCES "Batch"("id", "schoolId") ON DELETE SET NULL ("batchId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyRating" ADD CONSTRAINT "DailyRating_facultyId_schoolId_fkey" FOREIGN KEY ("facultyId", "schoolId") REFERENCES "Faculty"("id", "schoolId") ON DELETE SET NULL ("facultyId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentMark" ADD CONSTRAINT "StudentMark_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentMark" ADD CONSTRAINT "StudentMark_studentId_schoolId_fkey" FOREIGN KEY ("studentId", "schoolId") REFERENCES "Student"("id", "schoolId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentMark" ADD CONSTRAINT "StudentMark_batchId_schoolId_fkey" FOREIGN KEY ("batchId", "schoolId") REFERENCES "Batch"("id", "schoolId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressReport" ADD CONSTRAINT "ProgressReport_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressReport" ADD CONSTRAINT "ProgressReport_studentId_schoolId_fkey" FOREIGN KEY ("studentId", "schoolId") REFERENCES "Student"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

-- CHECKs: the PRD rating levels, and report-import rules (HLD 8.3)
ALTER TABLE "DailyRating" ADD CONSTRAINT "DailyRating_levels_check" CHECK ("attitude" BETWEEN 1 AND 5 AND "behaviour" BETWEEN 1 AND 5 AND "focus" BETWEEN 1 AND 5 AND "interaction" BETWEEN 1 AND 5);
ALTER TABLE "StudentMark" ADD CONSTRAINT "StudentMark_marks_check" CHECK ("maxMarks" > 0 AND "marks" >= 0 AND "marks" <= "maxMarks");
ALTER TABLE "StudentMark" ADD CONSTRAINT "StudentMark_attendance_check" CHECK ("attendance" IS NULL OR "attendance" BETWEEN 0 AND 100);
ALTER TABLE "StudentMark" ADD CONSTRAINT "StudentMark_year_check" CHECK ("academicYear" BETWEEN 2000 AND 2100);
ALTER TABLE "ProgressReport" ADD CONSTRAINT "ProgressReport_year_check" CHECK ("academicYear" BETWEEN 2000 AND 2100);

COMMIT;
