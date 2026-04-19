-- Link partner order lines to the supplier variant we matched at assign time (stock deduction on fulfill).
ALTER TABLE "public"."PartnerOrderLine" ADD COLUMN IF NOT EXISTS "supplierVariantId" TEXT;

CREATE INDEX IF NOT EXISTS "PartnerOrderLine_supplierVariantId_idx" ON "public"."PartnerOrderLine" ("supplierVariantId");
