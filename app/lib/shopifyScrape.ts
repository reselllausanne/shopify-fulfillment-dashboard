import { prisma } from "@/app/lib/prisma";
import { scraperQuery } from "@/app/lib/scraperDb";
import { validateGtin } from "@/app/lib/normalize";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
import type { ScraperShop } from "@/app/lib/scraperShops";

const USER_AGENT =
  process.env.SCRAPER_USER_AGENT || "LivioShopifyScraper/1.0 (+catalog sync)";
const JS_CONCURRENCY = Math.max(1, Number(process.env.SCRAPER_JS_WORKERS || 3));
const REQUEST_DELAY_MS = Number(process.env.SCRAPER_REQUEST_DELAY_MS || 120);
const DEFAULT_STOCK = Math.max(1, Number(process.env.SCRAPER_DEFAULT_STOCK || 5));
const WRITE_CONCURRENCY = 10;

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

async function getJson(url: string, retries = 5): Promise<any> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
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
        const ra = Number(res.headers.get("retry-after") || 0);
        const wait = Math.max(ra * 1000, Math.min(3000 * 2 ** attempt, 90_000));
        await sleep(wait);
        lastErr = new Error("429");
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (REQUEST_DELAY_MS) await sleep(REQUEST_DELAY_MS);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(Math.min(3000 * 2 ** attempt, 60_000));
    }
  }
  throw new Error(`GET failed ${url}: ${lastErr}`);
}

async function listProducts(baseUrl: string, maxProducts?: number): Promise<any[]> {
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
    if (added === 0 || batch.length < 250) break;
    page++;
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
  sourceImageUrl: string | null;
  available: boolean;
};

function collectEligibleRecords(shop: ScraperShop, product: any, productJs: any): EligibleRecord[] {
  const out: EligibleRecord[] = [];
  const title = product?.title || "";
  const brand = product?.vendor || "";
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
    let available = variant?.available;
    if (available === null || available === undefined) available = jsV?.available;
    available = Boolean(available);
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

  const flushProgress = async () => {
    await updateRun(runId, {
      with_gtin: seenGtins.size,
      variants_upserted: wrote,
      errors: jsErrors,
    });
  };

  try {
    const listed = await listProducts(shop.baseUrl, maxProducts);
    await updateRun(runId, { products_listed: listed.length });

    const handles = listed.filter((p) => p?.handle);

    // Enrich + write per product. Upserts are idempotent (keyed by supplierVariantId),
    // so writing as we go is safe and survives crashes with partial data committed.
    await runPool(handles, JS_CONCURRENCY, async (product) => {
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
              sourceImageUrl: r.sourceImageUrl,
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
              sourceImageUrl: r.sourceImageUrl,
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

    await updateRun(runId, {
      status: "ok",
      finished_at: new Date(),
      variants_upserted: wrote,
      with_gtin: seenGtins.size,
      errors: jsErrors,
      message: `listed=${listed.length} processed=${processed} wrote=${wrote} js_errors=${jsErrors}`,
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
