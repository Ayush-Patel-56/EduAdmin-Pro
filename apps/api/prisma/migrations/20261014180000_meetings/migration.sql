-- Meetings (PRD 4.14), in one transaction. New tables only, so there is
-- nothing to check before deploying:
--   Meeting            the Meetings Log entry
--   MeetingAgendaItem  its agenda / discussion items (the minutes)
BEGIN;

-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('GENERAL', 'MANAGEMENT', 'PARENT_TEACHER', 'STAFF', 'DISCIPLINARY');

-- CreateEnum
CREATE TYPE "AgendaPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "AgendaStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "MeetingType" NOT NULL DEFAULT 'GENERAL',
    "date" DATE NOT NULL,
    "startMinute" INTEGER,
    "venue" TEXT,
    "attendees" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minutesPreparedBy" TEXT,
    "nextMeetingDate" DATE,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingAgendaItem" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "discussion" TEXT,
    "action" TEXT,
    "responsible" TEXT,
    "targetDate" DATE,
    "communicatedTo" TEXT,
    "communicatedBy" TEXT,
    "priority" "AgendaPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "AgendaStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MeetingAgendaItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Meeting_schoolId_date_idx" ON "Meeting"("schoolId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_id_schoolId_key" ON "Meeting"("id", "schoolId");

-- CreateIndex
CREATE INDEX "MeetingAgendaItem_meetingId_idx" ON "MeetingAgendaItem"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingAgendaItem_schoolId_idx" ON "MeetingAgendaItem"("schoolId");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAgendaItem" ADD CONSTRAINT "MeetingAgendaItem_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAgendaItem" ADD CONSTRAINT "MeetingAgendaItem_meetingId_schoolId_fkey" FOREIGN KEY ("meetingId", "schoolId") REFERENCES "Meeting"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;


-- A valid time of day, and a next meeting that isn't before this one.
ALTER TABLE "Meeting"
  ADD CONSTRAINT "Meeting_time_check" CHECK ("startMinute" IS NULL OR "startMinute" BETWEEN 0 AND 1439),
  ADD CONSTRAINT "Meeting_next_check" CHECK ("nextMeetingDate" IS NULL OR "nextMeetingDate" >= "date");

COMMIT;
