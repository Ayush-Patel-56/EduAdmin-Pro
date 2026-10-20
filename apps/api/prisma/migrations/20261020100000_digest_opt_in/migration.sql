-- The daily report digest is opt-in (#54). "Email Notifications" defaulted to
-- on while it did nothing, so no account ever chose it: every account is
-- switched off, and new accounts start off. Anyone who wants the digest turns
-- it on in Account Preferences.
--
-- A digest day also records its attempts, so a digest that keeps failing to
-- send (e.g. a spent mailbox quota) is tried a few times, not every tick.
-- Existing rows were sent (sentAt is kept).
BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE "User" ALTER COLUMN "emailNotifications" SET DEFAULT false;
UPDATE "User" SET "emailNotifications" = false WHERE "emailNotifications";

ALTER TABLE "EmailDigest"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "claimedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "sentAt" DROP NOT NULL,
  ALTER COLUMN "sentAt" DROP DEFAULT;
ALTER TABLE "EmailDigest" ADD CONSTRAINT "EmailDigest_attempts_check" CHECK ("attempts" BETWEEN 1 AND 10);

COMMIT;
