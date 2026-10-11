-- CreateEnum
CREATE TYPE "ProgramType" AS ENUM ('JEE', 'NEET', 'FOUNDATIONAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ThemeColor" AS ENUM ('BLUE', 'GREEN', 'PURPLE');

-- CreateEnum
CREATE TYPE "FacultyStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "BatchRole" AS ENUM ('PRIMARY', 'SUBSTITUTE', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "SyllabusStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('CONFIRMED', 'DISMISSED');

-- AlterTable
ALTER TABLE "Program" ADD COLUMN     "code" TEXT,
ADD COLUMN     "durationYears" INTEGER,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "targetExams" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "themeColor" "ThemeColor" NOT NULL DEFAULT 'BLUE',
ADD COLUMN     "type" "ProgramType" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "classLevel" INTEGER,
    "capacity" INTEGER NOT NULL DEFAULT 60,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "coordinatorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Faculty" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "altPhone" TEXT,
    "employeeId" TEXT,
    "dateOfBirth" DATE,
    "gender" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "subjects" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "specialization" TEXT,
    "qualification" TEXT,
    "experienceYears" INTEGER,
    "joiningDate" DATE,
    "status" "FacultyStatus" NOT NULL DEFAULT 'ACTIVE',
    "bio" TEXT,
    "profileImageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Faculty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacultyBatch" (
    "facultyId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "role" "BatchRole" NOT NULL DEFAULT 'PRIMARY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacultyBatch_pkey" PRIMARY KEY ("facultyId","batchId")
);

-- CreateTable
CREATE TABLE "FacultyProgram" (
    "facultyId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacultyProgram_pkey" PRIMARY KEY ("facultyId","programId")
);

-- CreateTable
CREATE TABLE "SyllabusItem" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "estimatedHours" INTEGER,
    "targetDates" TEXT,
    "status" "SyllabusStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "remarks" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyllabusItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionCycle" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYear" TEXT NOT NULL,
    "boundaryDate" DATE NOT NULL,
    "status" "PromotionStatus" NOT NULL,
    "studentCount" INTEGER NOT NULL DEFAULT 0,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionCycle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Batch_schoolId_idx" ON "Batch"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_programId_name_key" ON "Batch"("programId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_id_schoolId_key" ON "Batch"("id", "schoolId");

-- CreateIndex
CREATE INDEX "Faculty_schoolId_idx" ON "Faculty"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "Faculty_schoolId_userId_key" ON "Faculty"("schoolId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Faculty_schoolId_email_key" ON "Faculty"("schoolId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Faculty_schoolId_employeeId_key" ON "Faculty"("schoolId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Faculty_id_schoolId_key" ON "Faculty"("id", "schoolId");

-- CreateIndex
CREATE INDEX "FacultyBatch_batchId_idx" ON "FacultyBatch"("batchId");

-- CreateIndex
CREATE INDEX "FacultyProgram_programId_idx" ON "FacultyProgram"("programId");

-- CreateIndex
CREATE INDEX "SyllabusItem_schoolId_batchId_subject_idx" ON "SyllabusItem"("schoolId", "batchId", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionCycle_schoolId_academicYear_key" ON "PromotionCycle"("schoolId", "academicYear");

-- CreateIndex
CREATE UNIQUE INDEX "Program_schoolId_code_key" ON "Program"("schoolId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Program_id_schoolId_key" ON "Program"("id", "schoolId");

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_programId_schoolId_fkey" FOREIGN KEY ("programId", "schoolId") REFERENCES "Program"("id", "schoolId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_coordinatorId_fkey" FOREIGN KEY ("coordinatorId") REFERENCES "Faculty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Faculty" ADD CONSTRAINT "Faculty_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Faculty" ADD CONSTRAINT "Faculty_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacultyBatch" ADD CONSTRAINT "FacultyBatch_facultyId_schoolId_fkey" FOREIGN KEY ("facultyId", "schoolId") REFERENCES "Faculty"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacultyBatch" ADD CONSTRAINT "FacultyBatch_batchId_schoolId_fkey" FOREIGN KEY ("batchId", "schoolId") REFERENCES "Batch"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacultyProgram" ADD CONSTRAINT "FacultyProgram_facultyId_schoolId_fkey" FOREIGN KEY ("facultyId", "schoolId") REFERENCES "Faculty"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacultyProgram" ADD CONSTRAINT "FacultyProgram_programId_schoolId_fkey" FOREIGN KEY ("programId", "schoolId") REFERENCES "Program"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyllabusItem" ADD CONSTRAINT "SyllabusItem_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyllabusItem" ADD CONSTRAINT "SyllabusItem_batchId_schoolId_fkey" FOREIGN KEY ("batchId", "schoolId") REFERENCES "Batch"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionCycle" ADD CONSTRAINT "PromotionCycle_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: give the standard programs created at school setup their type,
-- usual target exams and theme colour.
UPDATE "Program" SET
  "type" = CASE lower("name")
    WHEN 'jee' THEN 'JEE'::"ProgramType"
    WHEN 'neet' THEN 'NEET'::"ProgramType"
    WHEN 'foundational' THEN 'FOUNDATIONAL'::"ProgramType"
    ELSE 'OTHER'::"ProgramType" END,
  "targetExams" = CASE lower("name")
    WHEN 'jee' THEN ARRAY['JEE Main', 'JEE Advanced']
    WHEN 'neet' THEN ARRAY['NEET UG']
    ELSE ARRAY[]::TEXT[] END,
  "themeColor" = CASE lower("name")
    WHEN 'neet' THEN 'GREEN'::"ThemeColor"
    WHEN 'foundational' THEN 'PURPLE'::"ThemeColor"
    ELSE 'BLUE'::"ThemeColor" END;

-- Backfill: every teacher already in a school gets a faculty profile there,
-- linked to their login.
INSERT INTO "Faculty" ("id", "schoolId", "userId", "name", "email", "subjects", "status", "updatedAt")
SELECT gen_random_uuid()::TEXT, m."schoolId", u."id", u."fullName", u."email",
       CASE WHEN u."department" IS NULL OR u."department" = '' THEN ARRAY[]::TEXT[] ELSE ARRAY[u."department"] END,
       'ACTIVE'::"FacultyStatus", CURRENT_TIMESTAMP
FROM "SchoolMembership" m
JOIN "User" u ON u."id" = m."userId"
WHERE m."role" = 'TEACHER' AND m."status" = 'ACTIVE'
ON CONFLICT DO NOTHING;
