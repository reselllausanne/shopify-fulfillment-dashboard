import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { prisma } from "@/app/lib/prisma";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
import type { ScraperShop } from "@/app/lib/scraperShops";
import { startRun, hasRunningRun, recoverStaleRuns } from "@/app/lib/scraperRun";
import { scraperQuery } from "@/app/lib/scraperDb";
import { reicheltProxyPool } from "@/app/lib/reicheltClient";
import {
  categoryPageUrl,
  extractFantasyweltProductUrls,
  fantasyweltConfig,
  formatFantasyweltNote,
  isFantasyweltCloudflare,
  parseFantasyweltProductHtml,
  type FantasyweltProduct,
} from "@/app/lib/fantasyweltClient";
import { computeFantasyweltLandedCost } from "@/app/lib/fantasyweltPricing";

export { startRun, hasRunningRun, recoverStaleRuns };

const IMAGE_SYNC_CONCURRENCY = 5;
const IMAGE_SYNC_BATCH = 200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type ProgressState = {
  discoveredUrls: string[];
  doneUrls: string[];
  categoryIndex: number;
  categoryPage: number;
  discoveryDone: boolean;
  updatedAt: string;
};

type ExistingVariantImage = {
  sourceImageUrl: string | null;
  hostedImageUrl: string | null;
  imageSyncStatus: string | null;
};

type PlaywrightProxy = { server: string; username?: string; password?: string };

let fanProxyCursor = 0;

function parseHttpProxyUrl(raw: string): PlaywrightProxy | null {
  try {
    const u = new URL(raw);
    if (!u.hostname || !u.port) return null;
    const out: PlaywrightProxy = { server: `${u.protocol}//${u.hostname}:${u.port}` };
    if (u.username) out.username = decodeURIComponent(u.username);
    if (u.password) out.password = decodeURIComponent(u.password);
    return out;
  } catch {
    return null;
  }
}

/** Prefer FAN proxy envs; fallback to Reichelt LemonProxy pool (same DE residential list). */
function nextFanProxy(): PlaywrightProxy | null {
  const single = String(process.env.SCRAPER_FAN_PROXY || process.env.SCRAPER_PROXY || "").trim();
  if (single) return parseHttpProxyUrl(single.startsWith("http") ? single : `http://${single}`);

  const useRei = String(process.env.SCRAPER_FAN_USE_REI_PROXIES ?? "1") !== "0";
  if (!useRei) return null;
  const pool = reicheltProxyPool();
  if (!pool.length) return null;
  const url = pool[fanProxyCursor % pool.length]!;
  fanProxyCursor = (fanProxyCursor + 1) % pool.length;
  return parseHttpProxyUrl(url);
}

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

function loadProgress(file: string, resume: boolean): ProgressState {
  const empty: ProgressState = {
    discoveredUrls: [],
    doneUrls: [],
    categoryIndex: 0,
    categoryPage: 1,
    discoveryDone: false,
    updatedAt: new Date().toISOString(),
  };
  if (!resume || !fs.existsSync(file)) return empty;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as ProgressState;
    return {
      discoveredUrls: Array.isArray(raw.discoveredUrls) ? raw.discoveredUrls : [],
      doneUrls: Array.isArray(raw.doneUrls) ? raw.doneUrls : [],
      categoryIndex: Number(raw.categoryIndex) || 0,
      categoryPage: Math.max(1, Number(raw.categoryPage) || 1),
      discoveryDone: Boolean(raw.discoveryDone),
      updatedAt: raw.updatedAt || empty.updatedAt,
    };
  } catch {
    return empty;
  }
}

function saveProgress(file: string, state: ProgressState) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  state.updatedAt = new Date().toISOString();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state), "utf8");
  fs.renameSync(tmp, file);
}

async function dismissCookies(page: Page): Promise<void> {
  for (const label of ["Alle zulassen", "Allow all", "Akzeptieren", "Accept"]) {
    const btn = page.locator(`button:has-text("${label}")`).first();
    if (await btn.isVisible({ timeout: 1200 }).catch(() => false)) {
      await btn.click({ timeout: 3000 }).catch(() => undefined);
      await sleep(300);
      return;
    }
  }
}

