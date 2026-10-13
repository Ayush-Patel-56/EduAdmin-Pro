-- Teacher portal (PRD 4.7, 4.13, 5.9): faculty profile fields (designation,
-- primary subject and stream, uploaded photo), study material, assignments
-- with staff-recorded submissions, and counseling sessions. New columns are
-- nullable or have defaults and the rest are new tables, so there is nothing
-- to check before deploying. Wrapped in a transaction: all or nothing.
BEGIN;

-- CreateEnum
CREATE TYPE "FacultyDesignation" AS ENUM ('TEACHER', 'COORDINATOR');

-- CreateEnum
CREATE TYPE "MaterialType" AS ENUM ('NOTES', 'PDF', 'VIDEO', 'PRACTICE_SHEET', 'DPP', 'REFERENCE', 'ANSWER_KEY');

-- CreateEnum
CREATE TYPE "AssignmentType" AS ENUM ('HOMEWORK', 'DPP', 'WORKSHEET', 'PROJECT', 'REVISION');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('PENDING', 'SUBMITTED', 'LATE', 'GRADED');

-- CreateEnum
CREATE TYPE "CounselingType" AS ENUM ('ACADEMIC', 'CAREER', 'PERSONAL', 'DISCIPLINARY', 'PARENT_MEETING');

-- CreateEnum
CREATE TYPE "CounselingStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'NO_SHOW', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FilePurpose" ADD VALUE 'FACULTY_PHOTO';
ALTER TYPE "FilePurpose" ADD VALUE 'STUDY_MATERIAL';
ALTER TYPE "FilePurpose" ADD VALUE 'ASSIGNMENT_SHEET';
ALTER TYPE "FilePurpose" ADD VALUE 'SUBMISSION';

-- AlterTable
ALTER TABLE "Faculty" ADD COLUMN     "designation" "FacultyDesignation" NOT NULL DEFAULT 'TEACHER',
ADD COLUMN     "photoFileId" TEXT,
ADD COLUMN     "primaryStream" TEXT,
ADD COLUMN     "primarySubject" TEXT;

-- CreateTable
CREATE TABLE "StudyMaterial" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "provider" TEXT NOT NULL,
    "chapter" TEXT,
    "type" "MaterialType" NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "fileId" TEXT NOT NULL,
    "facultyId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StudyMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "chapter" TEXT NOT NULL,
    "type" "AssignmentType" NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "totalMarks" INTEGER NOT NULL,
    "questionFileId" TEXT,
    "facultyId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentSubmission" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "score" DECIMAL(6,2),
    "feedback" TEXT,
    "fileId" TEXT,
    "submittedOn" DATE,
    "gradedAt" TIMESTAMPTZ(3),
    "gradedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AssignmentSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CounselingSession" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "counselorUserId" TEXT,
    "counselorFacultyId" TEXT,
    "counselorName" TEXT NOT NULL,
    "type" "CounselingType" NOT NULL,
    "status" "CounselingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "nextSessionDate" DATE,
    "notes" TEXT,
    "actionItems" TEXT,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CounselingSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudyMaterial_schoolId_createdAt_idx" ON "StudyMaterial"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "StudyMaterial_batchId_idx" ON "StudyMaterial"("batchId");

-- CreateIndex
CREATE INDEX "Assignment_schoolId_dueAt_idx" ON "Assignment"("schoolId", "dueAt");

-- CreateIndex
CREATE INDEX "Assignment_batchId_idx" ON "Assignment"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_id_schoolId_key" ON "Assignment"("id", "schoolId");

-- CreateIndex
CREATE INDEX "AssignmentSubmission_studentId_idx" ON "AssignmentSubmission"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentSubmission_assignmentId_studentId_key" ON "AssignmentSubmission"("assignmentId", "studentId");

-- CreateIndex
CREATE INDEX "CounselingSession_schoolId_scheduledAt_idx" ON "CounselingSession"("schoolId", "scheduledAt");

-- CreateIndex
CREATE INDEX "CounselingSession_studentId_idx" ON "CounselingSession"("studentId");

-- CreateIndex
CREATE INDEX "CounselingSession_counselorFacultyId_idx" ON "CounselingSession"("counselorFacultyId");

-- AddForeignKey
ALTER TABLE "Faculty" ADD CONSTRAINT "Faculty_photoFileId_schoolId_fkey" FOREIGN KEY ("photoFileId", "schoolId") REFERENCES "FileObject"("id", "schoolId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyMaterial" ADD CONSTRAINT "StudyMaterial_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyMaterial" ADD CONSTRAINT "StudyMaterial_batchId_schoolId_fkey" FOREIGN KEY ("batchId", "schoolId") REFERENCES "Batch"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyMaterial" ADD CONSTRAINT "StudyMaterial_fileId_schoolId_fkey" FOREIGN KEY ("fileId", "schoolId") REFERENCES "FileObject"("id", "schoolId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyMaterial" ADD CONSTRAINT "StudyMaterial_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_batchId_schoolId_fkey" FOREIGN KEY ("batchId", "schoolId") REFERENCES "Batch"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_questionFileId_schoolId_fkey" FOREIGN KEY ("questionFileId", "schoolId") REFERENCES "FileObject"("id", "schoolId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_assignmentId_schoolId_fkey" FOREIGN KEY ("assignmentId", "schoolId") REFERENCES "Assignment"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_studentId_schoolId_fkey" FOREIGN KEY ("studentId", "schoolId") REFERENCES "Student"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_fileId_schoolId_fkey" FOREIGN KEY ("fileId", "schoolId") REFERENCES "FileObject"("id", "schoolId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounselingSession" ADD CONSTRAINT "CounselingSession_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounselingSession" ADD CONSTRAINT "CounselingSession_studentId_schoolId_fkey" FOREIGN KEY ("studentId", "schoolId") REFERENCES "Student"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounselingSession" ADD CONSTRAINT "CounselingSession_counselorUserId_fkey" FOREIGN KEY ("counselorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounselingSession" ADD CONSTRAINT "CounselingSession_counselorFacultyId_fkey" FOREIGN KEY ("counselorFacultyId") REFERENCES "Faculty"("id") ON DELETE SET NULL ON UPDATE CASCADE;


COMMIT;
