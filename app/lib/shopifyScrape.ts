import { prisma } from "@/app/lib/prisma";
import { scraperQuery } from "@/app/lib/scraperDb";
import { validateGtin } from "@/app/lib/normalize";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
import { runImageSync } from "@/galaxus/jobs/imageSync";
import type { ScraperShop } from "@/app/lib/scraperShops";

const USER_AGENT =
  process.env.SCRAPER_USER_AGENT || "LivioShopifyScraper/1.0 (+catalog sync)";
const DEFAULT_STOCK = Math.max(1, Number(process.env.SCRAPER_DEFAULT_STOCK || 5));

function shopifyScrapeConfig() {
  return {
    jsConcurrency: Math.max(1, Number(process.env.SCRAPER_JS_WORKERS || 2)),
    requestDelayMs: Math.max(0, Number(process.env.SCRAPER_REQUEST_DELAY_MS || 250)),
    listPageDelayMs: Math.max(0, Number(process.env.SCRAPER_SHOPIFY_LIST_DELAY_MS || 800)),
    maxRetries: Math.max(5, Number(process.env.SCRAPER_SHOPIFY_MAX_RETRIES || 20)),
    max429WaitMs: Math.max(10_000, Number(process.env.SCRAPER_SHOPIFY_429_MAX_WAIT_MS || 300_000)),
  };
}
const WRITE_CONCURRENCY = 10;
const IMAGE_SYNC_CONCURRENCY = Math.max(1, Number(process.env.SCRAPER_IMAGE_SYNC_CONCURRENCY || 5));

type ExistingVariantImage = {
  sourceImageUrl: string | null;
  hostedImageUrl: string | null;
  imageSyncStatus: string | null;
};

type ExistingVariantRow = ExistingVariantImage & { supplierVariantId: string };

function needsImageHosting(
  existing: ExistingVariantImage | undefined,
  sourceImageUrl: string | null
): boolean {
  if (!sourceImageUrl) return false;
  if (!existing) return true;
  const prevSource = String(existing.sourceImageUrl ?? "").trim();
  return prevSource !== sourceImageUrl.trim();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function normalizeBarcode(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value).trim();
  if (!s || s.toLowerCase() === "null") return "";
  const digits = s.replace(/\D/g, "");
  if (validateGtin(digits) && !/^0+$/.test(digits)) return digits;
  return "";
}

