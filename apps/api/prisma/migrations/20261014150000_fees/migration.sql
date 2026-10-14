-- Fee Management (PRD 4.9, HLD 8.4), in one transaction. New tables only, so
-- there is nothing to check before deploying.
--   FeeStructure       what the school charges (amounts in whole paise)
--   FeeDue             what one student owes for one fee and period
--   FeePayment         recorded payments; voided, never edited or deleted
--   FeeReceiptCounter  atomic per-school receipt numbers (REC-2026-000001)
-- The constraints at the end hold the arithmetic and the uniqueness rules
-- that Prisma can't express.
BEGIN;

-- CreateEnum
CREATE TYPE "FeeCategory" AS ENUM ('REGISTRATION', 'MONTHLY_TUITION', 'EXAM', 'MATERIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "FeeFrequency" AS ENUM ('ONE_TIME', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "FeeStatus" AS ENUM ('PAID', 'PENDING', 'PARTIAL', 'OVERDUE', 'WAIVED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('UPI', 'CASH', 'CARD', 'NET_BANKING', 'CHEQUE', 'DD');

-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('MANUAL', 'IMPORT');

-- CreateTable
CREATE TABLE "FeeStructure" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "FeeCategory" NOT NULL,
    "description" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "frequency" "FeeFrequency" NOT NULL,
    "dueDay" INTEGER NOT NULL DEFAULT 5,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "programId" TEXT,
    "batchId" TEXT,
    "academicYear" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FeeStructure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeDue" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "discountPaise" INTEGER NOT NULL DEFAULT 0,
    "lateFeePaise" INTEGER NOT NULL DEFAULT 0,
    "netPaise" INTEGER NOT NULL,
    "paidPaise" INTEGER NOT NULL DEFAULT 0,
    "statusOverride" "FeeStatus",
    "overrideReason" TEXT,
    "overrideById" TEXT,
    "overrideAt" TIMESTAMPTZ(3),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FeeDue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeePayment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "dueId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "transactionRef" TEXT,
    "paidOn" DATE NOT NULL,
    "source" "PaymentSource" NOT NULL DEFAULT 'MANUAL',
    "idempotencyKey" TEXT,
    "notes" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMPTZ(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "FeePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeReceiptCounter" (
    "schoolId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FeeReceiptCounter_pkey" PRIMARY KEY ("schoolId","year")
);

-- CreateIndex
CREATE INDEX "FeeStructure_schoolId_idx" ON "FeeStructure"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeStructure_id_schoolId_key" ON "FeeStructure"("id", "schoolId");

-- CreateIndex
CREATE INDEX "FeeDue_schoolId_dueDate_idx" ON "FeeDue"("schoolId", "dueDate");

-- CreateIndex
CREATE INDEX "FeeDue_studentId_idx" ON "FeeDue"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeDue_structureId_studentId_period_key" ON "FeeDue"("structureId", "studentId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "FeeDue_id_schoolId_key" ON "FeeDue"("id", "schoolId");

-- CreateIndex
CREATE INDEX "FeePayment_dueId_idx" ON "FeePayment"("dueId");

-- CreateIndex
CREATE INDEX "FeePayment_schoolId_paidOn_idx" ON "FeePayment"("schoolId", "paidOn");

-- CreateIndex
CREATE UNIQUE INDEX "FeePayment_schoolId_receiptNumber_key" ON "FeePayment"("schoolId", "receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FeePayment_schoolId_idempotencyKey_key" ON "FeePayment"("schoolId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "FeeStructure" ADD CONSTRAINT "FeeStructure_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeStructure" ADD CONSTRAINT "FeeStructure_programId_schoolId_fkey" FOREIGN KEY ("programId", "schoolId") REFERENCES "Program"("id", "schoolId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeStructure" ADD CONSTRAINT "FeeStructure_batchId_schoolId_fkey" FOREIGN KEY ("batchId", "schoolId") REFERENCES "Batch"("id", "schoolId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeDue" ADD CONSTRAINT "FeeDue_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeDue" ADD CONSTRAINT "FeeDue_studentId_schoolId_fkey" FOREIGN KEY ("studentId", "schoolId") REFERENCES "Student"("id", "schoolId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeDue" ADD CONSTRAINT "FeeDue_structureId_schoolId_fkey" FOREIGN KEY ("structureId", "schoolId") REFERENCES "FeeStructure"("id", "schoolId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_dueId_schoolId_fkey" FOREIGN KEY ("dueId", "schoolId") REFERENCES "FeeDue"("id", "schoolId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeReceiptCounter" ADD CONSTRAINT "FeeReceiptCounter_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One fee name per school, in any letter case.
CREATE UNIQUE INDEX "FeeStructure_schoolId_lower_name_key" ON "FeeStructure"("schoolId", lower("name"));
-- A transaction reference identifies one live payment (a voided one frees it).
CREATE UNIQUE INDEX "FeePayment_schoolId_transactionRef_key" ON "FeePayment"("schoolId", lower("transactionRef"))
  WHERE "transactionRef" IS NOT NULL AND "voidedAt" IS NULL;

-- Exact arithmetic: no negative money, net = amount - discount + late fee.
ALTER TABLE "FeeStructure"
  ADD CONSTRAINT "FeeStructure_amount_check" CHECK ("amountPaise" >= 0),
  ADD CONSTRAINT "FeeStructure_dueDay_check" CHECK ("dueDay" BETWEEN 1 AND 31);
ALTER TABLE "FeeDue"
  ADD CONSTRAINT "FeeDue_amounts_check" CHECK ("amountPaise" >= 0 AND "discountPaise" >= 0 AND "lateFeePaise" >= 0 AND "paidPaise" >= 0),
  ADD CONSTRAINT "FeeDue_net_check" CHECK ("netPaise" = "amountPaise" - "discountPaise" + "lateFeePaise" AND "netPaise" >= 0),
  ADD CONSTRAINT "FeeDue_override_check" CHECK ("statusOverride" IS NULL OR "overrideReason" IS NOT NULL);
ALTER TABLE "FeePayment"
  ADD CONSTRAINT "FeePayment_amount_check" CHECK ("amountPaise" > 0),
  ADD CONSTRAINT "FeePayment_void_check" CHECK ("voidedAt" IS NULL OR "voidReason" IS NOT NULL);

COMMIT;
