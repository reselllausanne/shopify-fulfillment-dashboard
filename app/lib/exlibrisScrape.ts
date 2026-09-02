import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/app/lib/prisma";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
import type { ScraperShop } from "@/app/lib/scraperShops";
import {
  catalogPrefix,
  categoryPageUrl,
  discoverCategoryPaths,
  emptyProgress,
  exlibrisConfig,
  exlibrisStockFromLabel,
  extractProductTiles,
  fetchExlibrisHtml,
  type ExlibrisScrapeProgress,
  type ExlibrisTile,
  EXLIBRIS_BASE,
} from "@/app/lib/exlibrisClient";
import {
  computeExlibrisLandedCost,
  formatExlibrisManualNote,
  isPlausibleExlibrisSellPrice,
} from "@/app/lib/exlibrisPricing";
import { startRun, hasRunningRun, recoverStaleRuns } from "@/app/lib/scraperRun";
import { scraperQuery } from "@/app/lib/scraperDb";

export { startRun, hasRunningRun, recoverStaleRuns };

const IMAGE_SYNC_BATCH = 200;
const IMAGE_SYNC_CONCURRENCY = 5;

type ExistingVariantImage = {
  sourceImageUrl: string | null;
  hostedImageUrl: string | null;
  imageSyncStatus: string | null;
};

type RunStats = {
  listed: number;
  wrote: number;
  skippedNoGtin: number;
  skippedNoPrice: number;
  skippedDigital: number;
  requestErrors: number;
};

function deferExlImageSync(): boolean {
  return exlibrisConfig().deferImageSync;
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

function loadProgress(filePath: string, catalog: string): ExlibrisScrapeProgress {
  if (exlibrisConfig().resume && fs.existsSync(filePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as ExlibrisScrapeProgress;
      if (raw.catalog === catalog) return raw;
    } catch {
      /* try legacy checkpoint */
    }
  }

  const legacyPaths = [
    path.join(process.cwd(), ".data/exlibris/exlibris_checkpoint.json"),
    path.join(path.dirname(filePath), "exlibris/exlibris_checkpoint.json"),
  ];
  for (const legacyPath of legacyPaths) {
    if (!fs.existsSync(legacyPath)) continue;
    try {
      const py = JSON.parse(fs.readFileSync(legacyPath, "utf8")) as {
        catalog?: string;
        catalog_root?: string;
        seen_eans?: string[];
        pending_categories?: string[];
        done_categories?: string[];
        category_pages?: Record<string, number>;
        rows_written?: number;
        requests?: number;
      };
      if (py.catalog && py.catalog !== catalog) continue;
      const migrated: ExlibrisScrapeProgress = {
        catalog,
        catalogRoot: py.catalog_root || catalogPrefix(catalog),
        seenEans: py.seen_eans ?? [],
        pendingCategories: py.pending_categories ?? [],
        doneCategories: py.done_categories ?? [],
        categoryPages: py.category_pages ?? {},
        rowsWritten: py.rows_written ?? 0,
        requests: py.requests ?? 0,
        updatedAt: new Date().toISOString(),
      };
      console.log(
        `[SCRAPER] exl migrated python checkpoint from ${legacyPath}: ${migrated.seenEans.length} eans, page=${migrated.categoryPages["/de/hobby-spiele-brettspiele/"] ?? "?"}`
      );
      saveProgress(filePath, migrated);
      return migrated;
    } catch {
      /* next path */
    }
  }

  return emptyProgress(catalog);
}

function saveProgress(filePath: string, progress: ExlibrisScrapeProgress) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  progress.updatedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(progress, null, 2));
}

