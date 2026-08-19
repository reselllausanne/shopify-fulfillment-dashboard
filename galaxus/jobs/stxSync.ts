import { prisma } from "@/app/lib/prisma";
import { validateGtin } from "@/app/lib/normalize";
import { fetchStockxProductByIdOrSlugRaw, extractVariantGtin, extractVariantEan } from "@/galaxus/kickdb/client";
import { assertMappingIntegrity, buildProviderKey } from "@/galaxus/supplier/providerKey";
import { listForceImportStxSupplierVariantIds } from "@/galaxus/stx/forceImportSlugs";
import { type StxDeliveryType } from "@/galaxus/stx/offerSelection";
import {
  allowsStxStandardImport,
  buildStxDualPriceFields,
} from "@/galaxus/stx/variantPriceLanes";
import {
  syncShopifyStxPricesForGtins,
  syncShopifyStxPricesForSupplierVariantIds,
} from "@/shopify/stx/syncShopifyStxPrices";
import {
  bulkInsertSupplierVariants,
  bulkUpdateSupplierVariants,
  bulkUpsertVariantMappings,
  chunkArray,
  createLimiter,
  remapRowsToExistingProviderKeyGtin,
} from "@/galaxus/jobs/bulkSql";

type StxSyncResult = {
  processedProducts: number;
  processedVariants: number;
  created: number;
  updated: number;
  mappingInserted: number;
  mappingUpdated: number;
  removedMissingOrIneligible: number;
  /** STX variants set to stock 0 because they no longer appear in the eligible refresh batch (price refresh only). */
  stockZeroed?: number;
  durationMs: number;
};

type StxSyncOptions = {
  limitProducts?: number;
  concurrency?: number;
};

type SelectedOffer = {
  deliveryType: StxDeliveryType;
  price: number;
  asks: number;
};

type ParsedStxRow = {
  supplierVariantId: string;
  supplierSku: string;
  providerKey: string | null;
  gtin: string | null;
  price: number;
  stock: number;
  sizeRaw: string | null;
  sizeNormalized?: string | null;
  supplierBrand: string | null;
  supplierProductName: string | null;
  images: unknown;
  leadTimeDays: number | null;
  deliveryType: StxDeliveryType;
  suggestedRetailPriceInclVat: number | null;
  standardBuyPrice: number | null;
  expressBuyPrice: number | null;
  standardSuggestedRetailPriceInclVat: number | null;
};

const STX_PREFIX = "stx_";

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * KickDB `GET /stockx/products/:id` accepts UUID or slug. Prefer `urlKey` (slug) when present — in practice
 * the slug path can return fresher CHF asks than the UUID for the same product.
 */
export function kickdbStockxFetchId(row: { kickdbProductId: string; urlKey?: string | null }): string {
  const slug = String(row?.urlKey ?? "").trim();
  if (slug.length > 0) return slug;
  return String(row?.kickdbProductId ?? "").trim();
}

function pickSizeRawEuFirst(variant: any): string | null {
  const directEu = pickString(variant?.size_eu);
  if (directEu) return directEu;
  const sizes = Array.isArray(variant?.sizes) ? variant.sizes : [];
  for (const entry of sizes) {
    const type = String(entry?.type ?? "").toLowerCase();
    if (type === "eu") {
      const size = pickString(entry?.size);
      if (size) return size;
    }
  }
  return pickString(variant?.size);
}

function pickImages(product: any): string[] | null {
  const images: string[] = [];
  if (Array.isArray(product?.gallery)) {
    for (const image of product.gallery) {
      const value = pickString(image);
      if (value) images.push(value);
    }
  }
  const fallback = pickString(product?.image);
  if (images.length === 0 && fallback) images.push(fallback);
  return images.length > 0 ? Array.from(new Set(images)) : null;
}

function stxVariantSyncPatch(row: ParsedStxRow) {
  return {
    supplierVariantId: row.supplierVariantId,
    price: row.price,
    stock: row.stock,
    deliveryType: row.deliveryType,
    suggestedRetailPriceInclVat: row.suggestedRetailPriceInclVat,
    standardBuyPrice: row.standardBuyPrice,
    expressBuyPrice: row.expressBuyPrice,
    standardSuggestedRetailPriceInclVat: row.standardSuggestedRetailPriceInclVat,
  };
}

