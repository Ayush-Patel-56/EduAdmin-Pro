-- Request counts for limits that must hold across API instances (login,
-- verification codes, "email me now"), which in-memory counters can't once the
-- API runs as serverless functions: a fixed window per key. The index lets the
-- prune of expired windows find them without a scan.
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "hits" INTEGER NOT NULL,
    "resetAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);
ALTER TABLE "RateLimit" ADD CONSTRAINT "RateLimit_hits_check" CHECK ("hits" >= 1);

CREATE INDEX "RateLimit_resetAt_idx" ON "RateLimit"("resetAt");

COMMIT;
