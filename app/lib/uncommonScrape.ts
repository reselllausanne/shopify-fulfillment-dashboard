import { prisma } from "@/app/lib/prisma";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
import type { ScraperShop } from "@/app/lib/scraperShops";
import {
  UncommonClient,
  uncommonConfig,
  resolveUncommonSellable,
  type UncommonProduct,
  type UncommonWooProduct,
} from "@/app/lib/uncommonClient";
import {
  computeUncommonLandedCost,
  isPlausibleUncommonSellPrice,
  type UncommonLandedCost,
} from "@/app/lib/uncommonPricing";
import { startRun, hasRunningRun, recoverStaleRuns } from "@/app/lib/scraperRun";
import { scraperQuery } from "@/app/lib/scraperDb";

export { startRun, hasRunningRun, recoverStaleRuns };

const IMAGE_SYNC_CONCURRENCY = 5;
const IMAGE_SYNC_BATCH = 200;

function deferUncommonImageSync(): boolean {
  return String(process.env.SCRAPER_TUS_DEFER_IMAGE_SYNC ?? "1") !== "0";
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

function formatUncommonNote(product: UncommonProduct, cost: UncommonLandedCost) {
  return JSON.stringify({
    type: "uncommon_woo",
    productUrl: product.productUrl,
    wooId: product.wooId,
    parentId: product.parentId,
    supplierSku: product.sku,
    gtinSource: product.gtinSource,
    stockSource: product.stockSource,
    sellReason: product.sellReason,
    categories: product.categories,
    buyPriceSource: "woocommerce_store_api",
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

/** The Uncommon Shop (WooCommerce Store API). Gated unless allowlisted. */
export async function scrapeUncommonShop(
  shop: ScraperShop,
  runId: number,
  maxProducts?: number
): Promise<void> {
  const prismaAny = prisma as any;
  const cfg = uncommonConfig();
  const client = new UncommonClient(shop.baseUrl);
  const runStartedAt = new Date();

  let listed = 0;
  let processed = 0;
  let wrote = 0;
  let gtinMatched = 0;
  let skippedNoGtin = 0;
  let skippedNoPrice = 0;
  let skippedPreorder = 0;
  let skippedNoStock = 0;
  let skippedGift = 0;
  let requestErrors = 0;
  let imageSynced = 0;
  let imageFailed = 0;
  let zeroedStale = 0;
  const seenGtins = new Set<string>();
  const touchedIds = new Set<string>();
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

  const upsertVariant = async (product: UncommonProduct, cost: UncommonLandedCost) => {
    const supplierVariantId = `${shop.key}_${product.gtin}`;
    if (seenGtins.has(product.gtin)) return false;
    seenGtins.add(product.gtin);
    const providerKey = buildProviderKey(product.gtin, supplierVariantId);
    if (!providerKey) return false;

    const existing = existingById.get(supplierVariantId);
    const queueImage =
      product.sellable && !deferUncommonImageSync() && needsImageHosting(existing, product.imageUrl);
    const now = new Date();
    const manualNote = formatUncommonNote(product, cost);
    const stock = product.sellable ? product.stock : 0;
    const leadTimeDays = product.sellable ? cfg.leadTimeDays : null;

    await prismaAny.supplierVariant.upsert({
      where: { supplierVariantId },
      create: {
        supplierVariantId,
        supplierSku: product.sku,
        providerKey,
        gtin: product.gtin,
        price: cost.sellPriceChf,
        stock,
        leadTimeDays,
        sizeRaw: product.variationLabel,
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
        stock,
        leadTimeDays,
        sizeRaw: product.variationLabel,
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

    touchedIds.add(supplierVariantId);
    existingById.set(supplierVariantId, {
      sourceImageUrl: product.imageUrl,
      hostedImageUrl: queueImage ? null : existing?.hostedImageUrl ?? null,
      imageSyncStatus: queueImage ? "PENDING" : existing?.imageSyncStatus ?? null,
    });
    if (queueImage) imageSyncQueue.add(supplierVariantId);
    return true;
  };

  const handleLeaf = async (leaf: UncommonWooProduct, parentForCats?: UncommonWooProduct) => {
    const merged: UncommonWooProduct = {
      ...leaf,
      categories: leaf.categories?.length ? leaf.categories : parentForCats?.categories || [],
      brands: leaf.brands?.length ? leaf.brands : parentForCats?.brands || [],
      name: leaf.name || parentForCats?.name || "",
    };

    const decision = resolveUncommonSellable(merged);
    if (decision.reason === "gift_card") {
      skippedGift++;
      return;
    }

    // PDP only when sellable, or preorder with fake qty (upsert stock=0 + GTIN).
    // Plain OOS → skip PDP; stale zero at end clears prior rows.
    const needsPdp = decision.sellable || decision.reason === "preorder";
    if (!needsPdp) {
      skippedNoStock++;
      return;
    }
    if (decision.reason === "preorder") skippedPreorder++;

    const product = await client.enrichFromPdp(merged, decision);
    if (!product) {
      skippedNoGtin++;
      return;
    }

    const cost = computeUncommonLandedCost(product.priceChf);
    if (!cost || !isPlausibleUncommonSellPrice(cost)) {
      skippedNoPrice++;
      return;
    }

    const ok = await upsertVariant(product, cost);
    if (ok) {
      wrote++;
      gtinMatched++;
    }
  };

  try {
    const parents: UncommonWooProduct[] = [];
    for await (const { product, total } of client.iterProducts(maxProducts)) {
      if (!listed) {
        listed = total || 0;
        await updateRun(runId, {
          products_listed: listed,
          message: `source=uncommon-woo listed=${listed} fetching…`,
        });
      }
      parents.push(product);
      if (maxProducts && parents.length >= maxProducts) break;
    }
    if (!listed) listed = parents.length;

    await runPool(parents, cfg.productConcurrency, async (parent) => {
      processed++;
      try {
        if (parent.type === "simple") {
          await handleLeaf(parent);
        } else if (parent.type === "variable") {
          const refs = parent.variations || [];
          await runPool(refs, cfg.variationConcurrency, async (ref) => {
            try {
              const variation = await client.fetchProductById(ref.id);
              await handleLeaf(variation, parent);
            } catch (err) {
              requestErrors++;
              console.warn(
                `[SCRAPER] ${shop.key} variation ${ref.id}:`,
                (err as Error)?.message || err
              );
            }
          });
        }
      } catch (err) {
        requestErrors++;
        console.warn(`[SCRAPER] ${shop.key} product ${parent.id}:`, (err as Error)?.message || err);
      }

      if (processed % 50 === 0) {
        await updateRun(runId, {
          products_listed: listed,
          with_gtin: gtinMatched,
          variants_upserted: wrote,
          errors: requestErrors,
          message: [
            "source=uncommon-woo",
            `listed=${listed}`,
            `processed=${processed}/${parents.length}`,
            `wrote=${wrote}`,
            `skipped_no_gtin=${skippedNoGtin}`,
            `skipped_preorder=${skippedPreorder}`,
            `skipped_no_stock=${skippedNoStock}`,
            `skipped_gift=${skippedGift}`,
          ].join(" "),
        });
      }

      if (!deferUncommonImageSync() && imageSyncQueue.size >= IMAGE_SYNC_BATCH) {
        const img = await flushImageSyncQueue(imageSyncQueue);
        imageSynced += img.synced;
        imageFailed += img.failed;
      }
    });

    // Zero stock for rows not touched this run (dropped / OOS without PDP revisit).
    const staleIds = existingRows
      .map((r) => r.supplierVariantId)
      .filter((id) => !touchedIds.has(id));
    if (staleIds.length) {
      const result = await prismaAny.supplierVariant.updateMany({
        where: {
          supplierVariantId: { in: staleIds },
          stock: { gt: 0 },
        },
        data: { stock: 0, leadTimeDays: null, lastSyncAt: runStartedAt },
      });
      zeroedStale = Number(result?.count || 0);
    }

    if (!deferUncommonImageSync()) {
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
        "source=uncommon-woo",
        `listed=${listed}`,
        `processed=${processed}`,
        `wrote=${wrote}`,
        `skipped_no_gtin=${skippedNoGtin}`,
        `skipped_no_price=${skippedNoPrice}`,
        `skipped_preorder=${skippedPreorder}`,
        `skipped_no_stock=${skippedNoStock}`,
        `skipped_gift=${skippedGift}`,
        `zeroed_stale=${zeroedStale}`,
        deferUncommonImageSync() ? "image_sync=deferred" : `images_synced=${imageSynced}`,
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