function extractRowsFromPayload(payload: any, productId: string) {
  const rows: ParsedStxRow[] = [];
  const variants = Array.isArray(payload?.variants) ? payload.variants : [];
  const supplierBrand = pickString(payload?.brand);
  const supplierProductName = pickString(payload?.title, payload?.primary_title, payload?.secondary_title);
  const images = pickImages(payload);
  const supplierSkuFallback =
    pickString(payload?.sku, payload?.model, payload?.slug, payload?.id) ?? `${STX_PREFIX}${productId}`;
  const forceImport = allowsStxStandardImport(payload);

  for (const variant of variants) {
    const variantId = pickString(variant?.id);
    if (!variantId) continue;

    const gtinRaw = pickString(extractVariantGtin(variant));
    const gtin = gtinRaw && validateGtin(gtinRaw) ? gtinRaw : null;
    if (!gtin) continue;

    const lanes = buildStxDualPriceFields(variant, payload, supplierProductName, {
      forceImport,
      slug: pickString(payload?.slug, payload?.url_key, payload?.urlKey),
    });
    if (!lanes) continue;

    const supplierVariantId = `${STX_PREFIX}${variantId}`;
    const providerKey = buildProviderKey(gtin, supplierVariantId);
    if (!providerKey) continue;

    rows.push({
      supplierVariantId,
      supplierSku: supplierSkuFallback,
      providerKey,
      gtin,
      price: lanes.price,
      stock: lanes.stock,
      sizeRaw: pickSizeRawEuFirst(variant),
      supplierBrand,
      supplierProductName,
      images,
      leadTimeDays: null,
      deliveryType: lanes.deliveryType,
      suggestedRetailPriceInclVat: lanes.suggestedRetailPriceInclVat,
      standardBuyPrice: lanes.standardBuyPrice,
      expressBuyPrice: lanes.expressBuyPrice,
      standardSuggestedRetailPriceInclVat: lanes.standardSuggestedRetailPriceInclVat,
    });
  }
  return rows;
}

/**
 * Supplier STX rows linked to this KickDB product (via VariantMapping → KickDBVariant).
 */
async function listStxSupplierVariantIdsForKickdbProductId(kickdbProductId: string): Promise<string[]> {
  const id = String(kickdbProductId ?? "").trim();
  if (!id) return [];
  const rows = await prisma.$queryRaw<Array<{ supplierVariantId: string }>>`
    SELECT sv."supplierVariantId"
    FROM "public"."SupplierVariant" sv
    INNER JOIN "public"."VariantMapping" vm ON vm."supplierVariantId" = sv."supplierVariantId"
    INNER JOIN "public"."KickDBVariant" kv ON kv.id = vm."kickdbVariantId"
    INNER JOIN "public"."KickDBProduct" kp ON kp.id = kv."productId"
    WHERE kp."kickdbProductId" = ${id}
      AND sv."supplierVariantId" LIKE ${STX_PREFIX + "%"}
  `;
  return rows.map((r) => r.supplierVariantId).filter(Boolean);
}

/**
 * Price refresh only: variants that stay in DB but are no longer returned as eligible (no express offer, bad GTIN,
 * size removed from StockX payload, etc.) get stock 0 instead of keeping a stale ask count / price-looking state.
 * Does not touch manualLock rows (bulkUpdateSupplierVariants skips them).
 */
async function zeroStockForStxVariantsNotInEligibleBatch(
  kickdbProductId: string,
  eligibleSupplierVariantIds: Set<string>,
  now: Date,
  options?: { skip?: boolean }
): Promise<number> {
  if (options?.skip) return 0;
  const dbIds = await listStxSupplierVariantIdsForKickdbProductId(kickdbProductId);
  const toZero = dbIds.filter((sid) => !eligibleSupplierVariantIds.has(sid));
  if (toZero.length === 0) return 0;
  let n = 0;
  for (const batch of chunkArray(toZero, 500)) {
    n += await bulkUpdateSupplierVariants(
      batch.map((supplierVariantId) => ({ supplierVariantId, stock: 0 })),
      now,
      { updateGtinWhenProvided: false }
    );
  }
  return n;
}

/**
 * Zero stock for `stx_{variantId}` rows present in the SSE payload but no longer eligible
 * (no express offer, invalid GTIN, etc.). Works even when VariantMapping is missing.
 */
async function zeroStockForPayloadStxVariantsNotInEligibleBatch(
  payload: any,
  eligibleSupplierVariantIds: Set<string>,
  now: Date,
  options?: { skip?: boolean }
): Promise<number> {
  if (options?.skip) return 0;
  const variants = Array.isArray(payload?.variants) ? payload.variants : [];
  const toZero: string[] = [];
  for (const variant of variants) {
    const variantId = pickString(variant?.id);
    if (!variantId) continue;
    const supplierVariantId = `${STX_PREFIX}${variantId}`;
    if (!eligibleSupplierVariantIds.has(supplierVariantId)) {
      toZero.push(supplierVariantId);
    }
  }
  if (toZero.length === 0) return 0;
  let n = 0;
  for (const batch of chunkArray(toZero, 500)) {
    n += await bulkUpdateSupplierVariants(
      batch.map((supplierVariantId) => ({ supplierVariantId, stock: 0 })),
      now,
      { updateGtinWhenProvided: false }
    );
  }
  return n;
}

