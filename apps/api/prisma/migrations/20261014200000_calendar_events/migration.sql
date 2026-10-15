-- Academic Calendar events (PRD 4.15), in one transaction. A new table only,
-- so there is nothing to check before deploying.
BEGIN;

-- CreateEnum
CREATE TYPE "CalendarEventType" AS ENUM ('HOLIDAY', 'EXAM', 'EVENT', 'PARENT_MEETING');

-- CreateEnum
CREATE TYPE "EventRepeat" AS ENUM ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY');

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "CalendarEventType" NOT NULL,
    "programId" TEXT,
    "batchId" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "description" TEXT,
    "repeat" "EventRepeat" NOT NULL DEFAULT 'NONE',
    "repeatUntil" DATE,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarEvent_schoolId_startDate_idx" ON "CalendarEvent"("schoolId", "startDate");

-- CreateIndex
CREATE INDEX "CalendarEvent_programId_idx" ON "CalendarEvent"("programId");

-- CreateIndex
CREATE INDEX "CalendarEvent_batchId_idx" ON "CalendarEvent"("batchId");

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_programId_schoolId_fkey" FOREIGN KEY ("programId", "schoolId") REFERENCES "Program"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_batchId_schoolId_fkey" FOREIGN KEY ("batchId", "schoolId") REFERENCES "Batch"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Valid periods; a repeating event can't overlap its own next occurrence.
ALTER TABLE "CalendarEvent"
  ADD CONSTRAINT "CalendarEvent_dates_check" CHECK ("endDate" >= "startDate"),
  ADD CONSTRAINT "CalendarEvent_until_check" CHECK ("repeatUntil" IS NULL OR ("repeat" <> 'NONE' AND "repeatUntil" >= "startDate")),
  ADD CONSTRAINT "CalendarEvent_repeat_span_check" CHECK (
    ("repeat" = 'DAILY' AND "endDate" = "startDate")
    OR ("repeat" = 'WEEKLY' AND "endDate" - "startDate" < 7)
    OR ("repeat" = 'MONTHLY' AND "endDate" - "startDate" < 28)
    OR "repeat" = 'NONE'
  );

COMMIT;