async function gotoFantasywelt(page: Page, url: string, cfg: ReturnType<typeof fantasyweltConfig>): Promise<string> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: cfg.gotoTimeoutMs });
      const deadline = Date.now() + cfg.cfWaitMs;
      while (Date.now() < deadline) {
        const html = await page.content();
        if (!isFantasyweltCloudflare(html) && html.length > 8_000) {
          await dismissCookies(page);
          return html;
        }
        await sleep(1_000);
      }
      const html = await page.content();
      if (isFantasyweltCloudflare(html)) {
        throw new Error(`FantasyWelt Cloudflare wall on ${url}`);
      }
      await dismissCookies(page);
      return html;
    } catch (err) {
      lastErr = err;
      await sleep(1_500 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function launchBrowser(proxy: PlaywrightProxy | null): Promise<Browser> {
  // Prefer headed Chromium on Xvfb (DISPLAY=:99) — headless_shell fails CF more often.
  const headed = String(process.env.SCRAPER_FAN_HEADED ?? "1") !== "0" && Boolean(process.env.DISPLAY);
  return chromium.launch({
    headless: !headed,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
    ],
    ...(proxy ? { proxy } : {}),
  });
}

async function newContext(browser: Browser, cfg: ReturnType<typeof fantasyweltConfig>): Promise<BrowserContext> {
  const context = await browser.newContext({
    userAgent: cfg.userAgent,
    locale: "de-DE",
    viewport: { width: 1400, height: 900 },
    extraHTTPHeaders: { "Accept-Language": "de-DE,de;q=0.9,en;q=0.8" },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  return context;
}

async function withFreshBrowser(
  cfg: ReturnType<typeof fantasyweltConfig>,
  worker: (page: Page) => Promise<void>
): Promise<void> {
  const maxProxyAttempts = Math.max(1, Number(process.env.SCRAPER_FAN_PROXY_RETRIES || 8));
  let lastErr: unknown = null;
  for (let i = 0; i < maxProxyAttempts; i++) {
    const proxy = nextFanProxy();
    let browser: Browser | null = null;
    try {
      browser = await launchBrowser(proxy);
      const context = await newContext(browser, cfg);
      const page = await context.newPage();
      await worker(page);
      await page.close().catch(() => undefined);
      await context.close().catch(() => undefined);
      return;
    } catch (err) {
      lastErr = err;
      const msg = String((err as Error)?.message || err);
      console.warn(`[SCRAPER] fan browser attempt ${i + 1}/${maxProxyAttempts}: ${msg}`);
      if (!/cloudflare/i.test(msg) && i > 0) break;
    } finally {
      await browser?.close().catch(() => undefined);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Discover product URLs by walking seed categories with ?seite=N pagination. */
async function discoverProductUrls(
  page: Page,
  shop: ScraperShop,
  cfg: ReturnType<typeof fantasyweltConfig>,
  progress: ProgressState,
  maxProducts?: number
): Promise<string[]> {
  const seen = new Set(progress.discoveredUrls);
  const categories = cfg.categories;

  for (let ci = progress.categoryIndex; ci < categories.length; ci++) {
    const category = categories[ci];
    let pageNum = ci === progress.categoryIndex ? progress.categoryPage : 1;
    let emptyStreak = 0;

    while (pageNum <= cfg.maxCategoryPages) {
      if (maxProducts && seen.size >= maxProducts) break;
      const url = categoryPageUrl(shop.baseUrl, category, pageNum);
      const html = await gotoFantasywelt(page, url, cfg);
      await sleep(cfg.requestDelayMs);
      const found = extractFantasyweltProductUrls(html, shop.baseUrl);
      let added = 0;
      for (const u of found) {
        if (seen.has(u)) continue;
        seen.add(u);
        added++;
        if (maxProducts && seen.size >= maxProducts) break;
      }
      progress.categoryIndex = ci;
      progress.categoryPage = pageNum;
      progress.discoveredUrls = [...seen];
      if (pageNum % 2 === 0 || added === 0) saveProgress(cfg.progressFile, progress);

      if (added === 0) {
        emptyStreak++;
        if (emptyStreak >= 2 || found.length === 0) break;
      } else {
        emptyStreak = 0;
      }
      pageNum++;
    }
    progress.categoryIndex = ci + 1;
    progress.categoryPage = 1;
    saveProgress(cfg.progressFile, progress);
    if (maxProducts && seen.size >= maxProducts) break;
  }

  progress.discoveryDone = true;
  progress.discoveredUrls = [...seen];
  saveProgress(cfg.progressFile, progress);
  return progress.discoveredUrls;
}

/** FantasyWelt JTL HTML scrape via Playwright (Cloudflare). Upserts GTIN-bearing variants. */
export async function scrapeFantasyweltShop(
  shop: ScraperShop,
  runId: number,
  maxProducts?: number
): Promise<void> {
  const prismaAny = prisma as any;
  const cfg = fantasyweltConfig();
  const resume = String(process.env.SCRAPER_FAN_RESUME ?? "1") !== "0";
  const progress = loadProgress(cfg.progressFile, resume);
  const doneSet = new Set(progress.doneUrls);

  let listed = progress.discoveredUrls.length;
  let processed = doneSet.size;
  let wrote = 0;
  let gtinMatched = 0;
  let skippedNoGtin = 0;
  let skippedNoPrice = 0;
  let skippedOos = 0;
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

  const upsertVariant = async (product: FantasyweltProduct, sellChf: number, stock: number) => {
    const gtin = product.gtin!;
    const supplierVariantId = `${shop.key}_${gtin}`;
    if (seenGtins.has(gtin)) return false;
    seenGtins.add(gtin);
    const providerKey = buildProviderKey(gtin, supplierVariantId);
    if (!providerKey) return false;

    const existing = existingById.get(supplierVariantId);
    const queueImage = !cfg.deferImageSync && needsImageHosting(existing, product.imageUrl);
    const now = new Date();
    const manualNote = formatFantasyweltNote(product);

    await prismaAny.supplierVariant.upsert({
      where: { supplierVariantId },
      create: {
        supplierVariantId,
        supplierSku: product.sku || product.jtlArticleId || gtin,
        providerKey,
        gtin,
        price: sellChf,
        stock,
        supplierBrand: product.brand,
        supplierProductName: product.name,
        supplierProductType: null,
        sourceImageUrl: product.imageUrl,
        images: product.imageUrl ? [product.imageUrl] : [],
        manualNote,
        imageSyncStatus: product.imageUrl ? "PENDING" : null,
        lastSyncAt: now,
      },
      update: {
        supplierSku: product.sku || product.jtlArticleId || gtin,
        providerKey,
        gtin,
        price: sellChf,
        stock,
        supplierBrand: product.brand,
        supplierProductName: product.name,
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
        gtin,
        providerKey,
        supplierKey: shop.key,
        status: "SUPPLIER_GTIN",
      },
      update: {
        gtin,
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
    const proxyHint = reicheltProxyPool().length;
    await updateRun(runId, {
      message: `source=fantasywelt-jtl discovery… cats=${cfg.categories.length} resume=${resume ? 1 : 0} proxies=${proxyHint}`,
    });

    await withFreshBrowser(cfg, async (page) => {
      let productUrls = progress.discoveredUrls;
      if (!progress.discoveryDone || !productUrls.length) {
        productUrls = await discoverProductUrls(page, shop, cfg, progress, maxProducts);
      } else if (maxProducts && productUrls.length > maxProducts) {
        productUrls = productUrls.slice(0, maxProducts);
      }
      listed = productUrls.length;
      await updateRun(runId, {
        products_listed: listed,
        message: `source=fantasywelt-jtl listed=${listed} fetching…`,
      });

      for (const productUrl of productUrls) {
        if (doneSet.has(productUrl)) continue;
        if (maxProducts && processed >= maxProducts) break;
        processed++;
        try {
          const html = await gotoFantasywelt(page, productUrl, cfg);
          await sleep(cfg.requestDelayMs);
          const product = parseFantasyweltProductHtml(html, productUrl);
          if (!product) {
            requestErrors++;
          } else if (!product.gtin) {
            skippedNoGtin++;
          } else if (!product.priceEur || product.priceEur <= 0) {
            skippedNoPrice++;
          } else if (product.availability === "OutOfStock") {
            skippedOos++;
            const cost = computeFantasyweltLandedCost(product.priceEur);
            if (cost) {
              const ok = await upsertVariant(product, cost.sellPriceChf, 0);
              if (ok) {
                wrote++;
                gtinMatched++;
              }
            }
          } else {
            const cost = computeFantasyweltLandedCost(product.priceEur);
            if (!cost) {
              skippedNoPrice++;
            } else {
              const stock =
                product.availability === "InStock" || product.availability === "PreOrder"
                  ? cfg.defaultStock
                  : 0;
              const ok = await upsertVariant(product, cost.sellPriceChf, stock);
              if (ok) {
                wrote++;
                gtinMatched++;
              }
            }
          }
        } catch (err) {
          requestErrors++;
          console.warn(`[SCRAPER] ${shop.key} product ${productUrl}:`, (err as Error)?.message || err);
          if (/cloudflare/i.test(String((err as Error)?.message || err))) {
            throw err;
          }
        }

        doneSet.add(productUrl);
        progress.doneUrls = [...doneSet];
        if (processed % 25 === 0) {
          saveProgress(cfg.progressFile, progress);
          await updateRun(runId, {
            products_listed: listed,
            with_gtin: gtinMatched,
            variants_upserted: wrote,
            errors: requestErrors,
            message: [
              "source=fantasywelt-jtl",
              `listed=${listed}`,
              `processed=${processed}`,
              `wrote=${wrote}`,
              `skipped_no_gtin=${skippedNoGtin}`,
              `skipped_no_price=${skippedNoPrice}`,
              `skipped_oos=${skippedOos}`,
            ].join(" "),
          });
        }

        if (!cfg.deferImageSync && imageSyncQueue.size >= IMAGE_SYNC_BATCH) {
          const img = await flushImageSyncQueue(imageSyncQueue);
          imageSynced += img.synced;
          imageFailed += img.failed;
        }
      }
    });

    saveProgress(cfg.progressFile, progress);

    if (!cfg.deferImageSync) {
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
        "source=fantasywelt-jtl",
        `listed=${listed}`,
        `processed=${processed}`,
        `wrote=${wrote}`,
        `skipped_no_gtin=${skippedNoGtin}`,
        `skipped_no_price=${skippedNoPrice}`,
        `skipped_oos=${skippedOos}`,
        cfg.deferImageSync ? "image_sync=deferred" : `images_synced=${imageSynced}`,
        `images_failed=${imageFailed}`,
      ].join(" "),
    });
  } catch (err: any) {
    saveProgress(cfg.progressFile, progress);
    await updateRun(runId, {
      status: "error",
      finished_at: new Date(),
      message: String(err?.message || err).slice(0, 2000),
    });
    throw err;
  }
}
