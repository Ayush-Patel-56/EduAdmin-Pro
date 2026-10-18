-- Feedback between management and faculty (PRD 4.12 and 5.13). New enums and
-- a new table only, wrapped in a transaction, so there is nothing to check
-- before deploying.
BEGIN;

-- Fail cleanly instead of queueing every request behind a long-running query.
SET LOCAL lock_timeout = '10s';

-- CreateEnum
CREATE TYPE "FeedbackDirection" AS ENUM ('TEACHER_TO_MANAGEMENT', 'MANAGEMENT_TO_TEACHER');

-- CreateEnum
CREATE TYPE "FeedbackCategory" AS ENUM ('ACADEMICS', 'DISCIPLINE', 'PUNCTUALITY', 'TEACHING_QUALITY', 'ADMINISTRATION', 'GENERAL');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('SUBMITTED', 'REVIEWED', 'ACTIONED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "FeedbackSource" AS ENUM ('APP', 'IMPORT');

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "direction" "FeedbackDirection" NOT NULL,
    "senderName" TEXT NOT NULL,
    "senderFacultyId" TEXT,
    "createdById" TEXT,
    "toAllFaculty" BOOLEAN NOT NULL DEFAULT false,
    "targetFacultyId" TEXT,
    "targetName" TEXT,
    "rating" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "subject" TEXT,
    "category" "FeedbackCategory" NOT NULL DEFAULT 'GENERAL',
    "feedbackDate" DATE NOT NULL,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'SUBMITTED',
    "statusChangedAt" TIMESTAMPTZ(3),
    "statusChangedBy" TEXT,
    "source" "FeedbackSource" NOT NULL DEFAULT 'APP',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Feedback_schoolId_createdAt_idx" ON "Feedback"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "Feedback_schoolId_status_idx" ON "Feedback"("schoolId", "status");

-- CreateIndex
CREATE INDEX "Feedback_senderFacultyId_idx" ON "Feedback"("senderFacultyId");

-- CreateIndex
CREATE INDEX "Feedback_targetFacultyId_idx" ON "Feedback"("targetFacultyId");

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_senderFacultyId_fkey" FOREIGN KEY ("senderFacultyId") REFERENCES "Faculty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_targetFacultyId_fkey" FOREIGN KEY ("targetFacultyId") REFERENCES "Faculty"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A rating of 1-5 and some content. Teacher -> Management has no target;
-- Management -> Teacher goes to every teacher or to one named teacher (the
-- name stays if that profile is later deleted). Who last moved an entry, and
-- when, is set exactly when it has left Submitted.
ALTER TABLE "Feedback"
  ADD CONSTRAINT "Feedback_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
  ADD CONSTRAINT "Feedback_content_check" CHECK (btrim("content") <> '' AND btrim("senderName") <> ''),
  ADD CONSTRAINT "Feedback_direction_check" CHECK (
    ("direction" = 'TEACHER_TO_MANAGEMENT' AND NOT "toAllFaculty" AND "targetFacultyId" IS NULL AND "targetName" IS NULL)
    OR ("direction" = 'MANAGEMENT_TO_TEACHER' AND "toAllFaculty" AND "targetFacultyId" IS NULL AND "targetName" IS NULL)
    OR ("direction" = 'MANAGEMENT_TO_TEACHER' AND NOT "toAllFaculty" AND "targetName" IS NOT NULL)
  ),
  ADD CONSTRAINT "Feedback_status_check" CHECK (("status" = 'SUBMITTED') = ("statusChangedAt" IS NULL));

COMMIT;