function priceFrom(jsV: any, listV: any): number | null {
  if (typeof jsV?.price === "number") return Math.round(jsV.price) / 100;
  const raw = listV?.price;
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number.parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

function pickImage(product: any, variant: any): string {
  let src = "";
  const featured = variant?.featured_image;
  if (featured && typeof featured === "object" && featured.src) src = featured.src;
  else if (typeof featured === "string" && featured) src = featured;
  else {
    const images = product?.images || [];
    if (images.length) src = typeof images[0] === "object" ? images[0]?.src : String(images[0]);
    else if (product?.image) src = typeof product.image === "object" ? product.image?.src || "" : String(product.image);
  }
  if (src && src.startsWith("//")) src = "https:" + src;
  return src || "";
}

async function getJson(url: string): Promise<any> {
  const cfg = shopifyScrapeConfig();
  let lastErr: unknown = null;
  let rateLimitHits = 0;
  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json,text/javascript,*/*",
          "Accept-Language": "de-CH,de;q=0.9,en;q=0.8",
        },
        signal: AbortSignal.timeout(45_000),
      });
      if (res.status === 429) {
        rateLimitHits++;
        const ra = Number(res.headers.get("retry-after") || 0);
        const wait = Math.min(
          cfg.max429WaitMs,
          Math.max(ra * 1000, 5000 * Math.pow(1.4, rateLimitHits))
        );
        console.warn(`[SCRAPER] Shopify 429 on ${url} — waiting ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        lastErr = new Error("429");
        attempt--;
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (cfg.requestDelayMs) await sleep(cfg.requestDelayMs);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(Math.min(3000 * 2 ** attempt, 60_000));
    }
  }
  throw new Error(`GET failed ${url}: ${lastErr}`);
}

async function listProducts(
  baseUrl: string,
  maxProducts?: number,
  onPage?: (page: number, listed: number) => void | Promise<void>
): Promise<any[]> {
  const cfg = shopifyScrapeConfig();
  const products: any[] = [];
  const seen = new Set<number>();
  let page = 1;
  for (;;) {
    const data = await getJson(`${baseUrl}/products.json?limit=250&page=${page}`);
    const batch: any[] = data?.products || [];
    if (!batch.length) break;
    let added = 0;
    for (const p of batch) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      products.push(p);
      added++;
      if (maxProducts && products.length >= maxProducts) return products;
    }
    await onPage?.(page, products.length);
    if (added === 0 || batch.length < 250) break;
    page++;
    if (cfg.listPageDelayMs) await sleep(cfg.listPageDelayMs);
  }
  return products;
}

type EligibleRecord = {
  gtin: string;
  supplierVariantId: string;
  providerKey: string;
  price: number;
  supplierSku: string;
  supplierBrand: string | null;
  supplierProductName: string | null;
  supplierProductType: string | null;
  sourceImageUrl: string | null;
  available: boolean;
};

/** Normalize Shopify tags from products.json (string) or .js (array). */
export function shopifyProductTags(product: any, productJs: any): string[] {
  const raw = productJs?.tags ?? product?.tags ?? [];
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean);
  return String(raw)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Preorder / coming-soon signals in tags or title.
 * WellPlayed rarely tags these; continue-policy OOS is the main path (see resolveShopifyAvailable).
 */
export function isShopifyPreorderSignal(product: any, productJs: any, variant: any, jsV: any): boolean {
  const tags = shopifyProductTags(product, productJs).map((t) => t.toLowerCase());
  const title = String(productJs?.title ?? product?.title ?? "").toLowerCase();
  const vtitle = String(jsV?.title ?? variant?.title ?? "").toLowerCase();
  const blob = [...tags, title, vtitle].join(" ");
  return /\bpre-?orders?\b|\bvorbestell|\bvorverkauf|\bcoming\s*soon\b/.test(blob);
}

export function resolveShopifyInventoryQty(variant: any, jsV: any): number | null {
  const raw = jsV?.inventory_quantity ?? variant?.inventory_quantity;
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function shopifyAvailableFlag(variant: any, jsV: any): boolean {
  let available = variant?.available;
  if (available === null || available === undefined) available = jsV?.available;
  return Boolean(available);
}

function shopifyInventoryManagement(variant: any, jsV: any): {
  present: boolean;
  value: string | null;
} {
  const fromJs = jsV != null && Object.prototype.hasOwnProperty.call(jsV, "inventory_management");
  const fromList =
    variant != null && Object.prototype.hasOwnProperty.call(variant, "inventory_management");
  if (!fromJs && !fromList) return { present: false, value: null };
  const raw = fromJs ? jsV.inventory_management : variant.inventory_management;
  if (raw === null || raw === undefined || raw === "") return { present: true, value: null };
  return { present: true, value: String(raw) };
}

/**
 * Sellable stock for Galaxus / catalog.
 *
 * Shopify `available:true` with `inventory_policy:"continue"` + `inventory_quantity:0`
 * means oversell / backorder — NOT physical stock. products.json list omits qty;
 * .js has it. Tracked inventory → require qty > 0. Explicitly untracked → trust available.
 * Missing .js (no qty / no mgmt) → not sellable. Preorder tags/title → not sellable.
 */
export function resolveShopifyAvailable(
  product: any,
  productJs: any,
  variant: any,
  jsV: any
): boolean {
  if (isShopifyPreorderSignal(product, productJs, variant, jsV)) return false;

  const qty = resolveShopifyInventoryQty(variant, jsV);
  const mgmt = shopifyInventoryManagement(variant, jsV);

  // Explicitly untracked inventory: Shopify keeps qty at 0 and available:true.
  if (mgmt.present && !mgmt.value) return shopifyAvailableFlag(variant, jsV);

  // Tracked (e.g. "shopify") or management unknown (list-only / .js failed):
  // only sell when we have a positive quantity from .js.
  if (qty !== null) return qty > 0;
  return false;
}

/** Exported for unit tests. */
export function collectEligibleRecords(shop: ScraperShop, product: any, productJs: any): EligibleRecord[] {
  const out: EligibleRecord[] = [];
  const title = product?.title || "";
  const brand = product?.vendor || "";
  const productType = String(product?.product_type ?? productJs?.type ?? "").trim() || null;
  const jsById = new Map<string, any>();
  for (const v of productJs?.variants || []) jsById.set(String(v?.id), v);
  const imgSource = productJs && Object.keys(productJs).length ? productJs : product;

  for (const variant of product?.variants || []) {
    const vid = String(variant?.id || "");
    const jsV = jsById.get(vid) || {};
    const gtin = normalizeBarcode(jsV.barcode) || normalizeBarcode(variant?.barcode);
    if (!gtin) continue; // galaxus needs GTIN
    const price = priceFrom(jsV, variant);
    if (!price || price <= 0) continue;
    const available = resolveShopifyAvailable(product, productJs, variant, jsV);
    const vtitle = variant?.title && variant.title !== "Default Title" ? variant.title : "";
    const fullTitle = vtitle ? `${title} — ${vtitle}` : title;
    const sku = String((jsV?.sku ?? variant?.sku) || "").trim();

    const supplierVariantId = `${shop.key}_${gtin}`;
    const providerKey = buildProviderKey(gtin, supplierVariantId);
    if (!providerKey) continue;

    out.push({
      gtin,
      supplierVariantId,
      providerKey,
      price,
      supplierSku: sku || gtin,
      supplierBrand: brand || null,
      supplierProductName: fullTitle || null,
      supplierProductType: productType,
      sourceImageUrl: pickImage(imgSource, jsV.id ? jsV : variant) || null,
      available,
    });
  }
  return out;
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let idx = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await worker(items[i]);
    }
  });
  await Promise.all(runners);
}