export async function upsertExlibrisTile(
  shop: ScraperShop,
  tile: ExlibrisTile,
  existingById: Map<string, ExistingVariantImage>,
  imageSyncQueue: Set<string>
): Promise<boolean> {
  const prismaAny = prisma as any;
  const cost = computeExlibrisLandedCost({
    buyChf: tile.buyChf,
    availabilityText: tile.availabilityText,
  });
  if (!cost || !isPlausibleExlibrisSellPrice(cost)) return false;

  const supplierVariantId = `${shop.key}_${tile.ean}`;
  const providerKey = buildProviderKey(tile.ean, supplierVariantId);
  if (!providerKey) return false;

  const stock = exlibrisStockFromLabel(tile.stockLabel, tile.availabilityText);
  const existing = existingById.get(supplierVariantId);
  const queueImage = !deferExlImageSync() && needsImageHosting(existing, tile.imageUrl || null);
  const now = new Date();
  const manualNote = formatExlibrisManualNote({
    ean: tile.ean,
    productUrl: tile.url,
    availability: tile.availabilityText,
    stock: tile.stockLabel,
    sampleBucket: tile.sampleBucket,
    cost,
  });

  await prismaAny.supplierVariant.upsert({
    where: { supplierVariantId },
    create: {
      supplierVariantId,
      supplierSku: tile.ean,
      providerKey,
      gtin: tile.ean,
      price: cost.sellPriceChf,
      stock,
      supplierBrand: tile.brand || null,
      supplierProductName: tile.title,
      supplierProductType: tile.formatLabel || tile.sampleBucket || null,
      sourceImageUrl: tile.imageUrl || null,
      images: [],
      manualNote,
      imageSyncStatus: tile.imageUrl ? "PENDING" : null,
      lastSyncAt: now,
    },
    update: {
      supplierSku: tile.ean,
      providerKey,
      gtin: tile.ean,
      price: cost.sellPriceChf,
      stock,
      supplierBrand: tile.brand || null,
      supplierProductName: tile.title,
      supplierProductType: tile.formatLabel || tile.sampleBucket || null,
      sourceImageUrl: tile.imageUrl || null,
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
      gtin: tile.ean,
      providerKey,
      supplierKey: shop.key,
      status: "SUPPLIER_GTIN",
    },
    update: {
      gtin: tile.ean,
      providerKey,
      supplierKey: shop.key,
      status: "SUPPLIER_GTIN",
    },
  });

  existingById.set(supplierVariantId, {
    sourceImageUrl: tile.imageUrl || null,
    hostedImageUrl: queueImage ? null : existing?.hostedImageUrl ?? null,
    imageSyncStatus: queueImage ? "PENDING" : existing?.imageSyncStatus ?? null,
  });
  if (queueImage) imageSyncQueue.add(supplierVariantId);
  return true;
}

/** Upsert one CSV row dict (from Python POC export). */
export async function upsertExlibrisCsvRow(
  shop: ScraperShop,
  row: Record<string, string>,
  existingById: Map<string, ExistingVariantImage>,
  imageSyncQueue: Set<string>
): Promise<"wrote" | "skip_no_gtin" | "skip_no_price" | "skip_digital"> {
  if (row.gtin_valid !== "1") return "skip_no_gtin";
  const ean = String(row.gtin || "").trim();
  if (!ean) return "skip_no_gtin";
  if (String(row.parse_error || "").startsWith("skip_")) return "skip_digital";

  const tile: ExlibrisTile = {
    ean,
    title: String(row.name || ""),
    url: String(row.product_url || ""),
    buyChf: Number(row.price),
    currency: String(row.currency || "CHF"),
    availabilityText: String(row.availability || ""),
    stockLabel: String(row.stock || "unknown"),
    imageUrl: String(row.image_url || ""),
    formatLabel: String(row.sales_unit || ""),
    sampleBucket: String(row.sample_bucket || ""),
    brand: String(row.brand || ""),
  };

  const ok = await upsertExlibrisTile(shop, tile, existingById, imageSyncQueue);
  return ok ? "wrote" : "skip_no_price";
}

