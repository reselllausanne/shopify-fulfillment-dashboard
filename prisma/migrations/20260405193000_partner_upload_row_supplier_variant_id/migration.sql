-- Link GTIN inbox rows to SupplierVariant; catalog edits sync this column + sku fields.
ALTER TABLE "PartnerUploadRow" ADD COLUMN IF NOT EXISTS "supplierVariantId" TEXT;
CREATE INDEX IF NOT EXISTS "PartnerUploadRow_supplierVariantId_idx" ON "PartnerUploadRow"("supplierVariantId");