/** Parsed row for full ingest — includes identifiers needed to (re)create KickDBVariant links. */
type IngestParsedRow = ParsedStxRow & {
  kickdbVariantExternalId: string;
  sizeUs: string | null;
  sizeEu: string | null;
  ean: string | null;
};

/**
 * Parse every variant that currently has a USABLE StockX ask (express or standard).
 * Unlike `extractRowsFromPayload`, no-GTIN rows are KEPT (stored as PENDING_GTIN). Standard-only
 * rows are stored for Shopify sync; Galaxus/Decathlon export skips them unless LEGO / force-import.
 * Variants with no usable offer are omitted; lost offers are zero-stocked in `ingestStxFromRawPayload`.
 */
function extractOfferedRowsKeepNoGtin(payload: any, productId: string): IngestParsedRow[] {
  const rows: IngestParsedRow[] = [];
  const variants = Array.isArray(payload?.variants) ? payload.variants : [];
  const supplierBrand = pickString(payload?.brand);
  const supplierProductName = pickString(payload?.title, payload?.primary_title, payload?.secondary_title);
  const images = pickImages(payload);
  const supplierSkuFallback =
    pickString(payload?.sku, payload?.model, payload?.slug, payload?.id) ?? `${STX_PREFIX}${productId}`;
  const forceImport = allowsStxStandardImport(payload);

  for (const variant of variants) {
    const variantId = pickString(variant?.id);
    if (!variantId) continue;

    const lanes = buildStxDualPriceFields(variant, payload, supplierProductName, {
      forceImport,
      slug: pickString(payload?.slug, payload?.url_key, payload?.urlKey),
    });
    if (!lanes) continue;

    const gtinRaw = pickString(extractVariantGtin(variant));
    const gtin = gtinRaw && validateGtin(gtinRaw) ? gtinRaw : null;
    const supplierVariantId = `${STX_PREFIX}${variantId}`;
    const providerKey = gtin ? buildProviderKey(gtin, supplierVariantId) : null;

    rows.push({
      supplierVariantId,
      supplierSku: supplierSkuFallback,
      providerKey,
      gtin,
      price: lanes.price,
      stock: lanes.stock,
      sizeRaw: pickSizeRawEuFirst(variant),
      supplierBrand,
      supplierProductName,
      images,
      leadTimeDays: null,
      deliveryType: lanes.deliveryType,
      suggestedRetailPriceInclVat: lanes.suggestedRetailPriceInclVat,
      standardBuyPrice: lanes.standardBuyPrice,
      expressBuyPrice: lanes.expressBuyPrice,
      standardSuggestedRetailPriceInclVat: lanes.standardSuggestedRetailPriceInclVat,
      kickdbVariantExternalId: variantId,
      sizeUs: pickString(variant?.size_us),
      sizeEu: pickString(variant?.size_eu),
      ean: pickString(extractVariantEan(variant)),
    });
  }
  return rows;
}

/**
 * Product delisted on KicksDB (fetch 404). Zero stock on every STX `SupplierVariant` linked to it
 * (price preserved; `manualLock` rows skipped) so the Galaxus feed drops it to out-of-stock.
 */
export async function zeroStxStockForKickdbProduct(kickdbProductId: string): Promise<number> {
  const now = new Date();
  const ids = await listStxSupplierVariantIdsForKickdbProductId(kickdbProductId);
  if (ids.length === 0) return 0;
  let n = 0;
  for (const batch of chunkArray(ids, 500)) {
    n += await bulkUpdateSupplierVariants(
      batch.map((supplierVariantId) => ({ supplierVariantId, stock: 0 })),
      now,
      { updateGtinWhenProvided: false }
    );
  }
  return n;
}

export type StxIngestResult = {
  offeredVariants: number;
  created: number;
  updated: number;
  stockZeroed: number;
  mappingsInserted: number;
  mappingsUpdated: number;
  durationMs: number;
};

/**
 * Marketplace DB bridge (create + maintain) from a raw KicksDB product payload — no extra API call.
 *
 * On every SSE event, `/api/kickdb/upsert` calls this so the Galaxus DB is driven end-to-end by the
 * SSE stream (the manual slug-import page is no longer required):
 *   - CREATE a `SupplierVariant` + `VariantMapping` for every offered variant (GTIN → SUPPLIER_GTIN;
 *     no GTIN → PENDING_GTIN, tracked but auto-excluded from the feed until a GTIN appears).
 *   - MAINTAIN existing rows: refresh price/stock; `manualLock` rows are skipped by the bulk SQL.
 *   - LOST OFFER (asks→0 or size removed from payload): stock set to 0, price preserved
 *     (stock is the single control — 0 ⇒ not offered anywhere; Shopify qty follows via the buffer).
 *
 * Assumes `KickDBVariant` rows for this product were already upserted by the caller (route) so the
 * mapping can attach `kickdbVariantId`.
 */
