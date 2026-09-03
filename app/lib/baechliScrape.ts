import { prisma } from "@/app/lib/prisma";
import { normalizeSize } from "@/app/lib/normalize";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
import type { ScraperShop } from "@/app/lib/scraperShops";
import { BaechliClient, baechliConfig, type BaechliProduct, type BaechliVariant } from "@/app/lib/baechliClient";
import {
  computeBaechliLandedCost,
  isPlausibleBaechliSellPrice,
  type BaechliLandedCost,
} from "@/app/lib/baechliPricing";
import { startRun, hasRunningRun, recoverStaleRuns } from "@/app/lib/scraperRun";
import { scraperQuery } from "@/app/lib/scraperDb";

export { startRun, hasRunningRun, recoverStaleRuns };

const IMAGE_SYNC_CONCURRENCY = 5;
const IMAGE_SYNC_BATCH = 200;

function deferBaechliImageSync(): boolean {
  return String(process.env.SCRAPER_BAE_DEFER_IMAGE_SYNC ?? "1") !== "0";
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
  await scraperQuery(`UPDATE scraper.scrape_runs SET ${sets} WHERE id = $1`, [runId, ...keys.map((k) => fields[k])]);
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

function formatBaechliNote(input: {
  product: BaechliProduct;
  variant: BaechliVariant;
  gtinSource: string;
  overlapSuppliers: string[];
  cost: BaechliLandedCost;
}) {
  return JSON.stringify({
    type: "baechli_landed_cost",
    productUrl: input.product.productUrl,
    supplierSku: input.variant.sku,
    gtinSource: input.gtinSource,
    sizeLabel: input.variant.sizeLabel,
    overlapSuppliers: input.overlapSuppliers,
    stockSource: "schema_org_availability",
    buyPriceSource: "baechli_html",
    ...input.cost,
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
      await worker(items[i]);
    }
  });
  await Promise.all(runners);
}

/** Bächli Bergsport (Rent-a-Shop) HTML + JSON-LD scrape. Gated from Galaxus unless allowlisted. */
export async function scrapeBaechliShop(
  shop: ScraperShop,
  runId: number,
  maxProducts?: number
): Promise<void> {
  const prismaAny = prisma as any;
  const cfg = baechliConfig();
  const client = new BaechliClient(shop.baseUrl);

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

  const upsertVariant = async (input: {
    gtin: string;
    gtinSource: string;
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
    const queueImage = !deferBaechliImageSync() && needsImageHosting(existing, input.imageUrl);
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

  try {
    const productUrls = await client.listDeProductUrls(maxProducts);
    listed = productUrls.length;

    await updateRun(runId, {
      products_listed: listed,
      message: `source=baechli-rent-a-shop listed=${listed} fetching…`,
    });

    await runPool(productUrls, cfg.productConcurrency, async (productUrl) => {
      if (maxProducts && processed >= maxProducts) return;
      processed++;
      try {
        const product = await client.fetchProduct(productUrl);
        if (!product) return;

        for (const variant of product.variants) {
          if (!variant.gtin || !variant.gtinSource) {
            skippedNoGtin++;
            continue;
          }
          const buyChf = variant.priceChf;
          if (!buyChf || buyChf <= 0) {
            skippedNoPrice++;
            continue;
          }

          const cost = computeBaechliLandedCost(buyChf);
          if (!cost || !isPlausibleBaechliSellPrice(cost)) {
            skippedNoPrice++;
            continue;
          }

          const title = variant.sizeLabel ? `${product.name} — ${variant.sizeLabel}` : product.name;
          const stock = variant.inStock ? cfg.defaultStock : 0;
          const ok = await upsertVariant({
            gtin: variant.gtin,
            gtinSource: variant.gtinSource,
            supplierSku: variant.sku,
            price: cost.sellPriceChf,
            stock,
            brand: product.brand,
            name: title,
            productType: product.productType,
            sizeRaw: variant.sizeLabel,
            imageUrl: variant.imageUrl,
            manualNote: formatBaechliNote({
              product,
              variant,
              gtinSource: variant.gtinSource,
              overlapSuppliers: [],
              cost,
            }),
          });
          if (ok) {
            wrote++;
            gtinMatched++;
          }
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
            "source=baechli-rent-a-shop",
            `listed=${listed}`,
            `processed=${processed}`,
            `wrote=${wrote}`,
            `skipped_no_gtin=${skippedNoGtin}`,
            `skipped_no_price=${skippedNoPrice}`,
          ].join(" "),
        });
      }

      if (!deferBaechliImageSync() && imageSyncQueue.size >= IMAGE_SYNC_BATCH) {
        const img = await flushImageSyncQueue(imageSyncQueue);
        imageSynced += img.synced;
        imageFailed += img.failed;
      }
    });

    if (!deferBaechliImageSync()) {
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
        "source=baechli-rent-a-shop",
        `listed=${listed}`,
        `processed=${processed}`,
        `wrote=${wrote}`,
        `skipped_no_gtin=${skippedNoGtin}`,
        `skipped_no_price=${skippedNoPrice}`,
        deferBaechliImageSync() ? "image_sync=deferred" : `images_synced=${imageSynced}`,
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
