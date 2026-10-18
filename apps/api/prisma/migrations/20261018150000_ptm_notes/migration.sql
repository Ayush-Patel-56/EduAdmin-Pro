-- Parent-teacher meeting notes (PRD 5.8). A new table only, wrapped in a
-- transaction, so there is nothing to check before deploying.
BEGIN;

-- Fail cleanly instead of queueing every request behind a long-running query.
SET LOCAL lock_timeout = '10s';

-- CreateTable
CREATE TABLE "PtmNote" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "batchId" TEXT,
    "batchName" TEXT NOT NULL,
    "facultyId" TEXT,
    "teacherName" TEXT NOT NULL,
    "meetingDate" DATE NOT NULL,
    "parentName" TEXT,
    "parentAttended" BOOLEAN NOT NULL,
    "discussion" TEXT NOT NULL,
    "actionItems" TEXT,
    "followUpDate" DATE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PtmNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PtmNote_schoolId_meetingDate_idx" ON "PtmNote"("schoolId", "meetingDate");

-- CreateIndex
CREATE INDEX "PtmNote_facultyId_meetingDate_idx" ON "PtmNote"("facultyId", "meetingDate");

-- CreateIndex
CREATE INDEX "PtmNote_studentId_idx" ON "PtmNote"("studentId");

-- CreateIndex
CREATE INDEX "PtmNote_batchId_idx" ON "PtmNote"("batchId");

-- AddForeignKey
ALTER TABLE "PtmNote" ADD CONSTRAINT "PtmNote_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtmNote" ADD CONSTRAINT "PtmNote_studentId_schoolId_fkey" FOREIGN KEY ("studentId", "schoolId") REFERENCES "Student"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtmNote" ADD CONSTRAINT "PtmNote_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtmNote" ADD CONSTRAINT "PtmNote_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Discussion notes are required, the names a note keeps are never blank, and
-- a follow-up can't come before the meeting it follows.
ALTER TABLE "PtmNote"
  ADD CONSTRAINT "PtmNote_text_check" CHECK (btrim("discussion") <> '' AND btrim("batchName") <> '' AND btrim("teacherName") <> ''),
  ADD CONSTRAINT "PtmNote_follow_up_check" CHECK ("followUpDate" IS NULL OR "followUpDate" >= "meetingDate");

COMMIT;
