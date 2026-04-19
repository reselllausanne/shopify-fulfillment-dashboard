import { prisma } from "@/app/lib/prisma";
import { assertMappingIntegrity, buildProviderKey, normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { normalizeSize, normalizeSku, validateGtin } from "@/app/lib/normalize";
import { Prisma } from "@prisma/client";
import {
  bulkInsertSupplierVariantsByProviderKeyGtin,
  bulkUpdateSupplierVariantsByProviderKeyGtin,
  bulkUpsertVariantMappings,
  chunkArray,
} from "@/galaxus/jobs/bulkSql";

type PartnerSyncOptions = {
  limit?: number;
  offset?: number;
};

type PartnerSyncResult = {
  scanned: number;
  processed: number;
  created: number;
  updated: number;
  skippedInvalid: number;
  removedZeroStock: number;
  mappingInserted: number;
  mappingUpdated: number;
  durationMs: number;
};

function buildSupplierVariantId(providerKey: string, sku: string, sizeNormalized: string) {
  const cleanKey = providerKey.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const cleanSku = sku.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  const cleanSize = sizeNormalized.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  return `${cleanKey}:${cleanSku}-${cleanSize}`;
}

export async function runPartnerSync(options: PartnerSyncOptions = {}): Promise<PartnerSyncResult> {
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 2000);
  const offset = Math.max(options.offset ?? 0, 0);
  const startedAt = Date.now();

  const rows = await (prisma as any).partnerUploadRow.findMany({
    where: {
      status: "RESOLVED",
      gtinResolved: { not: null },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    skip: offset,
  });
  const scanned = rows.length;

  let processed = 0;
  let created = 0;
  let updated = 0;
  let skippedInvalid = 0;
  let removedZeroStock = 0;
  let mappingInserted = 0;
  let mappingUpdated = 0;

  const now = new Date();
  const offers: Array<{
    providerKey: string;
    gtin: string;
    supplierVariantId: string;
    supplierSku: string;
    sizeRaw: string;
    sizeNormalized: string;
    stock: number;
    price: number;
  }> = [];
  const zeroStockPairs: Array<{ providerKey: string; gtin: string }> = [];

  for (const row of rows) {
    const supplierCode = normalizeProviderKey(row.providerKey);
    const gtin = validateGtin(row.gtinResolved) ? row.gtinResolved : null;
    if (!supplierCode || !gtin) {
      skippedInvalid += 1;
      continue;
    }
    const sku = normalizeSku(row.sku) ?? row.sku;
    const sizeNormalized = normalizeSize(row.sizeNormalized ?? row.sizeRaw) ?? row.sizeRaw;
    if (!sku || !sizeNormalized) {
      skippedInvalid += 1;
      continue;
    }
    const supplierVariantId = buildSupplierVariantId(supplierCode, sku, sizeNormalized);
    const providerKey = buildProviderKey(gtin, supplierVariantId);
    if (!providerKey) {
      skippedInvalid += 1;
      continue;
    }
    assertMappingIntegrity({
      supplierVariantId,
      gtin,
      providerKey,
      status: "MATCHED",
    });
    const stock = Number(row.rawStock ?? 0);
    const price = Number(row.price ?? 0);
    if (stock <= 0) {
      zeroStockPairs.push({ providerKey, gtin });
      continue;
    }

    offers.push({
      providerKey,
      gtin,
      supplierVariantId,
      supplierSku: sku,
      sizeRaw: row.sizeRaw,
      sizeNormalized,
      stock,
      price,
    });
  }

  processed = offers.length;

  // Hard delete sold-out partner offers (stock <= 0) so they don't leak into Galaxus feeds.
  for (const batch of chunkArray(zeroStockPairs, 500)) {
    const pairs = batch.map((o) => Prisma.sql`(${o.providerKey}, ${o.gtin})`);
    const found = await prisma.$queryRaw<Array<{ supplierVariantId: string }>>(
      Prisma.sql`
        SELECT "supplierVariantId"
        FROM "public"."SupplierVariant"
        WHERE ("providerKey","gtin") IN (${Prisma.join(pairs)})
      `
    );
    const ids = (found ?? []).map((r) => r.supplierVariantId);
    if (ids.length === 0) continue;
    const res = await prisma.supplierVariant.deleteMany({
      where: { supplierVariantId: { in: ids }, manualLock: { not: true } },
    });
    removedZeroStock += res.count;
  }

  for (const batch of chunkArray(offers, 500)) {
    created += await bulkInsertSupplierVariantsByProviderKeyGtin(
      batch.map((o) => ({
        supplierVariantId: o.supplierVariantId,
        supplierSku: o.supplierSku,
        providerKey: o.providerKey,
        gtin: o.gtin,
        price: o.price,
        stock: o.stock,
        sizeRaw: o.sizeRaw,
        sizeNormalized: o.sizeNormalized,
      })),
      now
    );

    updated += await bulkUpdateSupplierVariantsByProviderKeyGtin(
      batch.map((o) => ({
        providerKey: o.providerKey,
        gtin: o.gtin,
        supplierSku: o.supplierSku,
        price: o.price,
        stock: o.stock,
        sizeRaw: o.sizeRaw,
        sizeNormalized: o.sizeNormalized,
      })),
      now
    );
  }

  // Build mappings by resolving the actual supplierVariantId for each (providerKey, gtin).
  for (const batch of chunkArray(offers, 500)) {
    const pairs = batch.map((o) => Prisma.sql`(${o.providerKey}, ${o.gtin})`);
    const found = await prisma.$queryRaw<Array<{ supplierVariantId: string; providerKey: string; gtin: string }>>(
      Prisma.sql`
          SELECT "supplierVariantId", "providerKey", "gtin"
          FROM "public"."SupplierVariant"
          WHERE ("providerKey","gtin") IN (${Prisma.join(pairs)})
        `
    );
    const mappingRows = (found ?? []).map((r) => {
      const providerKey = buildProviderKey(r.gtin, r.supplierVariantId);
      const payload = {
        supplierVariantId: r.supplierVariantId,
        gtin: r.gtin,
        providerKey,
        status: "MATCHED",
      };
      assertMappingIntegrity(payload);
      return payload;
    });
    const res = await bulkUpsertVariantMappings(mappingRows, now, {
      doNotDowngradeFromMatched: true,
      onlySetPendingIfMissing: true,
    });
    mappingInserted += res.inserted;
    mappingUpdated += res.updated;
  }

  const durationMs = Date.now() - startedAt;
  console.info("[galaxus][sync:partner] done", {
    scanned,
    processed,
    insertedCount: created,
    updatedCount: updated,
    skippedInvalid,
    removedZeroStock,
    mappingInserted,
    mappingUpdated,
    durationMs,
  });

  return {
    scanned,
    processed,
    created,
    updated,
    skippedInvalid,
    removedZeroStock,
    mappingInserted,
    mappingUpdated,
    durationMs,
  };
}