export async function ingestStxFromRawPayload(
  payload: any,
  kickdbProductId: string,
  options?: { skipZeroStock?: boolean; skipShopifyPriceSync?: boolean }
): Promise<StxIngestResult> {
  const startedAt = Date.now();
  const now = new Date();
  const cleanId = String(kickdbProductId ?? "").trim();
  const empty: StxIngestResult = {
    offeredVariants: 0,
    created: 0,
    updated: 0,
    stockZeroed: 0,
    mappingsInserted: 0,
    mappingsUpdated: 0,
    durationMs: Date.now() - startedAt,
  };
  if (!cleanId) return empty;

  const parsed = extractOfferedRowsKeepNoGtin(payload, cleanId);
  const remappedResult = await remapRowsToExistingProviderKeyGtin(parsed);
  const rows = remappedResult.rows as IngestParsedRow[];
  const eligibleIds = new Set(rows.map((r) => r.supplierVariantId));
  const skipZeroStock =
    options?.skipZeroStock === true ||
    allowsStxStandardImport(payload);

  for (const row of rows) {
    assertMappingIntegrity({
      supplierVariantId: row.supplierVariantId,
      gtin: row.gtin,
      providerKey: row.providerKey,
      status: row.gtin ? "SUPPLIER_GTIN" : "PENDING_GTIN",
    });
  }

  // CREATE missing rows (ON CONFLICT DO NOTHING), then MAINTAIN existing (skips manualLock).
  let created = 0;
  for (const batch of chunkArray(rows, 500)) {
    created += await bulkInsertSupplierVariants(batch, now);
  }
  let updated = 0;
  for (const batch of chunkArray(rows, 500)) {
    updated += await bulkUpdateSupplierVariants(batch, now, { updateGtinWhenProvided: true });
  }

  // LOST OFFER: zero stock (keep price) for rows no longer offered — via mapping and via payload ids.
  const stockZeroedMapped = await zeroStockForStxVariantsNotInEligibleBatch(cleanId, eligibleIds, now, {
    skip: skipZeroStock,
  });
  const stockZeroedPayload = await zeroStockForPayloadStxVariantsNotInEligibleBatch(
    payload,
    eligibleIds,
    now,
    { skip: skipZeroStock }
  );

  // Mappings need the DB `KickDBVariant.id` (route already upserted these rows).
  const externalIds = Array.from(
    new Set(rows.map((r) => r.kickdbVariantExternalId).filter((id): id is string => Boolean(id)))
  );
  const kvRows =
    externalIds.length > 0
      ? await prisma.kickDBVariant.findMany({
          where: { kickdbVariantId: { in: externalIds } },
          select: { id: true, kickdbVariantId: true },
        })
      : [];
  const kvIdByExternal = new Map(kvRows.map((k) => [String(k.kickdbVariantId), k.id]));

  const mappingRows = rows.map((row) => ({
    supplierVariantId: row.supplierVariantId,
    gtin: row.gtin,
    providerKey: row.providerKey,
    status: row.gtin ? "SUPPLIER_GTIN" : "PENDING_GTIN",
    kickdbVariantId: kvIdByExternal.get(row.kickdbVariantExternalId) ?? null,
  }));
  const mappingRes = await bulkUpsertVariantMappings(mappingRows, now, {
    doNotDowngradeFromMatched: true,
    onlySetPendingIfMissing: true,
  });

  const stockZeroed = stockZeroedMapped + stockZeroedPayload;

  const gtins = rows.map((r) => r.gtin).filter((g): g is string => Boolean(g));
  const pendingNoGtinSupplierIds = rows
    .filter((r) => !r.gtin)
    .map((r) => r.supplierVariantId)
    .filter(Boolean);
  const shouldSyncShopify =
    options?.skipShopifyPriceSync !== true &&
    (gtins.length > 0 || pendingNoGtinSupplierIds.length > 0) &&
    (created > 0 || updated > 0);
  if (shouldSyncShopify) {
    try {
      if (gtins.length > 0) {
        await syncShopifyStxPricesForGtins(gtins);
      }
      if (pendingNoGtinSupplierIds.length > 0) {
        await syncShopifyStxPricesForSupplierVariantIds(pendingNoGtinSupplierIds);
      }
    } catch (err) {
      console.warn("[galaxus][ingest:stx-raw-payload] shopify price sync failed", {
        kickdbProductId: cleanId,
        err,
      });
    }
  }

  const durationMs = Date.now() - startedAt;
  if (created > 0 || updated > 0 || stockZeroed > 0 || mappingRes.inserted > 0) {
    console.info("[galaxus][ingest:stx-raw-payload] done", {
      kickdbProductId: cleanId,
      offered: rows.length,
      created,
      updated,
      stockZeroed,
      mappingsInserted: mappingRes.inserted,
      mappingsUpdated: mappingRes.updated,
      remappedToCanonical: remappedResult.remapped,
      durationMs,
    });
  }

  return {
    offeredVariants: rows.length,
    created,
    updated,
    stockZeroed,
    mappingsInserted: mappingRes.inserted,
    mappingsUpdated: mappingRes.updated,
    durationMs,
  };
}

