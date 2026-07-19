-- Keep SupplierVariant image-sync backlog query on index scans.
CREATE INDEX IF NOT EXISTS "SupplierVariant_imageSync_updatedAt_partial_idx"
ON public."SupplierVariant" ("updatedAt" DESC)
WHERE (
  (
    "hostedImageUrl" IS NULL
    OR "imageSyncStatus" IN ('PENDING', 'FAILED')
    OR "hostedImageUrl" LIKE '%.avif'
    OR "hostedImageUrl" LIKE '%.webp'
    OR "hostedImageUrl" LIKE '%.gif'
  )
  AND (
    "supplierVariantId" ILIKE 'stx:%'
    OR "supplierVariantId" ILIKE 'stx_%'
    OR "supplierVariantId" ILIKE 'the:%'
    OR "supplierVariantId" ILIKE 'the_%'
  )
);

-- Fast default ordering path for supplier-variant list endpoints.
CREATE INDEX IF NOT EXISTS "SupplierVariant_updatedAt_idx"
ON public."SupplierVariant" ("updatedAt" DESC);

-- Parse and persist VariantMapping.supplierKey from supplierVariantId at write time.
CREATE OR REPLACE FUNCTION public.variant_mapping_sync_supplier_key()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."supplierVariantId" IS NULL OR btrim(NEW."supplierVariantId") = '' THEN
    NEW."supplierKey" := NULL;
  ELSE
    NEW."supplierKey" := lower(
      CASE
        WHEN position(':' in NEW."supplierVariantId") > 0 THEN split_part(NEW."supplierVariantId", ':', 1)
        WHEN position('_' in NEW."supplierVariantId") > 0 THEN split_part(NEW."supplierVariantId", '_', 1)
        ELSE NULL
      END
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_variant_mapping_supplier_key ON public."VariantMapping";

CREATE TRIGGER trg_variant_mapping_supplier_key
BEFORE INSERT OR UPDATE OF "supplierVariantId"
ON public."VariantMapping"
FOR EACH ROW
EXECUTE FUNCTION public.variant_mapping_sync_supplier_key();

-- Backfill existing rows so feed filters can run purely on VariantMapping.supplierKey.
UPDATE public."VariantMapping"
SET "supplierKey" = lower(
  CASE
    WHEN position(':' in "supplierVariantId") > 0 THEN split_part("supplierVariantId", ':', 1)
    WHEN position('_' in "supplierVariantId") > 0 THEN split_part("supplierVariantId", '_', 1)
    ELSE NULL
  END
)
WHERE "supplierVariantId" IS NOT NULL
  AND "supplierVariantId" <> ''
  AND (
    "supplierKey" IS NULL
    OR "supplierKey" <> lower(
      CASE
        WHEN position(':' in "supplierVariantId") > 0 THEN split_part("supplierVariantId", ':', 1)
        WHEN position('_' in "supplierVariantId") > 0 THEN split_part("supplierVariantId", '_', 1)
        ELSE NULL
      END
    )
  );

-- Cursor pagination for feed export queries (supplierKey + status + updatedAt/id).
CREATE INDEX IF NOT EXISTS "VariantMapping_supplierKey_status_updatedAt_id_idx"
ON public."VariantMapping" ("supplierKey", "status", "updatedAt" DESC, "id" DESC);

-- Narrow feed-export scan to already-eligible rows.
CREATE INDEX IF NOT EXISTS "VariantMapping_feed_scope_updatedAt_id_partial_idx"
ON public."VariantMapping" ("supplierKey", "updatedAt" DESC, "id" DESC)
WHERE "status" IN ('MATCHED', 'SUPPLIER_GTIN', 'PARTNER_GTIN')
  AND "gtin" IS NOT NULL;
