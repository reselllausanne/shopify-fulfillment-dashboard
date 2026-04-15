import { prisma } from "@/app/lib/prisma";
import { normalizeSize, validateGtin } from "@/app/lib/normalize";
import { runKickdbEnrich } from "@/galaxus/kickdb/enrichJob";
import { createTrmSupplierClient } from "@/galaxus/supplier/trmClient";
import { assertMappingIntegrity, buildProviderKey } from "@/galaxus/supplier/providerKey";
import {
  bulkInsertSupplierVariants,
  bulkUpdateSupplierVariants,
  bulkUpsertVariantMappings,
  chunkArray,
  createLimiter,
  remapRowsToExistingProviderKeyGtin,
} from "@/galaxus/jobs/bulkSql";
import { Prisma } from "@prisma/client";

type TrmSyncOptions = {
  limit?: number;
  offset?: number;
  enrichMissingGtin?: boolean;
};

type TrmSyncResult = {
  processed: number;
  created: number;
  updated: number;
  supplierGtinRows: number;
  missingGtinRows: number;
  invalidGtinRows: number;
  enrichedRows: number;
  enrichErrors: number;
  insertedMappings: number;
  updatedMappings: number;
  durationMs: number;
};

function parsePrice(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function parseStock(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function normalizeGtin(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const gtin = String(value).trim();
  return gtin.length ? gtin : null;
}

async function removeMissingTrmVariants(params: { fetchedIds: string[]; allowDelete: boolean }) {
  const { fetchedIds, allowDelete } = params;
  if (!allowDelete) return { removed: 0, skipped: true };
  if (fetchedIds.length === 0) {
    console.warn("[galaxus][sync] skip delete: empty TRM payload");
    return { removed: 0, skipped: true };
  }

  const existing = await prisma.supplierVariant.findMany({
    where: { supplierVariantId: { startsWith: "trm:" } },
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

async function removeZeroStockTrmVariants(params: { supplierVariantIds: string[]; allowDelete: boolean }) {
  const { supplierVariantIds, allowDelete } = params;
  if (!allowDelete) return { removed: 0, skipped: true };
  if (supplierVariantIds.length === 0) return { removed: 0, skipped: false };

  let removed = 0;
  for (const batch of chunkArray(supplierVariantIds, 500)) {
    const res = await prisma.supplierVariant.deleteMany({
      where: { supplierVariantId: { in: batch } },
    });
    removed += res.count;
  }
  return { removed, skipped: false };
}

async function enrichPendingInStock(supplierVariantIds: string[]) {
  if (supplierVariantIds.length === 0) return;
  const limiter = createLimiter(2);
  await Promise.all(
    supplierVariantIds.map((supplierVariantId) =>
      limiter(async () => {
        try {
          await runKickdbEnrich({ supplierVariantId, forceMissing: true });
        } catch {
          // ignore
        }
      })
    )
  );
}

const EMPTY_TRM_RESULT: TrmSyncResult = {
  processed: 0, created: 0, updated: 0, supplierGtinRows: 0, missingGtinRows: 0,
  invalidGtinRows: 0, enrichedRows: 0, enrichErrors: 0, insertedMappings: 0,
  updatedMappings: 0, durationMs: 0,
};

export async function runTrmSync(_options: TrmSyncOptions = {}): Promise<TrmSyncResult> {
  // TRM supplier is permanently disabled — products must not be re-imported.
  console.info("[galaxus][sync:trm] TRM supplier sync is blocked — skipping");
  return EMPTY_TRM_RESULT;
  const client = createTrmSupplierClient();
  const startedAt = Date.now();
  const products = await client.fetchProductsFullList();
  const flattened = products.flatMap((product) =>
    (product.variants ?? [])
      .map((variant) => {
        const variantId = String(variant.variant_id ?? "").trim();
        if (!variantId) return null;
        return {
          supplierVariantId: `trm:${variantId}`,
          supplierSku: product.sku,
          supplierBrand: product.brand ?? null,
          supplierProductName: product.name ?? null,
          sizeRaw: variant.eu_size ?? variant.size ?? null,
          price: parsePrice(variant.price),
          stock: parseStock(variant.stock),
          gtin: normalizeGtin(variant.ean),
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
  );

  const offset = Math.max(options.offset ?? 0, 0);
  const limit = options.limit ? Math.max(options.limit, 0) : flattened.length;
  const rows = flattened.slice(offset, offset + limit);
  const isFullRun = offset === 0 && (options.limit == null || options.limit >= flattened.length);

  let created = 0;
  let updated = 0;
  let supplierGtinRows = 0;
  let missingGtinRows = 0;
  let invalidGtinRows = 0;
  let enrichedRows = 0;
  let enrichErrors = 0;

  const now = new Date();

  const inputRows = rows.map((r) => {
    const hasGtin = Boolean(r.gtin);
    const valid = hasGtin && r.gtin && validateGtin(r.gtin) ? r.gtin : null;
    if (valid) supplierGtinRows += 1;
    else if (!hasGtin) missingGtinRows += 1;
    else invalidGtinRows += 1;
    const sizeNormalized = normalizeSize(r.sizeRaw ?? null) ?? r.sizeRaw ?? null;
    return {
      supplierVariantId: r.supplierVariantId,
      supplierSku: r.supplierSku,
      providerKey: valid ? buildProviderKey(valid, r.supplierVariantId) : null,
      gtin: valid,
      price: r.price,
      stock: r.stock,
      sizeRaw: r.sizeRaw,
      sizeNormalized,
      supplierBrand: r.supplierBrand,
      supplierProductName: r.supplierProductName,
      images: null,
      leadTimeDays: null,
    };
  });
  const remappedRowsResult = await remapRowsToExistingProviderKeyGtin(inputRows);
  const supplierRows = remappedRowsResult.rows;

  let insertedMappings = 0;
  let updatedMappings = 0;

  for (const row of supplierRows) {
    assertMappingIntegrity({
      supplierVariantId: row.supplierVariantId,
      gtin: row.gtin ?? null,
      providerKey: row.providerKey ?? null,
      status: row.gtin ? "SUPPLIER_GTIN" : "PENDING_GTIN",
    });
  }

  for (const batch of chunkArray(supplierRows, 500)) {
    created += await bulkInsertSupplierVariants(batch, now);
    updated += await bulkUpdateSupplierVariants(batch, now, { updateGtinWhenProvided: true });
  }

  const mappingRows = supplierRows.map((row) => {
    const payload = {
      supplierVariantId: row.supplierVariantId,
      gtin: row.gtin ?? null,
      providerKey: row.providerKey ?? null,
      status: row.gtin ? "SUPPLIER_GTIN" : "PENDING_GTIN",
    };
    assertMappingIntegrity(payload);
    return payload;
  });

  const mappingRes = await bulkUpsertVariantMappings(mappingRows, now, {
    doNotDowngradeFromMatched: true,
    onlySetPendingIfMissing: true,
  });
  insertedMappings += mappingRes.inserted;
  updatedMappings += mappingRes.updated;

  const enrichCandidates = supplierRows
    .filter((row) => !row.gtin && Number(row.stock ?? 0) > 0)
    .map((row) => row.supplierVariantId);
  await enrichPendingInStock(enrichCandidates);

  if (options.enrichMissingGtin !== false) {
    const candidates = await prisma.$queryRaw<Array<{ supplierVariantId: string }>>(Prisma.sql`
        SELECT sv."supplierVariantId"
        FROM "public"."SupplierVariant" sv
        LEFT JOIN "public"."VariantMapping" vm
          ON vm."supplierVariantId" = sv."supplierVariantId"
        WHERE sv."supplierVariantId" LIKE 'trm:%'
          AND sv."gtin" IS NULL
          AND (vm."gtin" IS NULL OR vm."status" IN ('PENDING_GTIN','AMBIGUOUS_GTIN','NOT_FOUND'))
        ORDER BY sv."createdAt" DESC, sv."updatedAt" DESC
      `
    );
    const enrichLimit = createLimiter(2);
    await Promise.all(
      candidates.map((c) =>
        enrichLimit(async () => {
          try {
            const { results } = await runKickdbEnrich({
              supplierVariantId: c.supplierVariantId,
              forceMissing: true,
            });
            enrichedRows += results.length;
          } catch {
            enrichErrors += 1;
          }
        })
      )
    );
  }

  const removeResult = await removeMissingTrmVariants({
    fetchedIds: flattened.map((row) => row.supplierVariantId),
    allowDelete: isFullRun,
  });
  const zeroStockIds = flattened
    .filter((row) => Number(row.stock ?? 0) <= 0)
    .map((row) => row.supplierVariantId);
  const removeZeroStockResult = await removeZeroStockTrmVariants({
    supplierVariantIds: zeroStockIds,
    allowDelete: isFullRun,
  });

  const durationMs = Date.now() - startedAt;
  console.info("[galaxus][sync:trm] done", {
    fetchedProducts: products.length,
    processed: rows.length,
    insertedCount: created,
    updatedCount: updated,
    removedMissing: removeResult.removed,
    removedZeroStock: removeZeroStockResult.removed,
    removeSkipped: removeResult.skipped,
    supplierGtinRows,
    missingGtinRows,
    invalidGtinRows,
    insertedMappings,
    updatedMappings,
    enrichedRows,
    enrichErrors,
    durationMs,
  });

  return {
    processed: rows.length,
    created,
    updated,
    supplierGtinRows,
    missingGtinRows,
    invalidGtinRows,
    enrichedRows,
    enrichErrors,
    insertedMappings,
    updatedMappings,
    durationMs,
  };
}

export async function runTrmStockSync(_options: TrmSyncOptions = {}): Promise<TrmSyncResult> {
  // TRM supplier is permanently disabled — products must not be re-imported.
  console.info("[galaxus][sync:trm-stock] TRM supplier sync is blocked — skipping");
  return EMPTY_TRM_RESULT;
  const client = createTrmSupplierClient();
  const startedAt = Date.now();
  const products = await client.fetchProductsFullList();
  const flattened = products.flatMap((product) =>
    (product.variants ?? [])
      .map((variant) => {
        const variantId = String(variant.variant_id ?? "").trim();
        if (!variantId) return null;
        const sizeRaw = variant.eu_size ?? variant.size ?? null;
        const sizeNormalized = normalizeSize(sizeRaw) ?? sizeRaw ?? null;
        const gtinRaw = normalizeGtin(variant.ean);
        const gtin = gtinRaw && validateGtin(gtinRaw) ? gtinRaw : null;
        const providerKey = gtin ? buildProviderKey(gtin, `trm:${variantId}`) : null;
        return {
          supplierVariantId: `trm:${variantId}`,
          supplierSku: product.sku,
          providerKey,
          gtin,
          sizeRaw,
          sizeNormalized,
          supplierBrand: product.brand ?? null,
          supplierProductName: product.name ?? null,
          images: null,
          leadTimeDays: null,
          price: parsePrice(variant.price),
          stock: parseStock(variant.stock),
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
  );

  const offset = Math.max(options.offset ?? 0, 0);
  const limit = options.limit ? Math.max(options.limit, 0) : flattened.length;
  const rows = flattened.slice(offset, offset + limit);
  const isFullRun = offset === 0 && (options.limit == null || options.limit >= flattened.length);

  const now = new Date();
  let created = 0;
  let updated = 0;
  let mappingInserted = 0;
  let mappingUpdated = 0;
  const remappedRowsResult = await remapRowsToExistingProviderKeyGtin(rows);
  const normalizedRows = remappedRowsResult.rows;

  for (const batch of chunkArray(normalizedRows, 500)) {
    created += await bulkInsertSupplierVariants(batch as any, now);
    updated += await bulkUpdateSupplierVariants(batch, now, { updateGtinWhenProvided: false });
  }

  const mappingRows = normalizedRows
    .filter((r) => r.gtin && r.providerKey)
    .map((r) => {
      const payload = {
        supplierVariantId: r.supplierVariantId,
        gtin: r.gtin as string,
        providerKey: r.providerKey as string,
        status: "SUPPLIER_GTIN" as const,
      };
      assertMappingIntegrity(payload);
      return payload;
    });
  for (const batch of chunkArray(mappingRows, 500)) {
    const res = await bulkUpsertVariantMappings(batch, now, {
      doNotDowngradeFromMatched: true,
      onlySetPendingIfMissing: true,
    });
    mappingInserted += res.inserted;
    mappingUpdated += res.updated;
  }

  const enrichCandidates = normalizedRows
    .filter((row) => !row.gtin && Number(row.stock ?? 0) > 0)
    .map((row) => row.supplierVariantId);
  await enrichPendingInStock(enrichCandidates);

  const removeResult = await removeMissingTrmVariants({
    fetchedIds: flattened.map((row) => row.supplierVariantId),
    allowDelete: isFullRun,
  });
  const zeroStockIds = flattened
    .filter((row) => Number(row.stock ?? 0) <= 0)
    .map((row) => row.supplierVariantId);
  const removeZeroStockResult = await removeZeroStockTrmVariants({
    supplierVariantIds: zeroStockIds,
    allowDelete: isFullRun,
  });

  const durationMs = Date.now() - startedAt;
  console.info("[galaxus][sync:trm-stock-only] done", {
    fetchedCount: flattened.length,
    processed: rows.length,
    insertedCount: created,
    updatedCount: updated,
    removedMissing: removeResult.removed,
    removedZeroStock: removeZeroStockResult.removed,
    removeSkipped: removeResult.skipped,
    mappingInserted,
    mappingUpdated,
    durationMs,
  });

  return {
    processed: rows.length,
    created,
    updated,
    supplierGtinRows: 0,
    missingGtinRows: 0,
    invalidGtinRows: 0,
    enrichedRows: 0,
    enrichErrors: 0,
    insertedMappings: mappingInserted,
    updatedMappings: mappingUpdated,
    durationMs,
  };
}