async function removeMissingOrIneligibleStxVariants(activeSupplierVariantIds: string[]) {
  if (activeSupplierVariantIds.length === 0) {
    const removed = await prisma.supplierVariant.deleteMany({
      where: {
        supplierVariantId: { startsWith: STX_PREFIX },
        manualLock: { not: true },
      },
    });
    return removed.count;
  }
  const existing = await prisma.supplierVariant.findMany({
    where: { supplierVariantId: { startsWith: STX_PREFIX } },
    select: { supplierVariantId: true },
  });
  const active = new Set(activeSupplierVariantIds);
  const missing = existing
    .map((row) => row.supplierVariantId)
    .filter((supplierVariantId) => !active.has(supplierVariantId));
  let removed = 0;
  for (const batch of chunkArray(missing, 500)) {
    const result = await prisma.supplierVariant.deleteMany({
      where: {
        supplierVariantId: { in: batch },
        manualLock: { not: true },
      },
    });
    removed += result.count;
  }
  return removed;
}

export async function runStxSync(options: StxSyncOptions = {}): Promise<StxSyncResult> {
  const startedAt = Date.now();
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const limitProducts = options.limitProducts ? Math.max(1, options.limitProducts) : null;
  const now = new Date();

  const products = await (prisma as any).kickDBProduct.findMany({
    select: { kickdbProductId: true, urlKey: true },
    where: { notFound: false },
    orderBy: { updatedAt: "desc" },
    ...(limitProducts ? { take: limitProducts } : {}),
  });

  const limit = createLimiter(concurrency);
  let processedProducts = 0;
  let processedVariants = 0;
  const parsedRows: ParsedStxRow[] = [];

  await Promise.all(
    products.map((row: any) =>
      limit(async () => {
        const dbProductId = String(row?.kickdbProductId ?? "").trim();
        const fetchId = kickdbStockxFetchId(row);
        if (!dbProductId || !fetchId) return;
        let payload: any;
        try {
          const res = await fetchStockxProductByIdOrSlugRaw(fetchId);
          payload = res.product;
        } catch {
          return;
        }
        processedProducts += 1;
        const variants = Array.isArray(payload?.variants) ? payload.variants : [];
        const supplierBrand = pickString(payload?.brand);
        const supplierProductName = pickString(payload?.title, payload?.primary_title, payload?.secondary_title);
        const images = pickImages(payload);
        const supplierSkuFallback =
          pickString(payload?.sku, payload?.model, payload?.slug, payload?.id) ?? `${STX_PREFIX}${dbProductId}`;

        for (const variant of variants) {
          processedVariants += 1;
          const variantId = pickString(variant?.id);
          if (!variantId) continue;

          const gtinRaw = pickString(extractVariantGtin(variant));
          const gtin = gtinRaw && validateGtin(gtinRaw) ? gtinRaw : null;
          if (!gtin) continue;

          const forceImport = allowsStxStandardImport(
            payload,
            pickString(payload?.slug, payload?.url_key, payload?.urlKey, row?.urlKey)
          );
          const lanes = buildStxDualPriceFields(variant, payload, supplierProductName, {
            forceImport,
            slug: pickString(payload?.slug, payload?.url_key, payload?.urlKey, row?.urlKey),
          });
          if (!lanes) continue;

          const supplierVariantId = `${STX_PREFIX}${variantId}`;
          const providerKey = buildProviderKey(gtin, supplierVariantId);
          if (!providerKey) continue;

          parsedRows.push({
            supplierVariantId,
            supplierSku: supplierSkuFallback,
            providerKey,
            gtin,
            price: lanes.price,
            stock: lanes.stock,
            sizeRaw: pickSizeRawEuFirst(variant),
            supplierBrand,
            supplierProductName,
            images,
            leadTimeDays: null,
            deliveryType: lanes.deliveryType,
            suggestedRetailPriceInclVat: lanes.suggestedRetailPriceInclVat,
            standardBuyPrice: lanes.standardBuyPrice,
            expressBuyPrice: lanes.expressBuyPrice,
            standardSuggestedRetailPriceInclVat: lanes.standardSuggestedRetailPriceInclVat,
          });
        }
      })
    )
  );

  const dedupBySupplierVariantId = new Map<string, (typeof parsedRows)[number]>();
  for (const row of parsedRows) {
    dedupBySupplierVariantId.set(row.supplierVariantId, row);
  }
  const remappedRowsResult = await remapRowsToExistingProviderKeyGtin(Array.from(dedupBySupplierVariantId.values()));
  const rows = remappedRowsResult.rows;

  for (const row of rows) {
    assertMappingIntegrity({
      supplierVariantId: row.supplierVariantId,
      gtin: row.gtin,
      providerKey: row.providerKey,
      status: "SUPPLIER_GTIN",
    });
  }

  let created = 0;
  let updated = 0;
  for (const batch of chunkArray(rows, 500)) {
    created += await bulkInsertSupplierVariants(batch, now);
  }
  for (const batch of chunkArray(rows, 500)) {
    updated += await bulkUpdateSupplierVariants(batch, now, { updateGtinWhenProvided: true });
  }

  const mappingRows = rows.map((row) => ({
    supplierVariantId: row.supplierVariantId,
    gtin: row.gtin,
    providerKey: row.providerKey,
    status: "SUPPLIER_GTIN",
  }));
  let mappingInserted = 0;
  let mappingUpdated = 0;
  for (const batch of chunkArray(mappingRows, 500)) {
    const result = await bulkUpsertVariantMappings(batch, now, {
      doNotDowngradeFromMatched: true,
      onlySetPendingIfMissing: true,
    });
    mappingInserted += result.inserted;
    mappingUpdated += result.updated;
  }

  const forceProtectedIds = await listForceImportStxSupplierVariantIds();
  const activeSupplierVariantIds = new Set([
    ...rows.map((row) => row.supplierVariantId),
    ...forceProtectedIds,
  ]);
  const removedMissingOrIneligible = await removeMissingOrIneligibleStxVariants([
    ...activeSupplierVariantIds,
  ]);

  const durationMs = Date.now() - startedAt;
  console.info("[galaxus][sync:stx] done", {
    productsSeen: products.length,
    processedProducts,
    processedVariants,
    eligibleRows: rows.length,
    insertedCount: created,
    updatedCount: updated,
    mappingInserted,
    mappingUpdated,
    remappedToExistingGtinRow: remappedRowsResult.remapped,
    removedMissingOrIneligible,
    durationMs,
  });

  return {
    processedProducts,
    processedVariants,
    created,
    updated,
    mappingInserted,
    mappingUpdated,
    removedMissingOrIneligible,
    durationMs,
  };
}