async function ensureShopRow(shop: ScraperShop) {
  await scraperQuery(
    `INSERT INTO scraper.shops (id, name, base_url, enabled)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, base_url = EXCLUDED.base_url, enabled = TRUE`,
    [shop.key, shop.name, shop.baseUrl]
  );
}

export async function startRun(shop: ScraperShop): Promise<number> {
  await ensureShopRow(shop);
  const rows = await scraperQuery<{ id: string }>(
    `INSERT INTO scraper.scrape_runs (shop_id, status) VALUES ($1, 'running') RETURNING id`,
    [shop.key]
  );
  return Number(rows[0].id);
}

/** Mark runs stuck in 'running' longer than maxAgeMin as errored (crash recovery). */
export async function recoverStaleRuns(maxAgeMin = 20): Promise<void> {
  try {
    await scraperQuery(
      `UPDATE scraper.scrape_runs
         SET status = 'error', finished_at = NOW(),
             message = COALESCE(message, '') || ' [auto-recovered: stale run]'
       WHERE status = 'running'
         AND started_at < NOW() - make_interval(mins => $1::int)`,
      [maxAgeMin]
    );
  } catch {
    /* best-effort */
  }
}

/** After process/container restart, in-memory scrapes are gone — clear orphan `running` rows. */
export async function recoverOrphanedRuns(): Promise<number> {
  try {
    const rows = await scraperQuery<{ id: string }>(
      `UPDATE scraper.scrape_runs
         SET status = CASE
               WHEN COALESCE(variants_upserted, 0) > 0 THEN 'interrupted'
               ELSE 'error'
             END,
             finished_at = NOW(),
             message = COALESCE(message, '') || ' [auto-recovered: process restart]'
       WHERE status = 'running'
       RETURNING id`
    );
    return rows.length;
  } catch {
    return 0;
  }
}

