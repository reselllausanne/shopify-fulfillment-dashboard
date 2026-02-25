import { prisma } from "@/app/lib/prisma";
import { normalizeSize, validateGtin } from "@/app/lib/normalize";
import { runKickdbEnrich } from "@/galaxus/kickdb/enrichJob";
import { createTrmSupplierClient } from "@/galaxus/supplier/trmClient";
import { assertMappingIntegrity, buildProviderKey } from "@/galaxus/supplier/providerKey";
import { bulkInsertSupplierVariants, bulkUpdateSupplierVariants, bulkUpsertVariantMappings, chunkArray, createLimiter } from "@/galaxus/jobs/bulkSql";
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

export async function runTrmSync(options: TrmSyncOptions = {}): Promise<TrmSyncResult> {
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

  // For TRM, GTIN is NOT volatile. Never overwrite existing GTIN/mapping with null.
  // Prepare batches with valid GTINs de-duplicated and avoiding existing providerKey+gtin conflicts.
  const batches = chunkArray(rows, 500);

  let insertedMappings = 0;
  let updatedMappings = 0;

  for (const batch of batches) {
    // Build map of gtin -> first supplierVariantId to avoid duplicates in the same batch.
    const firstByGtin = new Map<string, string>();
    for (const r of batch) {
      const g = r.gtin && validateGtin(r.gtin) ? r.gtin : null;
      if (!g) continue;
      if (!firstByGtin.has(g)) firstByGtin.set(g, r.supplierVariantId);
    }

    // Avoid conflicts with existing TRM rows having the same (providerKey, gtin).
    const gtins = Array.from(firstByGtin.keys());
    const existingUsed = gtins.length
      ? await prisma.$queryRaw<Array<{ gtin: string; supplierVariantId: string }>>(
          Prisma.sql`
              SELECT "gtin", "supplierVariantId"
              FROM "public"."SupplierVariant"
              WHERE "supplierVariantId" LIKE 'trm:%'
                AND "gtin" = ANY(${gtins}::text[])
            `
        )
      : [];
    const usedGtins = new Set<string>();
    for (const row of existingUsed) {
      if (row?.gtin) usedGtins.add(String(row.gtin));
    }

    const supplierRows = batch.map((r) => {
      const hasGtin = Boolean(r.gtin);
      const valid = hasGtin && r.gtin && validateGtin(r.gtin) ? r.gtin : null;
      if (valid) supplierGtinRows += 1;
      else if (!hasGtin) missingGtinRows += 1;
      else invalidGtinRows += 1;
      const allowThisGtin =
        valid &&
        firstByGtin.get(valid) === r.supplierVariantId &&
        !usedGtins.has(valid);
      const finalGtin = allowThisGtin ? valid : null;
      const sizeNormalized = normalizeSize(r.sizeRaw ?? null) ?? r.sizeRaw ?? null;

      return {
        supplierVariantId: r.supplierVariantId,
        supplierSku: r.supplierSku,
        providerKey: finalGtin ? buildProviderKey(finalGtin, r.supplierVariantId) : null,
        // Only write supplier GTIN when valid and non-conflicting; never clear.
        gtin: finalGtin,
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
    for (const row of supplierRows) {
      assertMappingIntegrity({
        supplierVariantId: row.supplierVariantId,
        gtin: row.gtin ?? null,
        providerKey: row.providerKey ?? null,
        status: row.gtin ? "SUPPLIER_GTIN" : "PENDING_GTIN",
      });
    }

    created += await bulkInsertSupplierVariants(supplierRows, now);
    updated += await bulkUpdateSupplierVariants(supplierRows, now, { updateGtinWhenProvided: true });

    const mappingRows = batch.map((r) => {
      const gtinRaw = r.gtin ?? null;
      const valid = gtinRaw && validateGtin(gtinRaw) ? gtinRaw : null;
      const payload = {
        supplierVariantId: r.supplierVariantId,
        gtin: valid,
        providerKey: valid ? buildProviderKey(valid, r.supplierVariantId) : null,
        status: valid ? "SUPPLIER_GTIN" : "PENDING_GTIN",
      };
      assertMappingIntegrity(payload);
      return payload;
    });

    // Prevent downgrading existing MATCHED mappings to PENDING_GTIN.
    const mappingRes = await bulkUpsertVariantMappings(mappingRows, now, {
      doNotDowngradeFromMatched: true,
      onlySetPendingIfMissing: true,
    });
    insertedMappings += mappingRes.inserted;
    updatedMappings += mappingRes.updated;
  }

  // Throttled enrichment queue (spreads work across runs).
  if (options.enrichMissingGtin !== false) {
    const maxEnrichPerRun = 200;
    const candidates = await prisma.$queryRaw<Array<{ supplierVariantId: string; createdAt: Date }>>(
      Prisma.sql`
          SELECT sv."supplierVariantId", sv."createdAt"
          FROM "public"."SupplierVariant" sv
          LEFT JOIN "public"."VariantMapping" vm
            ON vm."supplierVariantId" = sv."supplierVariantId"
          WHERE sv."supplierVariantId" LIKE 'trm:%'
            AND sv."gtin" IS NULL
            AND (vm."gtin" IS NULL OR vm."status" IN ('PENDING_GTIN','AMBIGUOUS_GTIN','NOT_FOUND'))
          ORDER BY sv."createdAt" DESC, sv."updatedAt" DESC
          LIMIT ${maxEnrichPerRun}
        `
    );

    const enrichLimit = createLimiter(3);
    const tasks = candidates.map((c) =>
      enrichLimit(async () => {
        try {
          const isNew = c.createdAt && Date.now() - new Date(c.createdAt).getTime() < 2 * 24 * 60 * 60 * 1000;
          const { results } = await runKickdbEnrich({
            supplierVariantId: c.supplierVariantId,
            force: isNew,
          });
          enrichedRows += results.length;
        } catch {
          enrichErrors += 1;
        }
      })
    );
    await Promise.all(tasks);
  }

  const removeResult = await removeMissingTrmVariants({
    fetchedIds: flattened.map((row) => row.supplierVariantId),
    allowDelete: isFullRun,
  });

  const durationMs = Date.now() - startedAt;
  console.info("[galaxus][sync:trm] done", {
    fetchedProducts: products.length,
    processed: rows.length,
    insertedCount: created,
    updatedCount: updated,
    removedMissing: removeResult.removed,
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

export async function runTrmStockSync(options: TrmSyncOptions = {}): Promise<TrmSyncResult> {
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
  let updated = 0;
  for (const batch of chunkArray(rows, 500)) {
    updated += await bulkUpdateSupplierVariants(batch, now, { updateGtinWhenProvided: false });
  }

  const removeResult = await removeMissingTrmVariants({
    fetchedIds: flattened.map((row) => row.supplierVariantId),
    allowDelete: isFullRun,
  });

  const durationMs = Date.now() - startedAt;
  console.info("[galaxus][sync:trm-stock-only] done", {
    fetchedCount: flattened.length,
    processed: rows.length,
    updatedCount: updated,
    removedMissing: removeResult.removed,
    removeSkipped: removeResult.skipped,
    durationMs,
  });

  return {
    processed: rows.length,
    created: 0,
    updated,
    supplierGtinRows: 0,
    missingGtinRows: 0,
    invalidGtinRows: 0,
    enrichedRows: 0,
    enrichErrors: 0,
    insertedMappings: 0,
    updatedMappings: 0,
    durationMs,
  };
}

