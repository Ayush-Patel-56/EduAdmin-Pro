-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('OPEN', 'CLOSED', 'DRAFT');

-- CreateEnum
CREATE TYPE "CandidateStage" AS ENUM ('APPLIED', 'SHORTLISTED', 'INTERVIEW_SCHEDULED', 'UNDER_REVIEW', 'OFFER_EXTENDED', 'HIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "InterviewMode" AS ENUM ('IN_PERSON', 'ONLINE');

-- CreateEnum
CREATE TYPE "InterviewResult" AS ENUM ('PENDING', 'PASS_SHORTLISTED', 'OFFER_RECOMMENDED', 'ON_HOLD', 'FAIL_REJECTED');

-- CreateEnum
CREATE TYPE "AppraisalPeriod" AS ENUM ('ANNUAL', 'MID_TERM', 'PROBATION_REVIEW');

-- CreateEnum
CREATE TYPE "AppraisalStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AppraisalBadge" AS ENUM ('EXCELLENT', 'GOOD', 'SATISFACTORY', 'NEEDS_IMPROVEMENT');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateTable
CREATE TABLE "JobRequirement" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "vacancies" INTEGER NOT NULL DEFAULT 1,
    "status" "JobStatus" NOT NULL DEFAULT 'OPEN',
    "experience" TEXT,
    "qualification" TEXT,
    "postingDate" DATE,
    "closingDate" DATE,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "roleApplied" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "department" TEXT,
    "experienceYears" INTEGER,
    "stage" "CandidateStage" NOT NULL DEFAULT 'APPLIED',
    "qualification" TEXT,
    "currentOrganization" TEXT,
    "expectedSalary" INTEGER,
    "resumeUrl" TEXT,
    "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hiredAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "mode" "InterviewMode" NOT NULL DEFAULT 'IN_PERSON',
    "location" TEXT,
    "panel" TEXT,
    "rating" INTEGER,
    "result" "InterviewResult" NOT NULL DEFAULT 'PENDING',
    "feedback" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherAppraisal" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,
    "department" TEXT,
    "period" "AppraisalPeriod" NOT NULL DEFAULT 'ANNUAL',
    "academicYear" TEXT NOT NULL,
    "status" "AppraisalStatus" NOT NULL DEFAULT 'PENDING',
    "teachingScore" INTEGER,
    "punctualityScore" INTEGER,
    "studentAvg" DECIMAL(5,2),
    "overallBadge" "AppraisalBadge",
    "remarks" TEXT,
    "improvementAreas" TEXT,
    "appraiserId" TEXT,
    "appraiserName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherAppraisal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecruitmentAuditLog" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entity" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "changes" JSONB,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecruitmentAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobRequirement_schoolId_status_idx" ON "JobRequirement"("schoolId", "status");

-- CreateIndex
CREATE INDEX "Candidate_schoolId_stage_idx" ON "Candidate"("schoolId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_id_schoolId_key" ON "Candidate"("id", "schoolId");

-- CreateIndex
CREATE INDEX "Interview_schoolId_scheduledAt_idx" ON "Interview"("schoolId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Interview_candidateId_idx" ON "Interview"("candidateId");

-- CreateIndex
CREATE INDEX "TeacherAppraisal_schoolId_status_idx" ON "TeacherAppraisal"("schoolId", "status");

-- CreateIndex
CREATE INDEX "RecruitmentAuditLog_schoolId_createdAt_idx" ON "RecruitmentAuditLog"("schoolId", "createdAt");

-- AddForeignKey
ALTER TABLE "JobRequirement" ADD CONSTRAINT "JobRequirement_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_candidateId_schoolId_fkey" FOREIGN KEY ("candidateId", "schoolId") REFERENCES "Candidate"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherAppraisal" ADD CONSTRAINT "TeacherAppraisal_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherAppraisal" ADD CONSTRAINT "TeacherAppraisal_facultyId_schoolId_fkey" FOREIGN KEY ("facultyId", "schoolId") REFERENCES "Faculty"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;


-- The audit trail is append-only: reject any UPDATE or DELETE, even from the
-- application's own database user. (TRUNCATE is blocked separately below.)
CREATE FUNCTION "recruitment_audit_log_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'RecruitmentAuditLog is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RecruitmentAuditLog_no_update_delete"
  BEFORE UPDATE OR DELETE ON "RecruitmentAuditLog"
  FOR EACH ROW EXECUTE FUNCTION "recruitment_audit_log_immutable"();

CREATE TRIGGER "RecruitmentAuditLog_no_truncate"
  BEFORE TRUNCATE ON "RecruitmentAuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION "recruitment_audit_log_immutable"();
