-- Each school gets a second, admin-only invite code. The existing code stays
-- the teacher code and can no longer grant admin rights.
ALTER TABLE "School" ADD COLUMN "adminInviteCode" TEXT;

-- Backfill: a random XXXX-XXXX code per school (same alphabet as the app's
-- generator), re-rolled on the unlikely chance it collides with another code.
DO $$
DECLARE
  alphabet CONSTANT TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  school RECORD;
  candidate TEXT;
BEGIN
  FOR school IN SELECT "id" FROM "School" WHERE "adminInviteCode" IS NULL LOOP
    LOOP
      candidate := '';
      FOR i IN 1..8 LOOP
        candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::INT, 1);
        IF i = 4 THEN candidate := candidate || '-'; END IF;
      END LOOP;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM "School" WHERE "inviteCode" = candidate OR "adminInviteCode" = candidate
      );
    END LOOP;
    UPDATE "School" SET "adminInviteCode" = candidate WHERE "id" = school."id";
  END LOOP;
END $$;

ALTER TABLE "School" ALTER COLUMN "adminInviteCode" SET NOT NULL;
CREATE UNIQUE INDEX "School_adminInviteCode_key" ON "School"("adminInviteCode");

-- Emails are stored lower-cased by the app; back that with the database so a
-- differently-cased duplicate can never slip in.
CREATE UNIQUE INDEX "User_email_lower_key" ON "User" (lower("email"));
