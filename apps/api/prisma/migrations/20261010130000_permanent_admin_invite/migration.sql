-- ADMIN123 is the permanent admin signup code: unlimited uses, never expires.
-- Upsert so every environment has it, and so it is restored if it was revoked,
-- limited or given an expiry.
INSERT INTO "AdminInviteCode" ("id", "code", "note", "maxUses", "uses", "expiresAt", "revokedAt", "createdAt")
VALUES (gen_random_uuid()::text, 'ADMIN123', 'Permanent admin signup code', NULL, 0, NULL, NULL, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
    "note" = EXCLUDED."note",
    "maxUses" = NULL,
    "expiresAt" = NULL,
    "revokedAt" = NULL;
