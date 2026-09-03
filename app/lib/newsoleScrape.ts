import { prisma } from "@/app/lib/prisma";
import { normalizeSize, validateGtin } from "@/app/lib/normalize";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
import { runImageSync } from "@/galaxus/jobs/imageSync";
import {
  extractVariantGtin,
  fetchStockxProductByIdOrSlug,
  matchVariantsBySize,
  searchStockxProducts,
} from "@/galaxus/kickdb/client";
import type { ScraperShop } from "@/app/lib/scraperShops";
import {
  NewsoleClient,
  extractNewsoleSizeLabel,
  inferNewsoleGender,
  newsoleConfig,
  parseNewsoleChfPrice,
  type NewsoleWooProduct,
} from "@/app/lib/newsoleClient";
import { classifyNewsoleGalaxusKind } from "@/app/lib/newsoleGalaxusCategories";
import { startRun, hasRunningRun, recoverStaleRuns } from "@/app/lib/shopifyScrape";
import { scraperQuery } from "@/app/lib/scraperDb";
import { scheduleScraperGalaxusFeedPush } from "@/app/lib/scraperFeedPush";

export { startRun, hasRunningRun, recoverStaleRuns };

const IMAGE_SYNC_CONCURRENCY = 5;
const IMAGE_SYNC_BATCH = 200;

type ExistingVariantImage = {
  sourceImageUrl: string | null;
  hostedImageUrl: string | null;
  imageSyncStatus: string | null;
};

function needsImageHosting(
  existing: ExistingVariantImage | undefined,
  sourceImageUrl: string | null
): boolean {
  if (!sourceImageUrl) return false;
  if (!existing) return true;
  return String(existing.sourceImageUrl ?? "").trim() !== sourceImageUrl.trim();
}

async function updateRun(runId: number, fields: Record<string, unknown>) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  await scraperQuery(`UPDATE scraper.scrape_runs SET ${sets} WHERE id = $1`, [runId, ...keys.map((k) => fields[k])]);
}

async function flushImageSyncQueue(imageSyncQueue: Set<string>) {
  if (!imageSyncQueue.size) return { synced: 0, failed: 0 };
  const batch = [...imageSyncQueue].slice(0, IMAGE_SYNC_BATCH);
  for (const id of batch) imageSyncQueue.delete(id);
  const result = await runImageSync({
    supplierVariantIds: batch,
    limit: batch.length,
    concurrency: IMAGE_SYNC_CONCURRENCY,
  });
  return { synced: result.synced, failed: result.failed };
}

function normalizeGtin(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits || !validateGtin(digits) || /^0+$/.test(digits)) return null;
  return digits;
}

function formatNewsoleNote(input: {
  parentId: number;
  variationId: number;
  styleId: string;
  sizeLabel: string | null;
  galaxusKind: string;
  permalink: string;
  kickdbProductId?: string | null;
}) {
  return JSON.stringify({
    type: "newsole_woo",
    parentId: input.parentId,
    variationId: input.variationId,
    styleId: input.styleId,
    sizeLabel: input.sizeLabel,
    galaxusKind: input.galaxusKind,
    permalink: input.permalink,
    kickdbProductId: input.kickdbProductId ?? null,
    buyPriceSource: "woocommerce_store_api",
    stockSource: "is_in_stock",
  });
}

type KickdbProductCache = Map<string, Awaited<ReturnType<typeof fetchStockxProductByIdOrSlug>> | null>;

async function resolveKickdbProduct(styleId: string, cache: KickdbProductCache) {
  const key = styleId.trim().toUpperCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;
  try {
    const search = await searchStockxProducts(key);
    const hit =
      search.data?.find((p) => String(p.sku ?? "").trim().toUpperCase() === key) ?? search.data?.[0] ?? null;
    const idOrSlug = hit?.id ?? hit?.slug ?? key;
    const product = await fetchStockxProductByIdOrSlug(String(idOrSlug));
    cache.set(key, product);
    return product;
  } catch {
    cache.set(key, null);
    return null;
  }
}

function gtinForSize(
  kickdbProduct: Awaited<ReturnType<typeof fetchStockxProductByIdOrSlug>> | null,
  sizeLabel: string | null,
  brand: string | null,
  gender: string | null
): string | null {
  if (!kickdbProduct?.variants?.length) return null;
  const matches = matchVariantsBySize(kickdbProduct.variants, sizeLabel, { brand, gender });
  for (const variant of matches) {
    const gtin = normalizeGtin(extractVariantGtin(variant));
    if (gtin) return gtin;
  }
  return null;
}

async function runVariationPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let idx = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
    for (;;) {
      const i = idx++;
      if (i >= items.length) break;
      await worker(items[i]);
    }
  });
  await Promise.all(runners);
}

