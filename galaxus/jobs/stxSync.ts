import { prisma } from "@/app/lib/prisma";
import { validateGtin } from "@/app/lib/normalize";
import { fetchStockxProductByIdOrSlugRaw, extractVariantGtin } from "@/galaxus/kickdb/client";
import { assertMappingIntegrity, buildProviderKey } from "@/galaxus/supplier/providerKey";
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

async function removeMissingOrIneligibleStxVariants(activeSupplierVariantIds: string[]) {
  if (activeSupplierVariantIds.length === 0) {
    const removed = await prisma.supplierVariant.deleteMany({
      where: { supplierVariantId: { startsWith: STX_PREFIX } },
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
      where: { supplierVariantId: { in: batch } },
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
    select: { kickdbProductId: true },
    where: { notFound: false },
    orderBy: { updatedAt: "desc" },
    ...(limitProducts ? { take: limitProducts } : {}),
  });

  const limit = createLimiter(concurrency);
  let processedProducts = 0;
  let processedVariants = 0;
  const parsedRows: Array<{
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
  }> = [];

  await Promise.all(
    products.map((row: any) =>
      limit(async () => {
        const productId = String(row?.kickdbProductId ?? "").trim();
        if (!productId) return;
        let payload: any;
        try {
          const res = await fetchStockxProductByIdOrSlugRaw(productId);
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
          pickString(payload?.sku, payload?.model, payload?.slug, payload?.id) ?? `${STX_PREFIX}${productId}`;

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
          const stxSellPrice = Math.round((stxBasePrice * 1.08 + shippingCHF) * 100) / 100;
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

