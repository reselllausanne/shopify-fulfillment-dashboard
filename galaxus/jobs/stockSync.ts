import { prisma } from "@/app/lib/prisma";
import { assertMappingIntegrity, buildProviderKey } from "@/galaxus/supplier/providerKey";
import { createGoldenSupplierClient } from "../supplier/client";
import { normalizeSize, validateGtin } from "@/app/lib/normalize";
import { bulkInsertSupplierVariants, bulkUpdateSupplierVariants, bulkUpsertVariantMappings, chunkArray } from "./bulkSql";

type StockSyncResult = {
  processed: number;
  updated: number;
  created: number;
};

type StockSyncOptions = {
  limit?: number;
  offset?: number;
};

async function removeMissingSupplierVariants(params: {
  supplierKey: string;
  fetchedIds: string[];
  allowDelete: boolean;
}) {
  const { supplierKey, fetchedIds, allowDelete } = params;
  if (!allowDelete) return { removed: 0, skipped: true };
  if (fetchedIds.length === 0) {
    console.warn("[galaxus][sync] skip delete: empty supplier payload", { supplierKey });
    return { removed: 0, skipped: true };
  }

  const prefix = `${supplierKey}:`;
  const existing = await prisma.supplierVariant.findMany({
    where: { supplierVariantId: { startsWith: prefix } },
    select: { supplierVariantId: true },
  });
  const fetchedSet = new Set(fetchedIds);
  const missing = existing
    .map((row) => row.supplierVariantId)
    .filter((id) => !fetchedSet.has(id));

  let removed = 0;
  for (const batch of chunkArray(missing, 500)) {
    const res = await prisma.supplierVariant.deleteMany({
      where: { supplierVariantId: { in: batch } },
    });
    removed += res.count;
  }
  return { removed, skipped: false };
}

export async function runStockSync(options: StockSyncOptions = {}): Promise<StockSyncResult> {
  const client = createGoldenSupplierClient();
  const startedAt = Date.now();
  const items = await client.fetchStockAndPrice();
  const offset = Math.max(options.offset ?? 0, 0);
  const limit = options.limit ? Math.max(options.limit, 0) : items.length;
  const slicedItems = items.slice(offset, offset + limit);
  const isFullRun = offset === 0 && (options.limit == null || options.limit >= items.length);

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

  const removeResult = await removeMissingSupplierVariants({
    supplierKey: client.supplierKey,
    fetchedIds: items.map((item) => item.supplierVariantId),
    allowDelete: isFullRun,
  });

  const durationMs = Date.now() - startedAt;
  console.info("[galaxus][sync:stock] done", {
    fetchedCount: items.length,
    processed: slicedItems.length,
    insertedCount: created,
    updatedCount: updated,
    mappingInserted,
    mappingUpdated,
    removedMissing: removeResult.removed,
    removeSkipped: removeResult.skipped,
    durationMs,
  });

  return { processed: slicedItems.length, updated, created };
}

export async function runStockPriceSync(options: StockSyncOptions = {}): Promise<StockSyncResult> {
  const client = createGoldenSupplierClient();
  const startedAt = Date.now();
  const items = await client.fetchStockAndPrice();
  const offset = Math.max(options.offset ?? 0, 0);
  const limit = options.limit ? Math.max(options.limit, 0) : items.length;
  const slicedItems = items.slice(offset, offset + limit);
  const isFullRun = offset === 0 && (options.limit == null || options.limit >= items.length);

  const now = new Date();
  const rows = slicedItems.map((item) => ({
    supplierVariantId: item.supplierVariantId,
    price: item.price ?? 0,
    stock: item.stock ?? 0,
  }));

  let updated = 0;
  for (const batch of chunkArray(rows, 500)) {
    updated += await bulkUpdateSupplierVariants(batch, now, { updateGtinWhenProvided: false });
  }

  const removeResult = await removeMissingSupplierVariants({
    supplierKey: client.supplierKey,
    fetchedIds: items.map((item) => item.supplierVariantId),
    allowDelete: isFullRun,
  });

  const durationMs = Date.now() - startedAt;
  console.info("[galaxus][sync:stock-only] done", {
    fetchedCount: items.length,
    processed: slicedItems.length,
    updatedCount: updated,
    removedMissing: removeResult.removed,
    removeSkipped: removeResult.skipped,
    durationMs,
  });

  return { processed: slicedItems.length, updated, created: 0 };
}
