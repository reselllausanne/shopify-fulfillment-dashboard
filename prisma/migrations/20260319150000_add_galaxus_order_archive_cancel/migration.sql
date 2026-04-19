-- Add archive/cancel fields for Galaxus orders
ALTER TABLE "public"."GalaxusOrder"
ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "cancelReason" TEXT;

-- Indexes for active/history filtering
CREATE INDEX "GalaxusOrder_archivedAt_idx" ON "public"."GalaxusOrder"("archivedAt");
CREATE INDEX "GalaxusOrder_cancelledAt_idx" ON "public"."GalaxusOrder"("cancelledAt");
