-- Student feedback links: an admin shares a batch's link; a student opens it
-- with no login, picks their name and a teacher, and rates them. The entry is
-- feedback of a new direction, STUDENT_TO_TEACHER, with the student and batch
-- tied to the row's school (composite keys, as for the faculty links); deleting
-- the student or batch nulls only that link and keeps the names. Additive only.
-- ADD VALUE is fine in a transaction as nothing here uses the new value.
BEGIN;
SET LOCAL lock_timeout = '10s';

-- AlterEnum
ALTER TYPE "FeedbackDirection" ADD VALUE 'STUDENT_TO_TEACHER';

-- AlterTable
ALTER TABLE "Feedback" ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "batchName" TEXT,
ADD COLUMN     "studentId" TEXT,
ADD COLUMN     "studentName" TEXT;

-- CreateTable
CREATE TABLE "FeedbackLink" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FeedbackLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackLink_batchId_key" ON "FeedbackLink"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackLink_token_key" ON "FeedbackLink"("token");

-- CreateIndex
CREATE INDEX "FeedbackLink_schoolId_idx" ON "FeedbackLink"("schoolId");

-- CreateIndex
CREATE INDEX "Feedback_studentId_createdAt_idx" ON "Feedback"("studentId", "createdAt");

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_studentId_schoolId_fkey" FOREIGN KEY ("studentId", "schoolId") REFERENCES "Student"("id", "schoolId") ON DELETE SET NULL ("studentId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_batchId_schoolId_fkey" FOREIGN KEY ("batchId", "schoolId") REFERENCES "Batch"("id", "schoolId") ON DELETE SET NULL ("batchId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackLink" ADD CONSTRAINT "FeedbackLink_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackLink" ADD CONSTRAINT "FeedbackLink_batchId_schoolId_fkey" FOREIGN KEY ("batchId", "schoolId") REFERENCES "Batch"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
