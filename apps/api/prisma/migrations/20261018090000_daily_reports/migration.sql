-- Daily class reports (PRD 4.8 and 5.6). A new table only, wrapped in a
-- transaction, so there is nothing to check before deploying.
BEGIN;

-- CreateTable
CREATE TABLE "DailyReport" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "facultyId" TEXT,
    "teacherName" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "reportDate" DATE NOT NULL,
    "subject" TEXT NOT NULL,
    "chapter" TEXT,
    "topics" TEXT NOT NULL,
    "homework" TEXT,
    "observations" TEXT,
    "late" BOOLEAN NOT NULL,
    "submittedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyReport_schoolId_reportDate_idx" ON "DailyReport"("schoolId", "reportDate");

-- CreateIndex
CREATE INDEX "DailyReport_facultyId_reportDate_idx" ON "DailyReport"("facultyId", "reportDate");

-- CreateIndex
CREATE INDEX "DailyReport_batchId_idx" ON "DailyReport"("batchId");

-- AddForeignKey
ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_batchId_schoolId_fkey" FOREIGN KEY ("batchId", "schoolId") REFERENCES "Batch"("id", "schoolId") ON DELETE NO ACTION ON UPDATE CASCADE;


-- On Time means first submitted on the day taught, in India; anything later,
-- or for an earlier day, is Late. The API decides it and the database checks
-- it, and a report can't be for a day after it was submitted.
ALTER TABLE "DailyReport"
  ADD CONSTRAINT "DailyReport_late_check" CHECK ("late" = ("reportDate" < ("submittedAt" AT TIME ZONE 'Asia/Kolkata')::date)),
  ADD CONSTRAINT "DailyReport_not_future_check" CHECK ("reportDate" <= ("submittedAt" AT TIME ZONE 'Asia/Kolkata')::date),
  ADD CONSTRAINT "DailyReport_text_check" CHECK (btrim("subject") <> '' AND btrim("topics") <> '');

-- One report per teacher, batch, subject (any letter case) and day: a second
-- submit (a double click, two tabs) is a 409, and the first can be edited.
CREATE UNIQUE INDEX "DailyReport_one_per_class_key" ON "DailyReport" ("facultyId", "batchId", "reportDate", lower("subject"));

COMMIT;
