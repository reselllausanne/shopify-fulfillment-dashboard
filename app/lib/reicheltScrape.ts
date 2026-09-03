import { prisma } from "@/app/lib/prisma";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
import { runImageSync } from "@/galaxus/jobs/imageSync";
import type { ScraperShop } from "@/app/lib/scraperShops";
import {
  ReicheltClient,
  extractReicheltCategorySlug,
  reicheltConfig,
  clearReicheltScrapeProgress,
  type ReicheltProduct,
} from "@/app/lib/reicheltClient";
import {
  classifyReicheltGalaxusKind,
  reicheltCategoryPathLabel,
} from "@/app/lib/reicheltGalaxusCategories";
import {
  computeReicheltLandedCost,
  isPlausibleReicheltSellPrice,
  type ReicheltLandedCost,
} from "@/app/lib/reicheltPricing";
import { startRun, hasRunningRun, recoverStaleRuns } from "@/app/lib/scraperRun";
import { scraperQuery } from "@/app/lib/scraperDb";
export { startRun, hasRunningRun, recoverStaleRuns };

const IMAGE_SYNC_CONCURRENCY = 5;
const IMAGE_SYNC_BATCH = 200;

type ArticleTarget = {
  articleId: string;
  productUrl: string;
  categoryHint?: string | null;
};

type ExistingVariantImage = {
  sourceImageUrl: string | null;
  hostedImageUrl: string | null;
  imageSyncStatus: string | null;
};

type ReicheltRunStats = {
  processedProducts: number;
  wrote: number;
  gtinMatched: number;
  skippedUnmapped: number;
  skippedCategoryUnmapped: number;
  skippedNoGtin: number;
  skippedNoPrice: number;
  skippedFresh: number;
  markedDelisted: number;
  staleChecked: number;
  staleZeroed: number;
  parseErrors: number;
  requestErrors: number;
  listed: number;
};

type ReicheltNoteFields = {
  articleId?: string;
  productUrl?: string;
  type?: string;
};

function parseReicheltNoteFields(raw: string | null | undefined): ReicheltNoteFields {
  try {
    return (JSON.parse(String(raw || "")) as ReicheltNoteFields) || {};
  } catch {
    return {};
  }
}

function deferReicheltImageSync(): boolean {
  return String(process.env.SCRAPER_REI_DEFER_IMAGE_SYNC ?? "1") !== "0";
}

function formatReicheltNote(product: ReicheltProduct, galaxusKind: string, cost: ReicheltLandedCost) {
  const descriptionText = product.descriptionHtml
    ? product.descriptionHtml
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 3500)
    : null;
  return JSON.stringify({
    type: "reichelt_landed_cost",
    articleId: product.articleId,
    reicheltSku: product.reicheltSku,
    manufacturerPartNo: product.manufacturerPartNo,
    galaxusKind,
    productPriceSource: cost.productPriceSource,
    rawPriceChf: cost.rawPriceChf,
    priceEur: cost.priceEur,
    productChf: cost.productChf,
    shippingEur: cost.shippingEur,
    shippingChf: cost.shippingChf,
    landedChf: cost.landedChf,
    marginPercent: cost.marginPercent,
    sellPriceChf: cost.sellPriceChf,
    weightGrams: cost.weightGrams,
    rawWeightGrams: cost.rawWeightGrams,
    weightSource: cost.weightSource,
    eurChfRate: cost.eurChfRate,
    vatRate: cost.vatRate,
    stockStatus: product.stockStatus,
    stockText: product.stockText,
    breadcrumbs: product.breadcrumbs,
    productUrl: product.productUrl,
    descriptionText: descriptionText || undefined,
    imageStoredInDb: false,
    stockSource: "availability_status",
  });
}

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
  try {
    await scraperQuery(
      `UPDATE scraper.scrape_runs SET ${sets}, heartbeat_at = NOW() WHERE id = $1`,
      [runId, ...keys.map((k) => fields[k])]
    );
  } catch {
    await scraperQuery(`ALTER TABLE scraper.scrape_runs ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ`);
    await scraperQuery(
      `UPDATE scraper.scrape_runs SET ${sets}, heartbeat_at = NOW() WHERE id = $1`,
      [runId, ...keys.map((k) => fields[k])]
    );
  }
}

