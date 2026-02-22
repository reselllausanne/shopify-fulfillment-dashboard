import { prisma } from "@/app/lib/prisma";
import { validateGtin } from "@/app/lib/normalize";
import { runKickdbEnrich } from "@/galaxus/kickdb/enrichJob";
import { createTrmSupplierClient } from "@/galaxus/supplier/trmClient";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
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
              WHERE "providerKey" = 'TRM'
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

      return {
        supplierVariantId: r.supplierVariantId,
        supplierSku: r.supplierSku,
        providerKey: "TRM",
        // Only write supplier GTIN when valid and non-conflicting; never clear.
        gtin: allowThisGtin ? valid : null,
        price: r.price,
        stock: r.stock,
        sizeRaw: r.sizeRaw,
        supplierBrand: r.supplierBrand,
        supplierProductName: r.supplierProductName,
        images: null,
        leadTimeDays: null,
      };
    });

    created += await bulkInsertSupplierVariants(supplierRows, now);
    updated += await bulkUpdateSupplierVariants(supplierRows, now, { updateGtinWhenProvided: true });

    const mappingRows = batch.map((r) => {
      const gtinRaw = r.gtin ?? null;
      const valid = gtinRaw && validateGtin(gtinRaw) ? gtinRaw : null;
      if (valid) {
        return {
          supplierVariantId: r.supplierVariantId,
          gtin: valid,
          providerKey: buildProviderKey(valid, r.supplierVariantId),
          status: "SUPPLIER_GTIN",
        };
      }
      return {
        supplierVariantId: r.supplierVariantId,
        gtin: gtinRaw, // keep raw for diagnostics; do not clear existing mapping gtin
        providerKey: null,
        status: "PENDING_GTIN",
      };
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

  const durationMs = Date.now() - startedAt;
  console.info("[galaxus][sync:trm] done", {
    fetchedProducts: products.length,
    processed: rows.length,
    insertedCount: created,
    updatedCount: updated,
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

