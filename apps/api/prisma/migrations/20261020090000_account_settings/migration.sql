-- Account settings: a profile picture for any account (a link, or a small
-- uploaded image kept with the account, as an account spans schools), the
-- in-app notifications behind the bell (syllabus updates, for users whose
-- Account Preferences ask for them), and the record of daily report digests
-- emailed (one per user and day, so several API instances send one).
--
-- New tables and one nullable column: nothing to backfill or check first.
BEGIN;
SET LOCAL lock_timeout = '10s';

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('SYLLABUS_UPDATE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarUrl" TEXT;

-- CreateTable
CREATE TABLE "UserAvatar" (
    "userId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UserAvatar_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDigest" (
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "sentAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailDigest_pkey" PRIMARY KEY ("userId","day")
);

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_schoolId_idx" ON "Notification"("schoolId");

-- AddForeignKey
ALTER TABLE "UserAvatar" ADD CONSTRAINT "UserAvatar_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDigest" ADD CONSTRAINT "EmailDigest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CHECKs: an uploaded picture is a small image of a known type; a link is https.
ALTER TABLE "UserAvatar" ADD CONSTRAINT "UserAvatar_image_check" CHECK ("contentType" IN ('image/jpeg', 'image/png', 'image/webp') AND octet_length("data") BETWEEN 1 AND 262144);
ALTER TABLE "User" ADD CONSTRAINT "User_avatarUrl_check" CHECK ("avatarUrl" IS NULL OR ("avatarUrl" LIKE 'https://%' AND length("avatarUrl") <= 500));

COMMIT;