export async function runStxPriceStockRefresh(options: StxSyncOptions = {}): Promise<StxSyncResult> {
  const startedAt = Date.now();
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const limitProducts = options.limitProducts ? Math.max(1, options.limitProducts) : null;
  const now = new Date();

  const products = await (prisma as any).kickDBProduct.findMany({
    select: { kickdbProductId: true, urlKey: true },
    where: { notFound: false },
    orderBy: { updatedAt: "desc" },
    ...(limitProducts ? { take: limitProducts } : {}),
  });

  const limit = createLimiter(concurrency);
  const parsedRows: ParsedStxRow[] = [];

  const chunks = await Promise.all(
    products.map((row: any) =>
      limit(async (): Promise<{
        processedProducts: number;
        processedVariants: number;
        rows: ParsedStxRow[];
        stockZeroed: number;
        remapped: number;
      }> => {
        const dbProductId = String(row?.kickdbProductId ?? "").trim();
        const fetchId = kickdbStockxFetchId(row);
        if (!dbProductId || !fetchId) {
          return { processedProducts: 0, processedVariants: 0, rows: [], stockZeroed: 0, remapped: 0 };
        }
        let payload: any;
        try {
          const res = await fetchStockxProductByIdOrSlugRaw(fetchId);
          payload = res.product;
        } catch {
          return { processedProducts: 0, processedVariants: 0, rows: [], stockZeroed: 0, remapped: 0 };
        }
        const extracted = extractRowsFromPayload(payload, dbProductId);
        const remappedResult = await remapRowsToExistingProviderKeyGtin(extracted);
        const rows = remappedResult.rows;
        const eligibleIds = new Set(rows.map((r) => r.supplierVariantId));
        const skipZeroStock = allowsStxStandardImport(
          payload,
          pickString(payload?.slug, payload?.url_key, payload?.urlKey, row?.urlKey)
        );
        const stockZeroed = await zeroStockForStxVariantsNotInEligibleBatch(
          dbProductId,
          eligibleIds,
          now,
          { skip: skipZeroStock }
        );
        return {
          processedProducts: 1,
          processedVariants: rows.length,
          rows,
          stockZeroed,
          remapped: remappedResult.remapped,
        };
      })
    )
  );

  let processedProducts = 0;
  let processedVariants = 0;
  let stockZeroed = 0;
  let remappedToCanonical = 0;
  for (const c of chunks) {
    processedProducts += c.processedProducts;
    processedVariants += c.processedVariants;
    stockZeroed += c.stockZeroed;
    remappedToCanonical += c.remapped;
    parsedRows.push(...c.rows);
  }

  const dedupBySupplierVariantId = new Map<string, ParsedStxRow>();
  for (const row of parsedRows) {
    dedupBySupplierVariantId.set(row.supplierVariantId, row);
  }
  const rows = Array.from(dedupBySupplierVariantId.values());

  // Nightly lightweight refresh: update only price/stock/deliveryType for existing STX variants.
  let updated = 0;
  for (const batch of chunkArray(rows, 500)) {
    updated += await bulkUpdateSupplierVariants(
      batch.map(stxVariantSyncPatch),
      now,
      { updateGtinWhenProvided: false }
    );
  }

  const durationMs = Date.now() - startedAt;
  console.info("[galaxus][sync:stx-price-stock] done", {
    productsSeen: products.length,
    processedProducts,
    processedVariants,
    eligibleRows: rows.length,
    insertedCount: 0,
    updatedCount: updated,
    mappingInserted: 0,
    mappingUpdated: 0,
    removedMissingOrIneligible: 0,
    stockZeroed,
    remappedToCanonical,
    durationMs,
  });

  return {
    processedProducts,
    processedVariants,
    created: 0,
    updated,
    mappingInserted: 0,
    mappingUpdated: 0,
    removedMissingOrIneligible: 0,
    stockZeroed,
    durationMs,
  };
}