/** Newsole WooCommerce store API + KickDB GTIN resolution per size. */
export async function scrapeNewsoleShop(
  shop: ScraperShop,
  runId: number,
  maxProducts?: number
): Promise<void> {
  const prismaAny = prisma as any;
  const cfg = newsoleConfig();
  const client = new NewsoleClient(shop.baseUrl);
  const kickdbCache: KickdbProductCache = new Map();

  let processedParents = 0;
  let listedVariants = 0;
  let wrote = 0;
  let gtinMatched = 0;
  let skippedNoGtin = 0;
  let skippedNoPrice = 0;
  let skippedUnmapped = 0;
  let requestErrors = 0;
  let imageSynced = 0;
  let imageFailed = 0;
  const seenGtins = new Set<string>();
  const imageSyncQueue = new Set<string>();

  const existingRows = (await prismaAny.supplierVariant.findMany({
    where: { supplierVariantId: { startsWith: `${shop.key}_` } },
    select: {
      supplierVariantId: true,
      sourceImageUrl: true,
      hostedImageUrl: true,
      imageSyncStatus: true,
    },
  })) as Array<ExistingVariantImage & { supplierVariantId: string }>;
  const existingById = new Map(
    existingRows.map((row) => [
      row.supplierVariantId,
      {
        sourceImageUrl: row.sourceImageUrl ?? null,
        hostedImageUrl: row.hostedImageUrl ?? null,
        imageSyncStatus: row.imageSyncStatus ?? null,
      },
    ])
  );

  const upsertVariant = async (input: {
    gtin: string;
    supplierSku: string;
    price: number;
    stock: number;
    brand: string | null;
    name: string;
    productType: string | null;
    sizeRaw: string | null;
    imageUrl: string | null;
    manualNote: string;
  }) => {
    const supplierVariantId = `${shop.key}_${input.gtin}`;
    if (seenGtins.has(input.gtin)) return false;
    seenGtins.add(input.gtin);
    const providerKey = buildProviderKey(input.gtin, supplierVariantId);
    if (!providerKey) return false;

    const existing = existingById.get(supplierVariantId);
    const queueImage = needsImageHosting(existing, input.imageUrl);
    const sizeNormalized = normalizeSize(input.sizeRaw) ?? input.sizeRaw;
    const now = new Date();

    await prismaAny.supplierVariant.upsert({
      where: { supplierVariantId },
      create: {
        supplierVariantId,
        supplierSku: input.supplierSku,
        providerKey,
        gtin: input.gtin,
        price: input.price,
        stock: input.stock,
        sizeRaw: input.sizeRaw,
        sizeNormalized,
        supplierBrand: input.brand,
        supplierProductName: input.name,
        supplierProductType: input.productType,
        sourceImageUrl: input.imageUrl,
        images: input.imageUrl ? [input.imageUrl] : [],
        manualNote: input.manualNote,
        imageSyncStatus: input.imageUrl ? "PENDING" : null,
        lastSyncAt: now,
      },
      update: {
        supplierSku: input.supplierSku,
        providerKey,
        gtin: input.gtin,
        price: input.price,
        stock: input.stock,
        sizeRaw: input.sizeRaw,
        sizeNormalized,
        supplierBrand: input.brand,
        supplierProductName: input.name,
        supplierProductType: input.productType,
        sourceImageUrl: input.imageUrl,
        images: input.imageUrl ? [input.imageUrl] : [],
        manualNote: input.manualNote,
        ...(queueImage
          ? {
              imageSyncStatus: "PENDING",
              imageSyncError: null,
              hostedImageUrl: null,
            }
          : {}),
        lastSyncAt: now,
      },
    });

    await prismaAny.variantMapping.upsert({
      where: { supplierVariantId },
      create: {
        supplierVariantId,
        gtin: input.gtin,
        providerKey,
        supplierKey: shop.key,
        status: "SUPPLIER_GTIN",
      },
      update: {
        gtin: input.gtin,
        providerKey,
        supplierKey: shop.key,
        status: "SUPPLIER_GTIN",
      },
    });

    existingById.set(supplierVariantId, {
      sourceImageUrl: input.imageUrl,
      hostedImageUrl: queueImage ? null : existing?.hostedImageUrl ?? null,
      imageSyncStatus: queueImage ? "PENDING" : existing?.imageSyncStatus ?? null,
    });
    if (queueImage) imageSyncQueue.add(supplierVariantId);
    return true;
  };

  const ingestParent = async (parent: NewsoleWooProduct) => {
    const categoryNames = parent.categories?.map((c) => c.name).filter(Boolean) ?? [];
    const brand = parent.brands?.[0]?.name ?? null;
    const galaxusKind = classifyNewsoleGalaxusKind({
      title: parent.name,
      categories: categoryNames,
      brand,
    });
    if (!galaxusKind) {
      skippedUnmapped++;
      return;
    }

    const styleId = String(parent.sku ?? "").trim();
    if (!styleId) return;

    const gender = inferNewsoleGender(parent.name, categoryNames);
    const kickdbProduct = await resolveKickdbProduct(styleId, kickdbCache);
    const productType = categoryNames.slice(0, 3).join(" > ") || null;
    const imageUrl = parent.images?.[0]?.src ?? null;

    const variationRefs =
      parent.type === "simple"
        ? [{ id: parent.id, attributes: [] as Array<{ name: string; value: string }> }]
        : parent.variations ?? [];

    await runVariationPool(variationRefs, cfg.variationConcurrency, async (ref) => {
      listedVariants++;
      try {
        const variation =
          parent.type === "simple" ? parent : await client.fetchProductById(ref.id);
        const sizeLabel =
          extractNewsoleSizeLabel(variation) ??
          ref.attributes?.find((a) => /size|gr[oö][sß]e|pointure/i.test(a.name))?.value ??
          null;
        const price = parseNewsoleChfPrice(variation.prices);
        if (!price || price <= 0) {
          skippedNoPrice++;
          return;
        }
        const gtin = gtinForSize(kickdbProduct, sizeLabel, brand, gender);
        if (!gtin) {
          skippedNoGtin++;
          return;
        }
        // WooCommerce Store API only exposes is_in_stock bool for Newsole; no real qty.
        // Default 1 to avoid Galaxus back-order overselling; raise via SCRAPER_NER_DEFAULT_STOCK.
        const stock = variation.is_in_stock
          ? Math.max(
              1,
              Number(process.env.SCRAPER_NER_DEFAULT_STOCK || process.env.SCRAPER_DEFAULT_STOCK || 1)
            )
          : 0;
        const title = sizeLabel ? `${parent.name} — ${sizeLabel}` : parent.name;
        const ok = await upsertVariant({
          gtin,
          supplierSku: styleId,
          price,
          stock,
          brand,
          name: title,
          productType,
          sizeRaw: sizeLabel,
          imageUrl,
          manualNote: formatNewsoleNote({
            parentId: parent.id,
            variationId: variation.id,
            styleId,
            sizeLabel,
            galaxusKind,
            permalink: variation.permalink || parent.permalink,
            kickdbProductId: kickdbProduct?.id ?? null,
          }),
        });
        if (ok) {
          wrote++;
          gtinMatched++;
        }
      } catch {
        requestErrors++;
      }

      if (listedVariants % 50 === 0) {
        await updateRun(runId, {
          products_listed: listedVariants,
          with_gtin: gtinMatched,
          variants_upserted: wrote,
          errors: requestErrors,
        });
      }
      if (imageSyncQueue.size >= IMAGE_SYNC_BATCH) {
        const img = await flushImageSyncQueue(imageSyncQueue);
        imageSynced += img.synced;
        imageFailed += img.failed;
      }
    });
  };

  try {
    let catalogTotal = 0;
    for await (const { product, total } of client.iterProducts(maxProducts)) {
      catalogTotal = total;
      processedParents++;
      await ingestParent(product);

      if (processedParents % 10 === 0) {
        await updateRun(runId, {
          products_listed: listedVariants,
          with_gtin: gtinMatched,
          variants_upserted: wrote,
          errors: requestErrors,
          message: `parents=${processedParents}/${catalogTotal} variants=${listedVariants} gtin=${gtinMatched}`,
        });
      }
    }

    while (imageSyncQueue.size > 0) {
      const img = await flushImageSyncQueue(imageSyncQueue);
      imageSynced += img.synced;
      imageFailed += img.failed;
    }

    await scheduleScraperGalaxusFeedPush({ shop, wrote, syncImages: false });

    await updateRun(runId, {
      status: "ok",
      finished_at: new Date(),
      products_listed: listedVariants,
      variants_upserted: wrote,
      with_gtin: gtinMatched,
      errors: requestErrors,
      message: [
        `source=newsole-woo`,
        `parents=${processedParents}`,
        `variants=${listedVariants}`,
        `gtin_rows=${gtinMatched}`,
        `skipped_no_gtin=${skippedNoGtin}`,
        `skipped_no_price=${skippedNoPrice}`,
        `skipped_unmapped=${skippedUnmapped}`,
        `req_errors=${requestErrors}`,
        `images_synced=${imageSynced}`,
        `images_failed=${imageFailed}`,
      ].join(" "),
    });
  } catch (err: any) {
    await updateRun(runId, {
      status: wrote > 0 ? "interrupted" : "error",
      finished_at: new Date(),
      products_listed: listedVariants,
      variants_upserted: wrote,
      with_gtin: gtinMatched,
      errors: requestErrors,
      message: String(err?.message || err).slice(0, 2000),
    });
    throw err;
  }
}
