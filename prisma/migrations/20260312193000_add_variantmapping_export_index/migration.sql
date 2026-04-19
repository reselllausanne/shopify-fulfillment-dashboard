CREATE INDEX "VariantMapping_export_cursor_idx"
ON "public"."VariantMapping" ("updatedAt" DESC, "id" DESC)
WHERE "status" IN ('MATCHED', 'SUPPLIER_GTIN', 'PARTNER_GTIN')
  AND "gtin" IS NOT NULL;
