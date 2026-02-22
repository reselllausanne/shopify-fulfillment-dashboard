import { prisma } from "@/app/lib/prisma";
import { buildProviderKey, resolveSupplierCode } from "@/galaxus/supplier/providerKey";
import { createGoldenSupplierClient } from "../supplier/client";
import { validateGtin } from "@/app/lib/normalize";
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
    const supplierGtinRaw = item.sourcePayload?.barcode ?? null;
    const supplierGtin = supplierGtinRaw && validateGtin(supplierGtinRaw) ? supplierGtinRaw : null;
    return {
      supplierVariantId: item.supplierVariantId,
      supplierSku: item.supplierSku,
      providerKey: resolveSupplierCode(item.supplierVariantId),
      gtin: supplierGtin,
      price: item.price ?? 0,
      stock: item.stock ?? 0,
      sizeRaw: item.sizeRaw,
      supplierBrand: item.sourcePayload.brand_name ?? null,
      supplierProductName: item.sourcePayload.product_name ?? null,
      images: item.images.length ? item.images : null,
      leadTimeDays: item.leadTimeDays,
    };
  });

  let created = 0;
  let updated = 0;
  for (const batch of chunkArray(rows, 500)) {
    created += await bulkInsertSupplierVariants(batch, now);
    updated += await bulkUpdateSupplierVariants(batch, now, { updateGtinWhenProvided: true });
  }

  const mappingRows = rows
    .filter((r) => Boolean(r.gtin))
    .map((r) => ({
      supplierVariantId: r.supplierVariantId,
      gtin: r.gtin ?? null,
      providerKey: r.gtin ? buildProviderKey(r.gtin, r.supplierVariantId) : null,
      status: "SUPPLIER_GTIN",
    }));
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
