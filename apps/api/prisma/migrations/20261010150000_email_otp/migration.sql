-- Email verification moves from links to 6-digit codes. Old link tokens are
-- unusable as codes, so clear them rather than carry dead rows.
DELETE FROM "EmailVerificationToken";

DROP INDEX "EmailVerificationToken_tokenHash_key";
ALTER TABLE "EmailVerificationToken" RENAME COLUMN "tokenHash" TO "codeHash";
ALTER TABLE "EmailVerificationToken" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
