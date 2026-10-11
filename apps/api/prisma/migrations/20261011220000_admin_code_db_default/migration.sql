-- Lets the previous API version keep creating schools between running the
-- admin-invite-code migration and deploying the new API: an insert that
-- doesn't set "adminInviteCode" gets a fresh, unused XXXX-XXXX code instead
-- of failing the NOT NULL constraint. The new API still sets its own code.
CREATE FUNCTION "generate_school_invite_code"() RETURNS TEXT AS $$
DECLARE
  alphabet CONSTANT TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidate TEXT;
BEGIN
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
  RETURN candidate;
END;
$$ LANGUAGE plpgsql VOLATILE;

ALTER TABLE "School" ALTER COLUMN "adminInviteCode" SET DEFAULT "generate_school_invite_code"();
