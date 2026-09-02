import { prisma } from "@/app/lib/prisma";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
import type { ScraperShop } from "@/app/lib/scraperShops";
import { HawkClient, hawkConfig, type HawkProduct } from "@/app/lib/hawkClient";
import {
  computeHawkLandedCost,
  isPlausibleHawkSellPrice,
  type HawkLandedCost,
} from "@/app/lib/hawkPricing";
import { startRun, hasRunningRun, recoverStaleRuns } from "@/app/lib/scraperRun";
import { scraperQuery } from "@/app/lib/scraperDb";

export { startRun, hasRunningRun, recoverStaleRuns };

const IMAGE_SYNC_CONCURRENCY = 5;
const IMAGE_SYNC_BATCH = 200;

function deferHawkImageSync(): boolean {
  return String(process.env.SCRAPER_HAW_DEFER_IMAGE_SYNC ?? "1") !== "0";
}

type ExistingVariantImage = {
  sourceImageUrl: string | null;
  hostedImageUrl: string | null;
  imageSyncStatus: string | null;
};

async function updateRun(runId: number, fields: Record<string, unknown>) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  await scraperQuery(`UPDATE scraper.scrape_runs SET ${sets} WHERE id = $1`, [
    runId,
    ...keys.map((k) => fields[k]),
  ]);
}

function needsImageHosting(
  existing: ExistingVariantImage | undefined,
  sourceImageUrl: string | null
): boolean {
  if (!sourceImageUrl) return false;
  if (!existing) return true;
  return String(existing.sourceImageUrl ?? "").trim() !== sourceImageUrl.trim();
}

async function flushImageSyncQueue(imageSyncQueue: Set<string>) {
  if (!imageSyncQueue.size) return { synced: 0, failed: 0 };
  const batch = [...imageSyncQueue].slice(0, IMAGE_SYNC_BATCH);
  for (const id of batch) imageSyncQueue.delete(id);
  const { runImageSync } = await import("@/galaxus/jobs/imageSync");
  const result = await runImageSync({
    supplierVariantIds: batch,
    limit: batch.length,
    concurrency: IMAGE_SYNC_CONCURRENCY,
  });
  return { synced: result.synced, failed: result.failed };
}

function formatHawkNote(product: HawkProduct, cost: HawkLandedCost) {
  return JSON.stringify({
    type: "hawk_landed_cost",
    productUrl: product.productUrl,
    supplierSku: product.sku,
    magentoProductId: product.magentoProductId,
    mpn: product.mpn,
    gtinSource: product.gtinSource,
    stockSource: "json_ld_availability+stueck_an_lager",
    buyPriceSource: "hawk_html",
    ...cost,
  });
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let idx = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
    for (;;) {
      const i = idx++;
      if (i >= items.length) break;
      await worker(items[i]!);
    }
  });
  await Promise.all(runners);
}

