-- Persistent idempotency + in-progress lock for fulfill-from-awb.
-- IF NOT EXISTS: staging already has this table from an out-of-band apply.
-- Fresh databases still create it. No column/type change vs the original DDL.
CREATE TABLE IF NOT EXISTS "public"."FulfillAttemptLock" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "awb" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "selectionHash" TEXT NOT NULL,
    "resultJson" JSONB,
    "error" TEXT,

    CONSTRAINT "FulfillAttemptLock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FulfillAttemptLock_idempotencyKey_key"
    ON "public"."FulfillAttemptLock"("idempotencyKey");

CREATE INDEX IF NOT EXISTS "FulfillAttemptLock_awb_shopifyOrderId_idx"
    ON "public"."FulfillAttemptLock"("awb", "shopifyOrderId");

CREATE INDEX IF NOT EXISTS "FulfillAttemptLock_status_updatedAt_idx"
    ON "public"."FulfillAttemptLock"("status", "updatedAt");
