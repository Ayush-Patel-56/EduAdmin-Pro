-- Schedule and attendance (PRD 4.1, 4.11, 5.2, 5.10), in one transaction.
-- New tables only, so there is nothing to check before deploying:
--   ScheduleSlot      weekly recurring classes
--   SpecialClass      one-off classes (Extra, Doubt, Revision, Makeup, Orientation)
--   ClassOccurrence   one class on one date: the attendance sheet (keeps the
--                     class details, so history survives edits and deletes)
--   AttendanceRecord  one student's status in one occurrence
-- The CHECK constraints at the end keep days, times and periods valid even
-- if a bug lets a bad value past the API.
BEGIN;

-- CreateEnum
CREATE TYPE "SpecialClassType" AS ENUM ('EXTRA', 'DOUBT', 'REVISION', 'MAKEUP', 'ORIENTATION');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

-- CreateTable
CREATE TABLE "ScheduleSlot" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "room" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ScheduleSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecialClass" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "SpecialClassType" NOT NULL DEFAULT 'EXTRA',
    "subject" TEXT,
    "batchId" TEXT NOT NULL,
    "facultyId" TEXT,
    "date" DATE NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "room" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SpecialClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassOccurrence" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "batchId" TEXT NOT NULL,
    "slotId" TEXT,
    "specialClassId" TEXT,
    "facultyId" TEXT,
    "title" TEXT NOT NULL,
    "subject" TEXT,
    "type" "SpecialClassType",
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "room" TEXT,
    "markedById" TEXT,
    "submittedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClassOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "occurrenceId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduleSlot_schoolId_dayOfWeek_idx" ON "ScheduleSlot"("schoolId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "ScheduleSlot_facultyId_idx" ON "ScheduleSlot"("facultyId");

-- CreateIndex
CREATE INDEX "ScheduleSlot_batchId_idx" ON "ScheduleSlot"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleSlot_id_schoolId_key" ON "ScheduleSlot"("id", "schoolId");

-- CreateIndex
CREATE INDEX "SpecialClass_schoolId_date_idx" ON "SpecialClass"("schoolId", "date");

-- CreateIndex
CREATE INDEX "SpecialClass_batchId_idx" ON "SpecialClass"("batchId");

-- CreateIndex
CREATE INDEX "SpecialClass_facultyId_idx" ON "SpecialClass"("facultyId");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialClass_id_schoolId_key" ON "SpecialClass"("id", "schoolId");

-- CreateIndex
CREATE INDEX "ClassOccurrence_schoolId_date_idx" ON "ClassOccurrence"("schoolId", "date");

-- CreateIndex
CREATE INDEX "ClassOccurrence_batchId_date_idx" ON "ClassOccurrence"("batchId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ClassOccurrence_slotId_date_key" ON "ClassOccurrence"("slotId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ClassOccurrence_specialClassId_key" ON "ClassOccurrence"("specialClassId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassOccurrence_id_schoolId_key" ON "ClassOccurrence"("id", "schoolId");

-- CreateIndex
CREATE INDEX "AttendanceRecord_studentId_idx" ON "AttendanceRecord"("studentId");

-- CreateIndex
CREATE INDEX "AttendanceRecord_schoolId_idx" ON "AttendanceRecord"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_occurrenceId_studentId_key" ON "AttendanceRecord"("occurrenceId", "studentId");

-- AddForeignKey
ALTER TABLE "ScheduleSlot" ADD CONSTRAINT "ScheduleSlot_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleSlot" ADD CONSTRAINT "ScheduleSlot_facultyId_schoolId_fkey" FOREIGN KEY ("facultyId", "schoolId") REFERENCES "Faculty"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleSlot" ADD CONSTRAINT "ScheduleSlot_batchId_schoolId_fkey" FOREIGN KEY ("batchId", "schoolId") REFERENCES "Batch"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialClass" ADD CONSTRAINT "SpecialClass_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialClass" ADD CONSTRAINT "SpecialClass_batchId_schoolId_fkey" FOREIGN KEY ("batchId", "schoolId") REFERENCES "Batch"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialClass" ADD CONSTRAINT "SpecialClass_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassOccurrence" ADD CONSTRAINT "ClassOccurrence_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassOccurrence" ADD CONSTRAINT "ClassOccurrence_batchId_schoolId_fkey" FOREIGN KEY ("batchId", "schoolId") REFERENCES "Batch"("id", "schoolId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassOccurrence" ADD CONSTRAINT "ClassOccurrence_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "ScheduleSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassOccurrence" ADD CONSTRAINT "ClassOccurrence_specialClassId_fkey" FOREIGN KEY ("specialClassId") REFERENCES "SpecialClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassOccurrence" ADD CONSTRAINT "ClassOccurrence_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassOccurrence" ADD CONSTRAINT "ClassOccurrence_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_occurrenceId_schoolId_fkey" FOREIGN KEY ("occurrenceId", "schoolId") REFERENCES "ClassOccurrence"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_studentId_schoolId_fkey" FOREIGN KEY ("studentId", "schoolId") REFERENCES "Student"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Valid days, times (minutes after midnight, end after start) and periods.
ALTER TABLE "ScheduleSlot"
  ADD CONSTRAINT "ScheduleSlot_dayOfWeek_check" CHECK ("dayOfWeek" BETWEEN 0 AND 6),
  ADD CONSTRAINT "ScheduleSlot_time_check" CHECK ("startMinute" >= 0 AND "endMinute" <= 1440 AND "endMinute" > "startMinute"),
  ADD CONSTRAINT "ScheduleSlot_effective_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");
ALTER TABLE "SpecialClass"
  ADD CONSTRAINT "SpecialClass_time_check" CHECK ("startMinute" >= 0 AND "endMinute" <= 1440 AND "endMinute" > "startMinute");
ALTER TABLE "ClassOccurrence"
  ADD CONSTRAINT "ClassOccurrence_time_check" CHECK ("startMinute" >= 0 AND "endMinute" <= 1440 AND "endMinute" > "startMinute");

COMMIT;