export async function scrapeExlibrisShop(
  shop: ScraperShop,
  runId: number,
  maxProducts?: number
): Promise<void> {
  const prismaAny = prisma as any;
  const cfg = exlibrisConfig();
  const catalog = String(process.env.EXLIBRIS_CATALOG || "spiele");
  const catalogRoot = catalogPrefix(catalog);
  const progressFile = path.join(process.cwd(), ".data/exlibris-scrape-progress.json");

  const stats: RunStats = {
    listed: 0,
    wrote: 0,
    skippedNoGtin: 0,
    skippedNoPrice: 0,
    skippedDigital: 0,
    requestErrors: 0,
  };
  let imageSynced = 0;
  let imageFailed = 0;
  const imageSyncQueue = new Set<string>();
  const seen = new Set<string>();

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

  const progress = loadProgress(progressFile, catalog);
  // Only treat checkpoint EANs as done if already in DB — Python seen-set
  // blocked ~14k CSV rows that never got upserted.
  for (const e of progress.seenEans) {
    if (existingById.has(`${shop.key}_${e}`)) seen.add(e);
  }

  let queue = progress.pendingCategories.length
    ? [...progress.pendingCategories]
    : [];
  const done = new Set(progress.doneCategories);

  try {
    if (!queue.length) {
      const seedHtml = await fetchExlibrisHtml(`${EXLIBRIS_BASE}${catalogRoot}`);
      progress.requests++;
      const discovered = discoverCategoryPaths(seedHtml, catalogRoot);
      queue = [catalogRoot, ...discovered.filter((p) => !done.has(p))];
    }

    while (queue.length) {
      if (maxProducts && stats.wrote >= maxProducts) break;
      const catPath = queue.shift()!;
      if (done.has(catPath)) continue;

      const bucket = catPath.includes("/ci/") ? catPath.split("/").slice(-3, -2)[0] || catalog : catalog;
      let page = progress.categoryPages[catPath] ?? 1;
      let emptyStreak = 0;

      while (true) {
        if (maxProducts && stats.wrote >= maxProducts) break;

        const url = categoryPageUrl(catPath, page);
        let tiles: ExlibrisTile[] = [];
        try {
          const html = await fetchExlibrisHtml(url);
          progress.requests++;
          if (page === (progress.categoryPages[catPath] ?? 1)) {
            for (const sub of discoverCategoryPaths(html, catalogRoot)) {
              if (!done.has(sub) && !queue.includes(sub)) queue.push(sub);
            }
          }
          tiles = extractProductTiles(html);
        } catch (err) {
          stats.requestErrors++;
          throw err;
        }

        let newOnPage = 0;
        for (const tile of tiles) {
          if (maxProducts && stats.wrote >= maxProducts) break;
          if (seen.has(tile.ean)) continue;
          seen.add(tile.ean);
          stats.listed++;

          const result = await upsertExlibrisTile(shop, tile, existingById, imageSyncQueue);
          if (result) {
            stats.wrote++;
            newOnPage++;
          } else {
            stats.skippedNoPrice++;
          }

          if (cfg.flushEvery > 0 && stats.wrote % cfg.flushEvery === 0) {
            const img = await flushImageSyncQueue(imageSyncQueue);
            imageSynced += img.synced;
            imageFailed += img.failed;
            progress.seenEans = [...seen];
            progress.rowsWritten = stats.wrote;
            progress.pendingCategories = queue;
            progress.doneCategories = [...done];
            saveProgress(progressFile, progress);
            await updateRun(runId, {
              products_listed: stats.listed,
              products_written: stats.wrote,
              message: `exl page=${page} cat=${catPath} wrote=${stats.wrote}`,
            });
          }
        }

        progress.categoryPages[catPath] = page + 1;
        if (!tiles.length || newOnPage === 0) emptyStreak++;
        else emptyStreak = 0;
        if (emptyStreak >= 2) break;
        page++;
      }

      done.add(catPath);
      progress.pendingCategories = queue;
      progress.doneCategories = [...done];
      progress.seenEans = [...seen];
      progress.rowsWritten = stats.wrote;
      saveProgress(progressFile, progress);
      await updateRun(runId, {
        products_listed: stats.listed,
        products_written: stats.wrote,
        message: `exl cat_done=${catPath} wrote=${stats.wrote}`,
      });
    }

    const img = await flushImageSyncQueue(imageSyncQueue);
    imageSynced += img.synced;
    imageFailed += img.failed;

    await scraperQuery(
      `UPDATE scraper.scrape_runs SET status = 'completed', finished_at = NOW(), products_listed = $2, products_written = $3, message = $4 WHERE id = $1`,
      [
        runId,
        stats.listed,
        stats.wrote,
        [
          `source=exlibris-listing`,
          `catalog=${catalog}`,
          `listed=${stats.listed}`,
          `wrote=${stats.wrote}`,
          `req_errors=${stats.requestErrors}`,
          `images_synced=${imageSynced}`,
          deferExlImageSync() ? "image_sync=deferred" : "image_sync=inline",
        ].join(" "),
      ]
    );
  } catch (err) {
    progress.seenEans = [...seen];
    progress.rowsWritten = stats.wrote;
    saveProgress(progressFile, progress);
    await scraperQuery(
      `UPDATE scraper.scrape_runs SET status = 'error', finished_at = NOW(), products_listed = $2, products_written = $3, message = $4 WHERE id = $1`,
      [runId, stats.listed, stats.wrote, String((err as Error)?.message || err).slice(0, 500)]
    );
    throw err;
  }
}