/**
 * Same as one product in `runStxPriceStockRefresh`, but keyed by StockX slug / `urlKey`.
 * Resolves `KickDBProduct` in DB so `zeroStockForStxVariantsNotInEligibleBatch` uses the real `kickdbProductId`
 * while `fetchStockxProductByIdOrSlugRaw` still prefers `urlKey` when stored (slug vs UUID freshness).
 */
export async function refreshStxProductByUrlKey(urlKey: string): Promise<StxSyncResult> {
  const slug = String(urlKey ?? "").trim();
  if (!slug) {
    throw new Error("refreshStxProductByUrlKey: empty urlKey");
  }
  const startedAt = Date.now();
  const now = new Date();

  const row = await prisma.kickDBProduct.findFirst({
    where: {
      OR: [{ urlKey: slug }, { kickdbProductId: slug }],
      notFound: false,
    },
    select: { kickdbProductId: true, urlKey: true },
  });

  const dbProductId = row ? String(row.kickdbProductId ?? "").trim() : "";
  const fetchId = row ? kickdbStockxFetchId(row) : slug;

  console.info("[galaxus][sync:stx-urlkey] start", {
    urlKey: slug,
    dbMatched: Boolean(row),
    kickdbProductId: row?.kickdbProductId ?? null,
    fetchId,
  });

  let payload: any;
  try {
    const res = await fetchStockxProductByIdOrSlugRaw(fetchId);
    payload = res.product;
  } catch (err) {
    console.warn("[galaxus][sync:stx-urlkey] fetch failed", { fetchId, err });
    return {
      processedProducts: 0,
      processedVariants: 0,
      created: 0,
      updated: 0,
      mappingInserted: 0,
      mappingUpdated: 0,
      removedMissingOrIneligible: 0,
      stockZeroed: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  const extracted = extractRowsFromPayload(payload, dbProductId || slug);
  const remappedResult = await remapRowsToExistingProviderKeyGtin(extracted);
  const rows = remappedResult.rows;
  const eligibleIds = new Set(rows.map((r) => r.supplierVariantId));
  const skipZeroStock = allowsStxStandardImport(
    payload,
    pickString(payload?.slug, payload?.url_key, payload?.urlKey, row?.urlKey, slug)
  );
  const stockZeroed =
    dbProductId.length > 0
      ? await zeroStockForStxVariantsNotInEligibleBatch(dbProductId, eligibleIds, now, {
          skip: skipZeroStock,
        })
      : 0;

  let updated = 0;
  for (const batch of chunkArray(rows, 500)) {
    updated += await bulkUpdateSupplierVariants(
      batch.map(stxVariantSyncPatch),
      now,
      { updateGtinWhenProvided: false }
    );
  }

  const gtins = rows.map((r) => r.gtin).filter((g): g is string => Boolean(g));
  if (gtins.length > 0) {
    try {
      const shopifySync = await syncShopifyStxPricesForGtins(gtins);
      console.info("[galaxus][sync:stx-urlkey] shopify prices", { urlKey: slug, ...shopifySync });
    } catch (err) {
      console.warn("[galaxus][sync:stx-urlkey] shopify price sync failed", { urlKey: slug, err });
    }
  }

  const durationMs = Date.now() - startedAt;
  console.info("[galaxus][sync:stx-urlkey] done", {
    urlKey: slug,
    processedProducts: 1,
    processedVariants: rows.length,
    eligibleRows: rows.length,
    updated,
    stockZeroed,
    remappedToCanonical: remappedResult.remapped,
    durationMs,
  });

  return {
    processedProducts: 1,
    processedVariants: rows.length,
    created: 0,
    updated,
    mappingInserted: 0,
    mappingUpdated: 0,
    removedMissingOrIneligible: 0,
    stockZeroed,
    durationMs,
  };
}

export async function refreshStxProductsByKickdbProductIds(
  productIds: string[],
  options: { concurrency?: number } = {}
): Promise<StxSyncResult> {
  const startedAt = Date.now();
  const concurrency = Math.max(1, options.concurrency ?? 2);
  const now = new Date();

  const cleanIds = Array.from(
    new Set(productIds.map((id) => String(id ?? "").trim()).filter((id) => id.length > 0))
  );
  const kickRows =
    cleanIds.length === 0
      ? []
      : await prisma.kickDBProduct.findMany({
          where: { kickdbProductId: { in: cleanIds } },
          select: { kickdbProductId: true, urlKey: true },
        });
  const kickRowByExternalId = new Map(
    kickRows.map((p) => [String(p.kickdbProductId ?? "").trim(), p])
  );

  const limit = createLimiter(concurrency);
  const parsedRows: ParsedStxRow[] = [];

  const chunks = await Promise.all(
    productIds.map((productId) =>
      limit(async (): Promise<{
        processedProducts: number;
        processedVariants: number;
        rows: ParsedStxRow[];
        stockZeroed: number;
        remapped: number;
      }> => {
        const cleanId = String(productId ?? "").trim();
        if (!cleanId) {
          return { processedProducts: 0, processedVariants: 0, rows: [], stockZeroed: 0, remapped: 0 };
        }
        const kickRow = kickRowByExternalId.get(cleanId);
        const fetchId = kickRow ? kickdbStockxFetchId(kickRow) : cleanId;
        let payload: any;
        try {
          const res = await fetchStockxProductByIdOrSlugRaw(fetchId);
          payload = res.product;
        } catch {
          return { processedProducts: 0, processedVariants: 0, rows: [], stockZeroed: 0, remapped: 0 };
        }
        const extracted = extractRowsFromPayload(payload, cleanId);
        const remappedResult = await remapRowsToExistingProviderKeyGtin(extracted);
        const rows = remappedResult.rows;
        const eligibleIds = new Set(rows.map((r) => r.supplierVariantId));
        const skipZeroStock = allowsStxStandardImport(
          payload,
          pickString(payload?.slug, payload?.url_key, payload?.urlKey, kickRow?.urlKey)
        );
        const stockZeroed = await zeroStockForStxVariantsNotInEligibleBatch(
          cleanId,
          eligibleIds,
          now,
          { skip: skipZeroStock }
        );
        return {
          processedProducts: 1,
          processedVariants: rows.length,
          rows,
          stockZeroed,
          remapped: remappedResult.remapped,
        };
      })
    )
  );

  let processedProducts = 0;
  let processedVariants = 0;
  let stockZeroed = 0;
  let remappedToCanonical = 0;
  for (const c of chunks) {
    processedProducts += c.processedProducts;
    processedVariants += c.processedVariants;
    stockZeroed += c.stockZeroed;
    remappedToCanonical += c.remapped ?? 0;
    parsedRows.push(...c.rows);
  }

  const dedupBySupplierVariantId = new Map<string, ParsedStxRow>();
  for (const row of parsedRows) {
    dedupBySupplierVariantId.set(row.supplierVariantId, row);
  }
  const rows = Array.from(dedupBySupplierVariantId.values());

  let updated = 0;
  for (const batch of chunkArray(rows, 500)) {
    updated += await bulkUpdateSupplierVariants(
      batch.map(stxVariantSyncPatch),
      now,
      { updateGtinWhenProvided: false }
    );
  }

  const durationMs = Date.now() - startedAt;
  console.info("[galaxus][sync:stx-targeted] done", {
    productsSeen: productIds.length,
    processedProducts,
    processedVariants,
    eligibleRows: rows.length,
    updated,
    stockZeroed,
    remappedToCanonical,
    durationMs,
  });

  return {
    processedProducts,
    processedVariants,
    created: 0,
    updated,
    mappingInserted: 0,
    mappingUpdated: 0,
    removedMissingOrIneligible: 0,
    stockZeroed,
    durationMs,
  };
}

