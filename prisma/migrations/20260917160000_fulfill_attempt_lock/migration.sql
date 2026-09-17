-- Persistent idempotency + in-progress lock for fulfill-from-awb.
CREATE TABLE "public"."FulfillAttemptLock" (
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

CREATE UNIQUE INDEX "FulfillAttemptLock_idempotencyKey_key"
    ON "public"."FulfillAttemptLock"("idempotencyKey");

CREATE INDEX "FulfillAttemptLock_awb_shopifyOrderId_idx"
    ON "public"."FulfillAttemptLock"("awb", "shopifyOrderId");

CREATE INDEX "FulfillAttemptLock_status_updatedAt_idx"
    ON "public"."FulfillAttemptLock"("status", "updatedAt");
