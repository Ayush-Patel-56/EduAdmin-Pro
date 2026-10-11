-- ADMIN123 is a public code (it was in the README), so it must not work in
-- production. A migration can't tell production from development, so it is
-- revoked everywhere; development databases get it back with
-- `pnpm --filter api seed:dev`, which refuses to run when NODE_ENV=production.
-- Accounts created with it are unaffected (only new signups are refused).
BEGIN;

UPDATE "AdminInviteCode"
SET "revokedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'ADMIN123' AND "revokedAt" IS NULL;

COMMIT;