export async function hasRunningRun(shopKey: string): Promise<boolean> {
  const rows = await scraperQuery<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM scraper.scrape_runs WHERE shop_id = $1 AND status = 'running'`,
    [shopKey]
  );
  return Number(rows[0]?.n || 0) > 0;
}

async function updateRun(runId: number, fields: Record<string, unknown>) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  await scraperQuery(
    `UPDATE scraper.scrape_runs SET ${sets} WHERE id = $1`,
    [runId, ...keys.map((k) => fields[k])]
  );
}

/** Full scrape of one shop → writes eligible (GTIN) variants into the main catalog. */
export async function scrapeShop(shop: ScraperShop, runId: number, maxProducts?: number): Promise<void> {
  const prismaAny = prisma as any;
  // Incremental counters — flushed to the run row periodically so progress is
  // visible live and a crash/restart never loses more than the last batch.
  let processed = 0;
  let jsErrors = 0;
  let wrote = 0;
  let lastFlushAt = 0;
  const FLUSH_EVERY = 50; // products between run-row progress flushes
  const seenGtins = new Set<string>();
  const imageSyncQueue = new Set<string>();

  const flushProgress = async () => {
    await updateRun(runId, {
      with_gtin: seenGtins.size,
      variants_upserted: wrote,
      errors: jsErrors,
    });
  };

  try {
    const listed = await listProducts(shop.baseUrl, maxProducts, async (page, count) => {
      await updateRun(runId, {
        products_listed: count,
        message: `listing page ${page} (${count} products)`,
      });
    });
    await updateRun(runId, { products_listed: listed.length, message: `listed ${listed.length} products` });

    const handles = listed.filter((p) => p?.handle);

    const existingRows = (await prismaAny.supplierVariant.findMany({
      where: { supplierVariantId: { startsWith: `${shop.key}_` } },
      select: {
        supplierVariantId: true,
        sourceImageUrl: true,
        hostedImageUrl: true,
        imageSyncStatus: true,
      },
    })) as ExistingVariantRow[];
    const existingById = new Map<string, ExistingVariantImage>(
      existingRows.map((row) => [
        row.supplierVariantId,
        {
          sourceImageUrl: row.sourceImageUrl ?? null,
          hostedImageUrl: row.hostedImageUrl ?? null,
          imageSyncStatus: row.imageSyncStatus ?? null,
        },
      ])
    );

    // Enrich + write per product. Upserts are idempotent (keyed by supplierVariantId),
    // so writing as we go is safe and survives crashes with partial data committed.
    await runPool(handles, shopifyScrapeConfig().jsConcurrency, async (product) => {
      let js: any = null;
      try {
        js = await getJson(`${shop.baseUrl}/products/${product.handle}.js`);
      } catch {
        jsErrors++;
      }
      const productRecords = collectEligibleRecords(shop, product, js);
      const now = new Date();
      for (const r of productRecords) {
        seenGtins.add(r.gtin);
        const stock = r.available ? DEFAULT_STOCK : 0;
        const existing = existingById.get(r.supplierVariantId);
        const queueImage = needsImageHosting(existing, r.sourceImageUrl);
        try {
          await prismaAny.supplierVariant.upsert({
            where: { supplierVariantId: r.supplierVariantId },
            create: {
              supplierVariantId: r.supplierVariantId,
              supplierSku: r.supplierSku,
              providerKey: r.providerKey,
              gtin: r.gtin,
              price: r.price,
              stock,
              supplierBrand: r.supplierBrand,
              supplierProductName: r.supplierProductName,
              supplierProductType: r.supplierProductType,
              sourceImageUrl: r.sourceImageUrl,
              imageSyncStatus: r.sourceImageUrl ? "PENDING" : null,
              lastSyncAt: now,
            },
            update: {
              supplierSku: r.supplierSku,
              providerKey: r.providerKey,
              gtin: r.gtin,
              price: r.price,
              stock,
              supplierBrand: r.supplierBrand,
              supplierProductName: r.supplierProductName,
              supplierProductType: r.supplierProductType,
              sourceImageUrl: r.sourceImageUrl,
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
            where: { supplierVariantId: r.supplierVariantId },
            create: {
              supplierVariantId: r.supplierVariantId,
              gtin: r.gtin,
              providerKey: r.providerKey,
              supplierKey: shop.key,
              status: "SUPPLIER_GTIN",
            },
            update: {
              gtin: r.gtin,
              providerKey: r.providerKey,
              supplierKey: shop.key,
              status: "SUPPLIER_GTIN",
            },
          });
          existingById.set(r.supplierVariantId, {
            sourceImageUrl: r.sourceImageUrl,
            hostedImageUrl: queueImage ? null : existing?.hostedImageUrl ?? null,
            imageSyncStatus: queueImage ? "PENDING" : existing?.imageSyncStatus ?? null,
          });
          if (queueImage) imageSyncQueue.add(r.supplierVariantId);
          wrote++;
        } catch {
          /* best-effort per-variant; don't kill the run */
        }
      }
      processed++;
      if (processed - lastFlushAt >= FLUSH_EVERY) {
        lastFlushAt = processed;
        await flushProgress();
      }
    });

    let imageSynced = 0;
    let imageFailed = 0;
    if (imageSyncQueue.size > 0) {
      const imageResult = await runImageSync({
        supplierVariantIds: [...imageSyncQueue],
        limit: imageSyncQueue.size,
        concurrency: IMAGE_SYNC_CONCURRENCY,
      });
      imageSynced = imageResult.synced;
      imageFailed = imageResult.failed;
    }

    // Backfill any remaining hosted-image backlog for this shop without blocking the run row.
    void runImageSync({
      supplierKeys: [shop.key],
      full: true,
      limit: 500,
      concurrency: 8,
    }).catch((e) => {
      console.error(`[SCRAPER] ${shop.key} image backfill failed:`, e?.message || e);
    });

    if (!shop.gated && wrote > 0) {
      const { scheduleScraperGalaxusFeedPush } = await import("@/app/lib/scraperFeedPush");
      await scheduleScraperGalaxusFeedPush({ shop, wrote, syncImages: true });
    }

    await updateRun(runId, {
      status: "ok",
      finished_at: new Date(),
      variants_upserted: wrote,
      with_gtin: seenGtins.size,
      errors: jsErrors,
      message: `listed=${listed.length} processed=${processed} wrote=${wrote} js_errors=${jsErrors} images_queued=${imageSyncQueue.size} images_synced=${imageSynced} images_failed=${imageFailed}`,
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