function runMessage(stats: ReicheltRunStats, discovery: string, imageSynced: number, imageFailed: number) {
  return [
    `source=reichelt-html`,
    `discovery=${discovery}`,
    `listed=${stats.listed}`,
    `processed=${stats.processedProducts}`,
    `gtin_rows=${stats.gtinMatched}`,
    `skipped_category_unmapped=${stats.skippedCategoryUnmapped}`,
    `skipped_unmapped=${stats.skippedUnmapped}`,
    `skipped_no_gtin=${stats.skippedNoGtin}`,
    `skipped_no_price=${stats.skippedNoPrice}`,
    `skipped_fresh=${stats.skippedFresh}`,
    `marked_delisted=${stats.markedDelisted}`,
    `stale_checked=${stats.staleChecked}`,
    `stale_zeroed=${stats.staleZeroed}`,
    `req_errors=${stats.requestErrors}`,
    `images_synced=${imageSynced}`,
    `images_failed=${imageFailed}`,
    deferReicheltImageSync() ? "image_sync=deferred" : "image_sync=inline",
  ].join(" ");
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

async function upsertReicheltVariant(
  prismaAny: any,
  shop: ScraperShop,
  product: ReicheltProduct,
  galaxusKind: string,
  cost: ReicheltLandedCost,
  existingById: Map<string, ExistingVariantImage>,
  imageSyncQueue: Set<string>
) {
  const supplierVariantId = `${shop.key}_${product.gtin}`;
  const providerKey = buildProviderKey(product.gtin, supplierVariantId);
  if (!providerKey) return false;

  const cfg = reicheltConfig();
  const stock = product.inStock ? cfg.defaultStock : 0;
  const productType = reicheltCategoryPathLabel(product.breadcrumbs);
  const existing = existingById.get(supplierVariantId);
  const queueImage = !deferReicheltImageSync() && needsImageHosting(existing, product.imageUrl);
  const now = new Date();

  await prismaAny.supplierVariant.upsert({
    where: { supplierVariantId },
    create: {
      supplierVariantId,
      supplierSku: product.reicheltSku,
      providerKey,
      gtin: product.gtin,
      price: cost.sellPriceChf,
      stock,
      supplierBrand: product.brand,
      supplierProductName: product.name,
      supplierProductType: productType,
      sourceImageUrl: product.imageUrl,
      images: [],
      weightGrams: cost.weightGrams,
      manualNote: formatReicheltNote(product, galaxusKind, cost),
      imageSyncStatus: product.imageUrl ? "PENDING" : null,
      lastSyncAt: now,
    },
    update: {
      supplierSku: product.reicheltSku,
      providerKey,
      gtin: product.gtin,
      price: cost.sellPriceChf,
      stock,
      supplierBrand: product.brand,
      supplierProductName: product.name,
      supplierProductType: productType,
      sourceImageUrl: product.imageUrl,
      images: [],
      weightGrams: cost.weightGrams,
      manualNote: formatReicheltNote(product, galaxusKind, cost),
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
}

async function runTargetPool(
  targets: AsyncIterable<ArticleTarget>,
  concurrency: number,
  worker: (target: ArticleTarget) => Promise<void>
): Promise<void> {
  const iter = targets[Symbol.asyncIterator]();
  const runners = Array.from({ length: concurrency }, async () => {
    for (;;) {
      const next = await iter.next();
      if (next.done) break;
      await worker(next.value);
    }
  });
  await Promise.all(runners);
}

async function* iterArticleTargets(
  client: ReicheltClient,
  discovery: string,
  stats: ReicheltRunStats
): AsyncGenerator<ArticleTarget> {
  const seen = new Set<string>();
  const maxShards = Math.max(0, Number(process.env.SCRAPER_REI_MAX_SITEMAP_SHARDS || 0));

  const yieldTargets = function* (targets: Array<{ articleId: string; productUrl: string }>, categoryHint?: string | null) {
    for (const t of targets) {
      if (seen.has(t.articleId)) continue;
      seen.add(t.articleId);
      stats.listed++;
      yield { ...t, categoryHint: categoryHint ?? null };
    }
  };

  if (discovery === "sitemap" || discovery === "both") {
    let shardCount = 0;
    for await (const { shard, urls } of client.iterProductSitemapShards()) {
      yield* yieldTargets(client.collectArticleTargetsFromProductUrls(urls));
      shardCount++;
      if (maxShards > 0 && shardCount >= maxShards) break;
      if (shard % 10 === 0) {
        console.log(`[SCRAPER] rei sitemap shard ${shard}: ${stats.listed} article ids`);
      }
    }
  }

  if (discovery === "category" || discovery === "both") {
    for await (const categoryUrl of client.iterCategorySitemapUrls()) {
      const slugHint = extractReicheltCategorySlug(categoryUrl);
      const categoryKind = slugHint
        ? classifyReicheltGalaxusKind({ title: slugHint, supplierProductType: slugHint })
        : null;
      if (slugHint && !categoryKind) {
        stats.skippedCategoryUnmapped++;
        continue;
      }
      try {
        for await (const pageItems of client.iterCategoryProductPages(categoryUrl)) {
          yield* yieldTargets(
            pageItems
              .filter((item) => item.productUrl)
              .map((item) => ({ articleId: item.articleId, productUrl: item.productUrl! })),
            slugHint
          );
        }
      } catch (err) {
        console.warn(`[SCRAPER] rei category skipped ${categoryUrl}:`, (err as Error)?.message || err);
      }
    }
  }
}

/** Reichelt CH storefront — streamed discovery + per-product HTML parse. */
export async function scrapeReicheltShop(
  shop: ScraperShop,
  runId: number,
  maxProducts?: number
): Promise<void> {
  const prismaAny = prisma as any;
  const cfg = reicheltConfig();
  const client = new ReicheltClient(shop.baseUrl);
  const discovery = String(process.env.SCRAPER_REI_DISCOVERY || "sitemap").toLowerCase();

  const stats: ReicheltRunStats = {
    processedProducts: 0,
    wrote: 0,
    gtinMatched: 0,
    skippedUnmapped: 0,
    skippedCategoryUnmapped: 0,
    skippedNoGtin: 0,
    skippedNoPrice: 0,
    skippedFresh: 0,
    markedDelisted: 0,
    staleChecked: 0,
    staleZeroed: 0,
    parseErrors: 0,
    requestErrors: 0,
    listed: 0,
  };
  let imageSynced = 0;
  let imageFailed = 0;
  const imageSyncQueue = new Set<string>();

  const deltaDays = Math.max(0, Number(process.env.SCRAPER_REI_DELTA_DAYS ?? 3));
  const freshCutoffMs = deltaDays > 0 ? Date.now() - deltaDays * 86_400_000 : 0;
  const freshArticleIds = new Set<string>();
  const staleSweepEnabled = String(process.env.SCRAPER_REI_STALE_SWEEP ?? "1") !== "0";
  const staleDays = Math.max(1, Number(process.env.SCRAPER_REI_STALE_DAYS ?? 7));
  const staleCutoffMs = Date.now() - staleDays * 86_400_000;
  const staleSweepMaxEnv = Math.max(0, Number(process.env.SCRAPER_REI_STALE_SWEEP_MAX || 0));
  const staleSweepMax = maxProducts
    ? maxProducts
    : staleSweepMaxEnv > 0
      ? staleSweepMaxEnv
      : Number.POSITIVE_INFINITY;

  const existingRows = (await prismaAny.supplierVariant.findMany({
    where: { supplierVariantId: { startsWith: `${shop.key}_` } },
    select: {
      supplierVariantId: true,
      sourceImageUrl: true,
      hostedImageUrl: true,
      imageSyncStatus: true,
      lastSyncAt: true,
      manualNote: true,
      stock: true,
    },
  })) as Array<
    ExistingVariantImage & {
      supplierVariantId: string;
      lastSyncAt: Date | null;
      manualNote: string | null;
      stock: number | null;
    }
  >;
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
  // Map articleId (stored in manualNote JSON) -> supplierVariantId so we can zero
  // stock on rows whose Reichelt product page is now "no longer available".
  const existingByArticleId = new Map<string, string>();
  const articleProductUrl = new Map<string, string>();
  for (const row of existingRows) {
    const note = parseReicheltNoteFields(row.manualNote);
    const id = String(note.articleId || "").trim();
    if (!id) continue;
    existingByArticleId.set(id, row.supplierVariantId);
    const url = String(note.productUrl || "").trim();
    if (url) articleProductUrl.set(id, url);
  }
  if (deltaDays > 0) {
    for (const row of existingRows) {
      if (!row.lastSyncAt || row.lastSyncAt.getTime() < freshCutoffMs) continue;
      const id = String(parseReicheltNoteFields(row.manualNote).articleId || "").trim();
      if (id) freshArticleIds.add(id);
    }
    console.log(
      `[SCRAPER] rei delta: skip ${freshArticleIds.size} articles synced within ${deltaDays}d`
    );
  }

  async function markReicheltDelisted(articleId: string): Promise<boolean> {
    const svId = existingByArticleId.get(articleId);
    if (!svId) return false;
    try {
      await prismaAny.supplierVariant.update({
        where: { supplierVariantId: svId },
        data: {
          stock: 0,
          lastSyncAt: new Date(),
          manualNote: JSON.stringify({
            type: "reichelt_delisted",
            articleId,
            detectedAt: new Date().toISOString(),
            reason: "product page no longer available",
          }),
        },
      });
      return true;
    } catch (err) {
      console.warn(`[SCRAPER] rei delist zero failed ${articleId}:`, (err as Error)?.message || err);
      return false;
    }
  }

  /** Re-fetch in-stock DB rows not touched recently (sitemap drop / sold-out gap). */
  async function sweepStaleInStockRows(): Promise<void> {
    if (!staleSweepEnabled) return;

    const targets: ArticleTarget[] = [];
    for (const row of existingRows) {
      if ((row.stock ?? 0) <= 0) continue;
      if (row.lastSyncAt && row.lastSyncAt.getTime() >= staleCutoffMs) continue;
      const articleId = String(parseReicheltNoteFields(row.manualNote).articleId || "").trim();
      if (!articleId) continue;
      targets.push({
        articleId,
        productUrl:
          articleProductUrl.get(articleId) ||
          `${shop.baseUrl.replace(/\/$/, "")}/shop/produit/-${articleId}`,
      });
      if (targets.length >= staleSweepMax) break;
    }

    console.log(
      `[SCRAPER] rei stale sweep: ${targets.length} in-stock rows older than ${staleDays}d`
    );
    if (!targets.length) return;

    await runTargetPool(
      (async function* () {
        for (const t of targets) yield t;
      })(),
      cfg.productConcurrency,
      async ({ articleId, productUrl }) => {
      stats.staleChecked++;
      try {
        const fetched = await client.fetchProductByArticleId(articleId, productUrl);
        if (!fetched.product) {
          if (fetched.delisted) {
            const zeroed = await markReicheltDelisted(articleId);
            if (zeroed) {
              stats.markedDelisted++;
              stats.staleZeroed++;
            }
          }
          return;
        }
        const product = fetched.product;
        if (!product.inStock) {
          const svId = existingByArticleId.get(articleId);
          if (!svId) return;
          await prismaAny.supplierVariant.update({
            where: { supplierVariantId: svId },
            data: {
              stock: 0,
              lastSyncAt: new Date(),
              manualNote: JSON.stringify({
                type: "reichelt_oos",
                articleId,
                stockStatus: product.stockStatus,
                stockText: product.stockText,
                productUrl: product.productUrl,
                detectedAt: new Date().toISOString(),
                reason: "stale sweep: not in stock",
              }),
            },
          });
          stats.markedDelisted++;
          stats.staleZeroed++;
          freshArticleIds.add(articleId);
          return;
        }

        const cost = computeReicheltLandedCost({
          priceChf: product.priceChf,
          priceEur: product.priceEur,
          weightGrams: product.weightGrams,
        });
        if (!cost || !isPlausibleReicheltSellPrice(cost)) return;
        const galaxusKind = classifyReicheltGalaxusKind({
          breadcrumbs: product.breadcrumbs,
          title: product.name,
          supplierProductType: reicheltCategoryPathLabel(product.breadcrumbs),
        });
        if (!galaxusKind) return;
        const ok = await upsertReicheltVariant(
          prismaAny,
          shop,
          product,
          galaxusKind,
          cost,
          existingById,
          imageSyncQueue
        );
        if (!ok) return;
        stats.wrote++;
        stats.gtinMatched++;
        freshArticleIds.add(articleId);
      } catch (err) {
        stats.requestErrors++;
        console.warn(`[SCRAPER] rei stale ${articleId}:`, (err as Error)?.message || err);
      }

      if (stats.staleChecked % 25 === 0) {
        await updateRun(runId, {
          products_listed: stats.listed,
          with_gtin: stats.gtinMatched,
          variants_upserted: stats.wrote,
          errors: stats.parseErrors + stats.requestErrors,
          message: runMessage(stats, discovery, imageSynced, imageFailed),
        });
      }
    });

    console.log(
      `[SCRAPER] rei stale sweep done: checked=${stats.staleChecked} zeroed=${stats.staleZeroed}`
    );
  }

  try {
    await sweepStaleInStockRows();

    let stop = false;
    const source = iterArticleTargets(client, discovery, stats);

    await runTargetPool(
      {
        [Symbol.asyncIterator]: async function* () {
          for await (const target of source) {
            if (stop) break;
            yield target;
          }
        },
      },
      cfg.productConcurrency,
      async ({ articleId, productUrl, categoryHint }) => {
        if (maxProducts && stats.processedProducts >= maxProducts) {
          stop = true;
          return;
        }
        stats.processedProducts++;

        try {
          if (freshArticleIds.has(articleId)) {
            stats.skippedFresh++;
            return;
          }

          if (categoryHint) {
            const preKind = classifyReicheltGalaxusKind({
              title: categoryHint,
              supplierProductType: categoryHint,
            });
            if (!preKind) {
              stats.skippedUnmapped++;
              return;
            }
          }

          const fetched = await client.fetchProductByArticleId(articleId, productUrl);
          if (!fetched.product) {
            if (fetched.delisted) {
              const zeroed = await markReicheltDelisted(articleId);
              if (zeroed) stats.markedDelisted++;
            }
            stats.skippedNoGtin++;
            return;
          }
          const product = fetched.product;
          const cost = computeReicheltLandedCost({
            priceChf: product.priceChf,
            priceEur: product.priceEur,
            weightGrams: product.weightGrams,
          });
          if (!cost || !isPlausibleReicheltSellPrice(cost)) {
            stats.skippedNoPrice++;
            return;
          }
          const galaxusKind = classifyReicheltGalaxusKind({
            breadcrumbs: product.breadcrumbs,
            title: product.name,
            supplierProductType: reicheltCategoryPathLabel(product.breadcrumbs) ?? categoryHint,
          });
          if (!galaxusKind) {
            stats.skippedUnmapped++;
            return;
          }
          const ok = await upsertReicheltVariant(
            prismaAny,
            shop,
            product,
            galaxusKind,
            cost,
            existingById,
            imageSyncQueue
          );
          if (!ok) return;
          stats.wrote++;
          stats.gtinMatched++;
          freshArticleIds.add(articleId);
        } catch (err) {
          stats.requestErrors++;
          stats.parseErrors++;
          console.warn(`[SCRAPER] rei product ${articleId}:`, (err as Error)?.message || err);
        }

        if (stats.processedProducts % 25 === 0) {
          await updateRun(runId, {
            products_listed: stats.listed,
            with_gtin: stats.gtinMatched,
            variants_upserted: stats.wrote,
            errors: stats.parseErrors + stats.requestErrors,
            message: runMessage(stats, discovery, imageSynced, imageFailed),
          });
        }
        if (!deferReicheltImageSync() && imageSyncQueue.size >= IMAGE_SYNC_BATCH) {
          const img = await flushImageSyncQueue(imageSyncQueue);
          imageSynced += img.synced;
          imageFailed += img.failed;
        }
      }
    );

    if (!deferReicheltImageSync()) {
      while (imageSyncQueue.size > 0) {
        const img = await flushImageSyncQueue(imageSyncQueue);
        imageSynced += img.synced;
        imageFailed += img.failed;
      }
    }

    if (stats.wrote > 0 || stats.markedDelisted > 0 || stats.staleZeroed > 0) {
      try {
        const { scheduleScraperGalaxusFeedPush } = await import("@/app/lib/scraperFeedPush");
        await scheduleScraperGalaxusFeedPush({
          shop,
          wrote: stats.wrote + stats.markedDelisted,
          syncImages: true,
        });
      } catch (err) {
        console.warn(`[SCRAPER] rei feed push schedule failed:`, (err as Error)?.message || err);
      }
    }

    await updateRun(runId, {
      status: stats.listed === 0 && stats.processedProducts === 0 ? "error" : "ok",
      finished_at: new Date(),
      products_listed: stats.listed,
      variants_upserted: stats.wrote,
      with_gtin: stats.gtinMatched,
      errors: stats.parseErrors + stats.requestErrors,
      message:
        stats.listed === 0 && stats.processedProducts === 0
          ? `${runMessage(stats, discovery, imageSynced, imageFailed)} · reichelt_unreachable_or_503_retry_later`
          : runMessage(stats, discovery, imageSynced, imageFailed),
    });
    if (stats.listed > 0 || stats.wrote > 0) clearReicheltScrapeProgress();
  } catch (err: any) {
    await updateRun(runId, {
      status: stats.listed > 0 || stats.wrote > 0 ? "interrupted" : "error",
      finished_at: new Date(),
      products_listed: stats.listed,
      variants_upserted: stats.wrote,
      with_gtin: stats.gtinMatched,
      errors: stats.parseErrors + stats.requestErrors,
      message: String(err?.message || err).slice(0, 2000),
    });
    throw err;
  }
}
