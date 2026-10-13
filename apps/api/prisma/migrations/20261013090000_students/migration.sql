-- Students (PRD 4.6): roster, guardians, batch history, and the metadata of
-- uploaded files (profile photos for now; bytes live in object storage).
-- New tables only, so there is nothing to check before deploying. Wrapped in
-- a transaction so a failure leaves nothing half-created.
BEGIN;

-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'TRANSFERRED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "FilePurpose" AS ENUM ('STUDENT_PHOTO');

-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('PENDING', 'READY');

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "admissionNumber" TEXT,
    "aadharNumber" TEXT,
    "rollNumber" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "parentContact" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "dateOfBirth" DATE,
    "gender" TEXT,
    "bloodGroup" TEXT,
    "profileImageUrl" TEXT,
    "photoFileId" TEXT,
    "previousSchool" TEXT,
    "previousPercentage" DECIMAL(5,2),
    "classLevel" TEXT,
    "programId" TEXT,
    "batchId" TEXT,
    "admissionDate" DATE,
    "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentGuardian" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT,
    "phone" TEXT,
    "altPhone" TEXT,
    "email" TEXT,
    "occupation" TEXT,
    "annualIncome" INTEGER,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StudentGuardian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentEnrollment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rollNumber" TEXT,
    "enrolledOn" DATE NOT NULL,
    "endedOn" DATE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileObject" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "purpose" "FilePurpose" NOT NULL,
    "status" "FileStatus" NOT NULL DEFAULT 'PENDING',
    "key" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileObject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Student_schoolId_classLevel_idx" ON "Student"("schoolId", "classLevel");

-- CreateIndex
CREATE INDEX "Student_programId_idx" ON "Student"("programId");

-- CreateIndex
CREATE UNIQUE INDEX "Student_schoolId_admissionNumber_key" ON "Student"("schoolId", "admissionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Student_schoolId_aadharNumber_key" ON "Student"("schoolId", "aadharNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Student_batchId_rollNumber_key" ON "Student"("batchId", "rollNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Student_id_schoolId_key" ON "Student"("id", "schoolId");

-- CreateIndex
CREATE INDEX "StudentGuardian_studentId_idx" ON "StudentGuardian"("studentId");

-- CreateIndex
CREATE INDEX "StudentEnrollment_studentId_idx" ON "StudentEnrollment"("studentId");

-- CreateIndex
CREATE INDEX "StudentEnrollment_batchId_idx" ON "StudentEnrollment"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "FileObject_key_key" ON "FileObject"("key");

-- CreateIndex
CREATE INDEX "FileObject_schoolId_status_createdAt_idx" ON "FileObject"("schoolId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FileObject_id_schoolId_key" ON "FileObject"("id", "schoolId");

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_programId_schoolId_fkey" FOREIGN KEY ("programId", "schoolId") REFERENCES "Program"("id", "schoolId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_batchId_schoolId_fkey" FOREIGN KEY ("batchId", "schoolId") REFERENCES "Batch"("id", "schoolId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_photoFileId_schoolId_fkey" FOREIGN KEY ("photoFileId", "schoolId") REFERENCES "FileObject"("id", "schoolId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentGuardian" ADD CONSTRAINT "StudentGuardian_studentId_schoolId_fkey" FOREIGN KEY ("studentId", "schoolId") REFERENCES "Student"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentEnrollment" ADD CONSTRAINT "StudentEnrollment_studentId_schoolId_fkey" FOREIGN KEY ("studentId", "schoolId") REFERENCES "Student"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentEnrollment" ADD CONSTRAINT "StudentEnrollment_batchId_schoolId_fkey" FOREIGN KEY ("batchId", "schoolId") REFERENCES "Batch"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- At most one primary guardian per student. A partial index, which
-- schema.prisma can't express; Prisma leaves it alone.
CREATE UNIQUE INDEX "StudentGuardian_primary_key" ON "StudentGuardian"("studentId") WHERE "isPrimary";

COMMIT;
