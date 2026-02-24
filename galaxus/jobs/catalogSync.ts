import { assertMappingIntegrity, buildProviderKey } from "@/galaxus/supplier/providerKey";
import { createGoldenSupplierClient } from "../supplier/client";
import { normalizeSize, validateGtin } from "@/app/lib/normalize";
import { bulkInsertSupplierVariants, bulkUpdateSupplierVariants, bulkUpsertVariantMappings, chunkArray } from "./bulkSql";

type CatalogSyncResult = {
  processed: number;
  created: number;
  updated: number;
  mappingInserted: number;
  mappingUpdated: number;
  durationMs: number;
};

type CatalogSyncOptions = {
  limit?: number;
  offset?: number;
};

export async function runCatalogSync(options: CatalogSyncOptions = {}): Promise<CatalogSyncResult> {
  const client = createGoldenSupplierClient();
  const startedAt = Date.now();
  const items = await client.fetchCatalog();
  const offset = Math.max(options.offset ?? 0, 0);
  const limit = options.limit ? Math.max(options.limit, 0) : items.length;
  const slicedItems = items.slice(offset, offset + limit);

  const now = new Date();
  const rows = slicedItems.map((item) => {
    const sizeNormalized = normalizeSize(item.sizeRaw ?? null) ?? item.sizeRaw ?? null;
    const supplierGtinRaw = item.sourcePayload?.barcode ?? null;
    const supplierGtin = supplierGtinRaw && validateGtin(supplierGtinRaw) ? supplierGtinRaw : null;
    const providerKey = supplierGtin ? buildProviderKey(supplierGtin, item.supplierVariantId) : null;
    return {
      supplierVariantId: item.supplierVariantId,
      supplierSku: item.supplierSku,
      providerKey,
      gtin: supplierGtin,
      price: item.price ?? 0,
      stock: item.stock ?? 0,
      sizeRaw: item.sizeRaw,
      sizeNormalized,
      supplierBrand: item.sourcePayload.brand_name ?? null,
      supplierProductName: item.sourcePayload.product_name ?? null,
      images: item.images.length ? item.images : null,
      leadTimeDays: item.leadTimeDays,
    };
  });
  for (const row of rows) {
    assertMappingIntegrity({
      supplierVariantId: row.supplierVariantId,
      gtin: row.gtin ?? null,
      providerKey: row.providerKey ?? null,
      status: row.gtin ? "SUPPLIER_GTIN" : "PENDING_GTIN",
    });
  }

  let created = 0;
  let updated = 0;
  for (const batch of chunkArray(rows, 500)) {
    created += await bulkInsertSupplierVariants(batch, now);
    updated += await bulkUpdateSupplierVariants(batch, now, { updateGtinWhenProvided: true });
  }

  const mappingRows = rows.map((r) => {
    const status = r.gtin ? "SUPPLIER_GTIN" : "PENDING_GTIN";
    const providerKey = r.gtin ? buildProviderKey(r.gtin, r.supplierVariantId) : null;
    const payload = {
      supplierVariantId: r.supplierVariantId,
      gtin: r.gtin ?? null,
      providerKey,
      status,
    };
    assertMappingIntegrity(payload);
    return payload;
  });
  let mappingInserted = 0;
  let mappingUpdated = 0;
  for (const batch of chunkArray(mappingRows, 500)) {
    const res = await bulkUpsertVariantMappings(batch, now, {
      doNotDowngradeFromMatched: true,
      onlySetPendingIfMissing: true,
    });
    mappingInserted += res.inserted;
    mappingUpdated += res.updated;
  }

  const durationMs = Date.now() - startedAt;
  console.info("[galaxus][sync:catalog] done", {
    fetchedCount: items.length,
    processed: slicedItems.length,
    insertedCount: created,
    updatedCount: updated,
    mappingInserted,
    mappingUpdated,
    durationMs,
  });

  return { processed: slicedItems.length, created, updated, mappingInserted, mappingUpdated, durationMs };
}
