-- School onboarding: admin invite codes, account types, one invite code per
-- school, school profile fields, programs and announcements.
-- Hand-written so existing rows are carried over instead of rejected.

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ADMIN', 'TEACHER');
CREATE TYPE "AnnouncementCategory" AS ENUM ('GENERAL', 'ACADEMIC', 'EVENT', 'URGENT');

-- AdminInviteCode replaces PlatformInvite. Old invites become single-use codes.
CREATE TABLE "AdminInviteCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "note" TEXT,
    "maxUses" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminInviteCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminInviteCode_code_key" ON "AdminInviteCode"("code");

INSERT INTO "AdminInviteCode" ("id", "code", "note", "maxUses", "uses", "expiresAt", "createdAt")
SELECT "id", "code", "note", 1, CASE WHEN "redeemedAt" IS NULL THEN 0 ELSE 1 END, "expiresAt", "createdAt"
FROM "PlatformInvite";

-- User: account type, derived from what each existing user could already do.
ALTER TABLE "User" ADD COLUMN "accountType" "AccountType",
ADD COLUMN "adminInviteCodeId" TEXT;

UPDATE "User" u SET "accountType" = CASE
    WHEN EXISTS (SELECT 1 FROM "SchoolMembership" m WHERE m."userId" = u."id" AND m."role" = 'ADMIN')
      OR EXISTS (SELECT 1 FROM "PlatformInvite" p WHERE p."redeemedById" = u."id")
    THEN 'ADMIN'::"AccountType"
    ELSE 'TEACHER'::"AccountType"
END;
UPDATE "User" u SET "adminInviteCodeId" = p."id"
FROM "PlatformInvite" p WHERE p."redeemedById" = u."id";

ALTER TABLE "User" ALTER COLUMN "accountType" SET NOT NULL;

-- School: profile fields and a single invite code.
ALTER TABLE "School" ADD COLUMN "address" TEXT,
ADD COLUMN "board" TEXT,
ADD COLUMN "classes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "contactPerson" TEXT,
ADD COLUMN "createdById" TEXT,
ADD COLUMN "email" TEXT,
ADD COLUMN "gstNumber" TEXT,
ADD COLUMN "inviteCode" TEXT,
ADD COLUMN "mouEndDate" DATE,
ADD COLUMN "mouStartDate" DATE,
ADD COLUMN "phone" TEXT;

UPDATE "School" SET "board" = 'Not specified';

-- Keep each school's current teacher code as its invite code where one exists.
UPDATE "School" s SET "inviteCode" = (
    SELECT c."code" FROM "SchoolJoinCode" c
    WHERE c."schoolId" = s."id" AND c."role" = 'TEACHER' AND c."revokedAt" IS NULL
    ORDER BY c."createdAt" DESC LIMIT 1
);
-- Otherwise generate one (same alphabet as the app; the id reference forces a
-- fresh random value per row).
UPDATE "School" s SET "inviteCode" = (
    SELECT string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
    FROM generate_series(1, 4 + 0 * length(s."id"))
) || '-' || (
    SELECT string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
    FROM generate_series(1, 4 + 0 * length(s."id"))
)
WHERE s."inviteCode" IS NULL;

UPDATE "School" s SET "createdById" = p."redeemedById"
FROM "PlatformInvite" p WHERE p."schoolId" = s."id";

ALTER TABLE "School" ALTER COLUMN "board" SET NOT NULL,
ALTER COLUMN "inviteCode" SET NOT NULL;
CREATE UNIQUE INDEX "School_inviteCode_key" ON "School"("inviteCode");

-- Old code tables are superseded.
DROP TABLE "SchoolJoinCode";
DROP TABLE "PlatformInvite";

-- Program
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isStandard" BOOLEAN NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Program_schoolId_idx" ON "Program"("schoolId");
CREATE UNIQUE INDEX "Program_schoolId_name_key" ON "Program"("schoolId", "name");

-- Announcement
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "category" "AnnouncementCategory" NOT NULL DEFAULT 'GENERAL',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Announcement_schoolId_createdAt_idx" ON "Announcement"("schoolId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_adminInviteCodeId_fkey" FOREIGN KEY ("adminInviteCodeId") REFERENCES "AdminInviteCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "School" ADD CONSTRAINT "School_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Program" ADD CONSTRAINT "Program_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
