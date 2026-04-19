import { prisma } from "@/app/lib/prisma";
import { validateGtin } from "@/app/lib/normalize";
import { fetchStockxProductByIdOrSlugRaw, extractVariantGtin } from "@/galaxus/kickdb/client";
import { assertMappingIntegrity, buildProviderKey } from "@/galaxus/supplier/providerKey";
import { estimatedStockxBuyChfFromList } from "@/galaxus/stx/chfStockxBuyPrice";
import { selectStxActiveOffer, type StxDeliveryType } from "@/galaxus/stx/offerSelection";
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
};

const STX_PREFIX = "stx_";

const LEGO_CUSTOM_ADDON_BY_SLUG: Record<string, number> = {
  "lego-pet-shop-set-10218": 45,
  "lego-grand-emporium-set-10211": 25,
};

const LEGO_LARGE_SET_SLUGS = new Set([
  "lego-eiffel-tower-set-10307",
  "lego-titanic-set-10294",
  "lego-palace-cinema-set-10232",
  "lego-marvel-studios-infinity-saga-hulkbuster-set-76210",
]);

const LEGO_MEDIUM_SET_SLUGS = new Set([
  "lego-creator-fairgrounds-mixer-set-10244",
  "lego-stranger-things-the-upside-down-set-75810",
  "lego-tower-bridge-set-10214",
  "lego-technic-land-rover-defender-set-42110",
  "lego-creator-ferris-wheel-2015-set-10247",
  "lego-architecture-taj-mahal-set-21056",
]);

const LEGO_SMALL_SET_SLUGS = new Set([
  "lego-star-wars-tie-fighter-set-75095",
  "lego-creator-horizon-express-set-10233",
  "lego-creator-santas-workshop-set-10245",
]);

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

function normalizeSlug(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function resolveStxShippingCHF(product: any): number {
  const baseShipping = 20;
  const slug = normalizeSlug(product?.slug ?? product?.url_key ?? product?.urlKey);
  const title = normalizeSlug(product?.title ?? product?.primary_title ?? product?.name);
  const isLego = slug.includes("lego") || title.includes("lego");
  if (!isLego) return baseShipping;

  const customAddon = LEGO_CUSTOM_ADDON_BY_SLUG[slug];
  if (Number.isFinite(customAddon)) return baseShipping + customAddon;
  if (LEGO_LARGE_SET_SLUGS.has(slug)) return 60;
  if (LEGO_MEDIUM_SET_SLUGS.has(slug)) return 45;
  if (LEGO_SMALL_SET_SLUGS.has(slug)) return 35;
  return baseShipping;
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

function extractRowsFromPayload(payload: any, productId: string) {
  const rows: ParsedStxRow[] = [];
  const variants = Array.isArray(payload?.variants) ? payload.variants : [];
  const supplierBrand = pickString(payload?.brand);
  const supplierProductName = pickString(payload?.title, payload?.primary_title, payload?.secondary_title);
  const images = pickImages(payload);
  const supplierSkuFallback =
    pickString(payload?.sku, payload?.model, payload?.slug, payload?.id) ?? `${STX_PREFIX}${productId}`;

  for (const variant of variants) {
    const variantId = pickString(variant?.id);
    if (!variantId) continue;

    const gtinRaw = pickString(extractVariantGtin(variant));
    const gtin = gtinRaw && validateGtin(gtinRaw) ? gtinRaw : null;
    if (!gtin) continue;

    const selected = selectStxActiveOffer(variant?.prices);
    if (!selected) continue;

    const supplierVariantId = `${STX_PREFIX}${variantId}`;
    const providerKey = buildProviderKey(gtin, supplierVariantId);
    if (!providerKey) continue;

    const stxBasePrice = Number(selected.price);
    const shippingCHF = resolveStxShippingCHF(payload);
    const stxSellPrice = estimatedStockxBuyChfFromList(stxBasePrice, shippingCHF);
    rows.push({
      supplierVariantId,
      supplierSku: supplierSkuFallback,
      providerKey,
      gtin,
      price: stxSellPrice,
      stock: selected.asks,
      sizeRaw: pickSizeRawEuFirst(variant),
      supplierBrand,
      supplierProductName,
      images,
      leadTimeDays: null,
      deliveryType: selected.deliveryType,
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
  now: Date
): Promise<number> {
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

          const selected = selectStxActiveOffer(variant?.prices);
          if (!selected) continue;

          const supplierVariantId = `${STX_PREFIX}${variantId}`;
          const providerKey = buildProviderKey(gtin, supplierVariantId);
          if (!providerKey) continue;

          const stxBasePrice = Number(selected.price);
          const shippingCHF = resolveStxShippingCHF(payload);
          const stxSellPrice = estimatedStockxBuyChfFromList(stxBasePrice, shippingCHF);
          parsedRows.push({
            supplierVariantId,
            supplierSku: supplierSkuFallback,
            providerKey,
            gtin,
            price: stxSellPrice,
            stock: selected.asks, // raw express stock; export applies guardrail
            sizeRaw: pickSizeRawEuFirst(variant),
            supplierBrand,
            supplierProductName,
            images,
            leadTimeDays: null,
            deliveryType: selected.deliveryType,
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

  const removedMissingOrIneligible = await removeMissingOrIneligibleStxVariants(
    rows.map((row) => row.supplierVariantId)
  );

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
        const stockZeroed = await zeroStockForStxVariantsNotInEligibleBatch(dbProductId, eligibleIds, now);
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
      batch.map((row) => ({
        supplierVariantId: row.supplierVariantId,
        price: row.price,
        stock: row.stock,
        deliveryType: row.deliveryType,
      })),
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
  const stockZeroed =
    dbProductId.length > 0
      ? await zeroStockForStxVariantsNotInEligibleBatch(dbProductId, eligibleIds, now)
      : 0;

  let updated = 0;
  for (const batch of chunkArray(rows, 500)) {
    updated += await bulkUpdateSupplierVariants(
      batch.map((r) => ({
        supplierVariantId: r.supplierVariantId,
        price: r.price,
        stock: r.stock,
        deliveryType: r.deliveryType,
      })),
      now,
      { updateGtinWhenProvided: false }
    );
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
        const stockZeroed = await zeroStockForStxVariantsNotInEligibleBatch(cleanId, eligibleIds, now);
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
      batch.map((row) => ({
        supplierVariantId: row.supplierVariantId,
        price: row.price,
        stock: row.stock,
        deliveryType: row.deliveryType,
      })),
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

