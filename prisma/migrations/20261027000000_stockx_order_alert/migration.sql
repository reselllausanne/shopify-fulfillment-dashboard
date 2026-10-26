-- Operator-facing StockX order issue alerts (cancel / refund / delay / not-purchased).
-- One row per (scope, alertType, refKey) dedupes repeat emails. Additive only.

CREATE TABLE IF NOT EXISTS "public"."StockxOrderAlert" (
  "id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "alertType" TEXT NOT NULL,
  "refKey" TEXT NOT NULL,
  "orderRef" TEXT,
  "stockxOrderNumber" TEXT,
  "productTitle" TEXT,
  "detail" TEXT,
  "emailTo" TEXT,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StockxOrderAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StockxOrderAlert_scope_alertType_refKey_key"
  ON "public"."StockxOrderAlert" ("scope", "alertType", "refKey");

CREATE INDEX IF NOT EXISTS "StockxOrderAlert_sentAt_idx"
  ON "public"."StockxOrderAlert" ("sentAt");