/** HAWK Electronics (Magento) HTML + JSON-LD scrape. Gated from Galaxus unless allowlisted. */
export async function scrapeHawkShop(
  shop: ScraperShop,
  runId: number,
  maxProducts?: number
): Promise<void> {
  const prismaAny = prisma as any;
  const cfg = hawkConfig();
  const client = new HawkClient(shop.baseUrl);

  let listed = 0;
  let processed = 0;
  let wrote = 0;
  let gtinMatched = 0;
  let skippedNoGtin = 0;
  let skippedNoPrice = 0;
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

  const upsertVariant = async (product: HawkProduct, cost: HawkLandedCost) => {
    const supplierVariantId = `${shop.key}_${product.gtin}`;
    if (seenGtins.has(product.gtin)) return false;
    seenGtins.add(product.gtin);
    const providerKey = buildProviderKey(product.gtin, supplierVariantId);
    if (!providerKey) return false;

    const existing = existingById.get(supplierVariantId);
    const queueImage = !deferHawkImageSync() && needsImageHosting(existing, product.imageUrl);
    const now = new Date();
    const manualNote = formatHawkNote(product, cost);

    await prismaAny.supplierVariant.upsert({
      where: { supplierVariantId },
      create: {
        supplierVariantId,
        supplierSku: product.sku,
        providerKey,
        gtin: product.gtin,
        price: cost.sellPriceChf,
        stock: product.stock,
        sizeRaw: null,
        sizeNormalized: null,
        supplierBrand: product.brand,
        supplierProductName: product.name,
        supplierProductType: product.productType,
        sourceImageUrl: product.imageUrl,
        images: product.imageUrl ? [product.imageUrl] : [],
        manualNote,
        imageSyncStatus: product.imageUrl ? "PENDING" : null,
        lastSyncAt: now,
      },
      update: {
        supplierSku: product.sku,
        providerKey,
        gtin: product.gtin,
        price: cost.sellPriceChf,
        stock: product.stock,
        supplierBrand: product.brand,
        supplierProductName: product.name,
        supplierProductType: product.productType,
        sourceImageUrl: product.imageUrl,
        images: product.imageUrl ? [product.imageUrl] : [],
        manualNote,
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
        gtin: product.gtin,
        providerKey,
        supplierKey: shop.key,
        status: "SUPPLIER_GTIN",
      },
      update: {
        gtin: product.gtin,
        providerKey,
        supplierKey: shop.key,
        status: "SUPPLIER_GTIN",
      },
    });

    existingById.set(supplierVariantId, {
      sourceImageUrl: product.imageUrl,
      hostedImageUrl: queueImage ? null : existing?.hostedImageUrl ?? null,
      imageSyncStatus: queueImage ? "PENDING" : existing?.imageSyncStatus ?? null,
    });
    if (queueImage) imageSyncQueue.add(supplierVariantId);
    return true;
  };

  try {
    const productUrls = await client.listProductUrls(maxProducts);
    listed = productUrls.length;

    await updateRun(runId, {
      products_listed: listed,
      message: `source=hawk-magento listed=${listed} fetching…`,
    });

    await runPool(productUrls, cfg.productConcurrency, async (productUrl) => {
      if (maxProducts && processed >= maxProducts) return;
      processed++;
      try {
        const product = await client.fetchProduct(productUrl);
        if (!product) {
          skippedNoGtin++;
          return;
        }
        if (!product.priceChf || product.priceChf <= 0) {
          skippedNoPrice++;
          return;
        }

        const cost = computeHawkLandedCost(product.priceChf);
        if (!cost || !isPlausibleHawkSellPrice(cost)) {
          skippedNoPrice++;
          return;
        }

        const ok = await upsertVariant(product, cost);
        if (ok) {
          wrote++;
          gtinMatched++;
        }
      } catch (err) {
        requestErrors++;
        console.warn(`[SCRAPER] ${shop.key} product ${productUrl}:`, (err as Error)?.message || err);
      }

      if (processed % 100 === 0) {
        await updateRun(runId, {
          products_listed: listed,
          with_gtin: gtinMatched,
          variants_upserted: wrote,
          errors: requestErrors,
          message: [
            "source=hawk-magento",
            `listed=${listed}`,
            `processed=${processed}`,
            `wrote=${wrote}`,
            `skipped_no_gtin=${skippedNoGtin}`,
            `skipped_no_price=${skippedNoPrice}`,
          ].join(" "),
        });
      }

      if (!deferHawkImageSync() && imageSyncQueue.size >= IMAGE_SYNC_BATCH) {
        const img = await flushImageSyncQueue(imageSyncQueue);
        imageSynced += img.synced;
        imageFailed += img.failed;
      }
    });

    if (!deferHawkImageSync()) {
      while (imageSyncQueue.size > 0) {
        const img = await flushImageSyncQueue(imageSyncQueue);
        imageSynced += img.synced;
        imageFailed += img.failed;
      }
    }

    if (!shop.gated && wrote > 0) {
      const { scheduleScraperGalaxusFeedPush } = await import("@/app/lib/scraperFeedPush");
      await scheduleScraperGalaxusFeedPush({ shop, wrote, syncImages: true });
    }

    await updateRun(runId, {
      status: listed === 0 ? "error" : "ok",
      finished_at: new Date(),
      products_listed: listed,
      variants_upserted: wrote,
      with_gtin: gtinMatched,
      errors: requestErrors,
      message: [
        "source=hawk-magento",
        `listed=${listed}`,
        `processed=${processed}`,
        `wrote=${wrote}`,
        `skipped_no_gtin=${skippedNoGtin}`,
        `skipped_no_price=${skippedNoPrice}`,
        deferHawkImageSync() ? "image_sync=deferred" : `images_synced=${imageSynced}`,
        `images_failed=${imageFailed}`,
      ].join(" "),
    });
  } catch (err: any) {
    await updateRun(runId, {
      status: "error",
      finished_at: new Date(),
      message: String(err?.message || err).slice(0, 2000),
    });
    throw err;
  }
}
