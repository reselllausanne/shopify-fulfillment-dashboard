import { chromium, type Browser, type Page } from "playwright";
import { prisma } from "@/app/lib/prisma";
import { validateGtin, normalizeSize } from "@/app/lib/normalize";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
import { runImageSync } from "@/galaxus/jobs/imageSync";
import {
  extractVariantGtin,
  fetchStockxProductByIdOrSlug,
  matchVariantsBySize,
  searchStockxProducts,
} from "@/galaxus/kickdb/client";
import type { ScraperShop } from "@/app/lib/scraperShops";
import { runKickdbEnrichMissing } from "@/galaxus/kickdb/enrichMissingJob";
import { startRun, hasRunningRun, recoverStaleRuns } from "@/app/lib/shopifyScrape";
import { scraperQuery } from "@/app/lib/scraperDb";

export { startRun, hasRunningRun, recoverStaleRuns };

const USER_AGENT =
  process.env.SCRAPER_USER_AGENT ||
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REQUEST_DELAY_MS = Number(process.env.SCRAPER_REQUEST_DELAY_MS || 120);
const DEFAULT_STOCK = Math.max(1, Number(process.env.SCRAPER_DEFAULT_STOCK || 5));
const IMAGE_SYNC_CONCURRENCY = Math.max(1, Number(process.env.SCRAPER_IMAGE_SYNC_CONCURRENCY || 5));
const HHV_CATALOG_PATH =
  process.env.SCRAPER_HHV_CATALOG_PATH || "/clothing/katalog/filter/sneaker-N418";
const HHV_MAX_CATALOG_PAGES = Math.max(1, Number(process.env.SCRAPER_HHV_MAX_CATALOG_PAGES || 14));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type HhvSizeVariant = {
  sku: string;
  label: string;
  available: boolean;
};

export type HhvProductMeta = {
  name: string;
  brand: string | null;
  mpn: string | null;
  image: string | null;
  category: string | null;
  price: number | null;
  priceCurrency: string | null;
  pageGtin: string | null;
  gender: string | null;
  weightGrams: number | null;
};

export type HhvLandedCost = {
  sourcePriceChf: number;
  shippingChf: number;
  feeChf: number;
  feePercent: number;
  feeFlatChf: number;
  landedPriceChf: number;
};

export type HhvEligibleRecord = {
  supplierVariantId: string;
  gtin: string | null;
  providerKey: string | null;
  mappingStatus: "SUPPLIER_GTIN" | "PENDING_GTIN";
  price: number;
  supplierSku: string;
  supplierBrand: string | null;
  supplierProductName: string | null;
  supplierProductType: string | null;
  supplierGender: string | null;
  sizeRaw: string | null;
  weightGrams: number | null;
  sourceImageUrl: string | null;
  available: boolean;
  manualNote: string;
};

function normalizeBarcode(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value).trim();
  if (!s || s.toLowerCase() === "null") return "";
  const digits = s.replace(/\D/g, "");
  if (validateGtin(digits) && !/^0+$/.test(digits)) return digits;
  return "";
}

function offerPrice(offers: unknown): number | null {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const offer of list) {
    const raw = (offer as { price?: unknown })?.price;
    const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function offerCurrency(offers: unknown): string | null {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const offer of list) {
    const raw = String((offer as { priceCurrency?: string })?.priceCurrency ?? "").trim();
    if (raw) return raw.toUpperCase();
  }
  return null;
}

export function extractWeightGrams(html: string): number | null {
  const match = html.match(/Gewicht:[\s\S]{0,40}?(\d+)\s*g/i);
  if (!match?.[1]) return null;
  const grams = Number.parseInt(match[1], 10);
  return Number.isFinite(grams) && grams > 0 ? grams : null;
}

/** Landed buy cost = HHV CHF shelf price + configurable shipping + fees. */
export function computeHhvLandedCost(sourcePriceChf: number): HhvLandedCost {
  const shippingChf = Math.max(0, Number(process.env.SCRAPER_HHV_SHIPPING_CHF || 0));
  const feePercent = Math.max(0, Number(process.env.SCRAPER_HHV_FEE_PERCENT || 0));
  const feeFlatChf = Math.max(0, Number(process.env.SCRAPER_HHV_FEE_FLAT_CHF || 0));
  const feeChf = Math.round((sourcePriceChf * (feePercent / 100) + feeFlatChf) * 100) / 100;
  const landedPriceChf = Math.round((sourcePriceChf + shippingChf + feeChf) * 100) / 100;
  return { sourcePriceChf, shippingChf, feeChf, feePercent, feeFlatChf, landedPriceChf };
}

export function formatHhvCostNote(
  cost: HhvLandedCost,
  extra: {
    mpn?: string | null;
    currency?: string | null;
    productUrl?: string | null;
    pageGtin?: string | null;
    gtinSource?: string | null;
    hhvSku?: string | null;
  }
): string {
  return JSON.stringify({
    type: "hhv_landed_cost",
    ...cost,
    mpn: extra.mpn ?? null,
    pageGtin: extra.pageGtin ?? null,
    gtinSource: extra.gtinSource ?? null,
    hhvSku: extra.hhvSku ?? null,
    currency: extra.currency ?? "CHF",
    productUrl: extra.productUrl ?? null,
  });
}

export function extractProductFromJsonLd(html: string): HhvProductMeta | null {
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  for (const match of scripts) {
    try {
      const parsed = JSON.parse(match[1]);
      const graph = Array.isArray(parsed?.["@graph"]) ? parsed["@graph"] : [parsed];
      const product = graph.find((node) => node?.["@type"] === "Product");
      if (!product) continue;
      const brand =
        typeof product.brand === "object"
          ? String(product.brand?.name ?? "").trim() || null
          : String(product.brand ?? "").trim() || null;
      const audience = product.audience as { suggestedGender?: string } | undefined;
      return {
        name: String(product.name ?? product.model ?? "").trim(),
        brand,
        mpn: String(product.mpn ?? "").trim() || null,
        image: String(product.image ?? "").trim() || null,
        category: String(product.category ?? "").trim() || null,
        price: offerPrice(product.offers),
        priceCurrency: offerCurrency(product.offers),
        pageGtin: normalizeBarcode(product.gtin) || null,
        gender: audience?.suggestedGender ? String(audience.suggestedGender) : null,
        weightGrams: extractWeightGrams(html),
      };
    } catch {
      /* try next script */
    }
  }
  return null;
}

export function extractSizeVariants(html: string): HhvSizeVariant[] {
  const out: HhvSizeVariant[] = [];
  const re =
    /<div class="size([^"]*)"[^>]*data-value="([^"]+)"[^>]*>[\s\S]*?<span class="title">([^<]+)<\/span>/gi;
  for (const match of html.matchAll(re)) {
    const cls = match[1] || "";
    const sku = match[2]?.trim();
    const label = match[3]?.trim();
    if (!sku || !label) continue;
    out.push({
      sku,
      label,
      available: !/\binactive\b/.test(cls),
    });
  }
  return out;
}

export function isHhvSneakerProduct(meta: HhvProductMeta | null): boolean {
  if (!meta) return false;
  const category = String(meta.category ?? "").toLowerCase();
  return category.includes("sneaker") || category.includes("schuhe > sneaker");
}

function catalogPageUrl(baseUrl: string, page: number): string {
  const path = page <= 1 ? HHV_CATALOG_PATH : `${HHV_CATALOG_PATH}P${page}`;
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

async function dismissCookieBanner(page: Page): Promise<void> {
  const accept = page.locator('button:has-text("Akzeptieren")').first();
  if (await accept.isVisible({ timeout: 1500 }).catch(() => false)) {
    await accept.click({ timeout: 3000 }).catch(() => undefined);
    await sleep(300);
  }
}

async function collectCatalogProductUrls(page: Page, baseUrl: string, maxProducts?: number): Promise<string[]> {
  const urls = new Set<string>();
  const articleRe = /\/clothing\/artikel\/[a-z0-9-]+-\d+/i;

  for (let pageNum = 1; pageNum <= HHV_MAX_CATALOG_PAGES; pageNum++) {
    await page.goto(catalogPageUrl(baseUrl, pageNum), { waitUntil: "domcontentloaded", timeout: 90_000 });
    await dismissCookieBanner(page);
    await sleep(REQUEST_DELAY_MS);

    let lastCount = 0;
    for (let scroll = 0; scroll < 30; scroll++) {
      await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight, 900)));
      await sleep(350);
      const batch = await page.evaluate(() =>
        [...document.querySelectorAll('a[href*="/clothing/artikel/"]')]
          .map((a) => (a as HTMLAnchorElement).href.split("?")[0])
          .filter(Boolean)
      );
      for (const href of batch) {
        if (articleRe.test(href)) urls.add(href);
      }
      if (urls.size === lastCount && scroll > 4) break;
      lastCount = urls.size;
      if (maxProducts && urls.size >= maxProducts) break;
    }

    if (maxProducts && urls.size >= maxProducts) break;
    if (pageNum > 1 && lastCount === 0) break;
  }

  const list = [...urls];
  return maxProducts ? list.slice(0, maxProducts) : list;
}

type KickdbVariantList = NonNullable<Awaited<ReturnType<typeof fetchStockxProductByIdOrSlug>>["variants"]>;
type KickdbVariantCache = Map<string, KickdbVariantList>;

function kickdbEnabled(): boolean {
  return String(process.env.SCRAPER_HHV_KICKDB || "0").trim() === "1" && Boolean(String(process.env.KICKDB_API_KEY || "").trim());
}

export function styleCodeCandidates(mpn: string | null | undefined): string[] {
  const trimmed = String(mpn ?? "").trim().toUpperCase();
  if (!trimmed) return [];
  const out = new Set<string>([trimmed, trimmed.replace(/-/g, ""), trimmed.replace(/[^A-Z0-9]/g, "")]);
  return [...out].filter(Boolean);
}

/** HHV size labels use unicode fractions (37⅓) — normalize for cross-supplier match. */
export function hhvSizeTokens(label: string | null | undefined): Set<string> {
  const tokens = new Set<string>();
  const raw = String(label ?? "")
    .replace(/\u00A0/g, " ")
    .replace(/⅓/g, " 1/3")
    .replace(/⅔/g, " 2/3")
    .trim();
  if (!raw) return tokens;

  const normalized = normalizeSize(raw);
  if (normalized) tokens.add(normalized);

  const frac = raw.match(/(\d+)\s*(1\/3|2\/3)/i);
  if (frac) {
    const base = Number(frac[1]);
    const dec = frac[2].toLowerCase() === "1/3" ? base + 1 / 3 : base + 2 / 3;
    tokens.add(dec.toFixed(2));
    tokens.add(dec.toFixed(1));
    return tokens;
  }

  const numeric = raw.match(/(\d+(?:\.\d+)?)/);
  if (numeric?.[1]) tokens.add(numeric[1]);

  return tokens;
}

export function sizesMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = hhvSizeTokens(left);
  const b = hhvSizeTokens(right);
  if (!a.size || !b.size) return false;
  for (const token of a) {
    if (b.has(token)) return true;
  }
  return false;
}

export type StyleGtinRow = {
  styleCode: string;
  sizeRaw: string | null;
  gtin: string;
};

export function buildStyleGtinIndex(rows: StyleGtinRow[]): Map<string, StyleGtinRow[]> {
  const index = new Map<string, StyleGtinRow[]>();
  for (const row of rows) {
    const gtin = normalizeBarcode(row.gtin);
    if (!gtin) continue;
    for (const code of styleCodeCandidates(row.styleCode)) {
      const list = index.get(code) ?? [];
      list.push({ ...row, gtin });
      index.set(code, list);
    }
  }
  return index;
}

/** Match HHV MPN + EU size against existing supplier rows (STX/Golden barcode, WEL, etc.). */
export function resolveGtinsFromStyleIndex(
  meta: HhvProductMeta,
  sizes: HhvSizeVariant[],
  index: Map<string, StyleGtinRow[]>
): Map<string, string> {
  const gtinBySku = new Map<string, string>();
  if (!meta.mpn) return gtinBySku;

  let rows: StyleGtinRow[] = [];
  for (const code of styleCodeCandidates(meta.mpn)) {
    const hit = index.get(code);
    if (hit?.length) {
      rows = hit;
      break;
    }
  }
  if (!rows.length) return gtinBySku;

  for (const size of sizes) {
    for (const row of rows) {
      if (!sizesMatch(size.label, row.sizeRaw)) continue;
      const gtin = normalizeBarcode(row.gtin);
      if (gtin) {
        gtinBySku.set(size.sku, gtin);
        break;
      }
    }
  }
  return gtinBySku;
}

async function loadStyleGtinIndex(): Promise<Map<string, StyleGtinRow[]>> {
  const rows = await prisma.$queryRaw<Array<{ styleCode: string | null; sizeRaw: string | null; gtin: string | null }>>`
    SELECT TRIM("supplierSku") AS "styleCode", "sizeRaw", "gtin"
    FROM "public"."SupplierVariant"
    WHERE "gtin" IS NOT NULL
      AND TRIM("supplierSku") <> ''
      AND "supplierVariantId" NOT ILIKE 'hhv_%'
  `;
  return buildStyleGtinIndex(
    rows
      .map((row) => ({
        styleCode: String(row.styleCode ?? "").trim(),
        sizeRaw: row.sizeRaw ?? null,
        gtin: String(row.gtin ?? "").trim(),
      }))
      .filter((row) => row.styleCode && row.gtin)
  );
}

function mergeGtinResolutions(
  sizes: HhvSizeVariant[],
  meta: HhvProductMeta,
  sources: Array<{ map: Map<string, string>; source: string }>
): { gtinBySku: Map<string, string>; sourceBySku: Map<string, string> } {
  const gtinBySku = new Map<string, string>();
  const sourceBySku = new Map<string, string>();

  for (const size of sizes) {
    for (const { map, source } of sources) {
      const gtin = normalizeBarcode(map.get(size.sku));
      if (!gtin) continue;
      gtinBySku.set(size.sku, gtin);
      sourceBySku.set(size.sku, source);
      break;
    }
    if (!gtinBySku.has(size.sku) && sizes.length === 1 && meta.pageGtin) {
      const pageGtin = normalizeBarcode(meta.pageGtin);
      if (pageGtin) {
        gtinBySku.set(size.sku, pageGtin);
        sourceBySku.set(size.sku, "hhv_page");
      }
    }
  }

  return { gtinBySku, sourceBySku };
}

/** KickDB search strings from HHV MPN + product title (HHV page GTIN is colorway-only). */
export function buildKickdbSearchQueries(meta: HhvProductMeta): string[] {
  const queries: string[] = [];
  const mpn = String(meta.mpn ?? "").trim();
  if (mpn) {
    queries.push(mpn);
    const normalizedMpn = mpn.replace(/[-_/]+/g, " ").trim();
    if (normalizedMpn !== mpn) queries.push(normalizedMpn);
  }

  const brand = String(meta.brand ?? "").trim();
  let model = String(meta.name ?? "").trim();
  if (brand && model.toLowerCase().startsWith(brand.toLowerCase())) {
    model = model.slice(brand.length).replace(/^[\s\-–—]+/, "").trim();
  }
  model = model
    .replace(/\s*—.*$/, "")
    .replace(/\s*-\s*EU\s*\d.*$/i, "")
    .replace(/\s*-\s*\d+(\.\d+)?(\s*[⅓⅔])?$/u, "")
    .trim();
  if (brand && model) queries.push(`${brand} ${model}`);
  if (model.length >= 4) queries.push(model);

  return [...new Set(queries.filter(Boolean))];
}

function pickKickdbProductHit(
  hits: Awaited<ReturnType<typeof searchStockxProducts>>["data"],
  brand: string | null,
  productName: string
) {
  const brandLower = String(brand ?? "").toLowerCase();
  return (
    hits.find((h) => {
      const hit = h as { brand?: string | null; title?: string | null };
      return brandLower && String(hit?.brand ?? "").toLowerCase().includes(brandLower);
    }) ??
    hits.find((h) => {
      const hit = h as { title?: string | null };
      const title = String(hit?.title ?? "").toLowerCase();
      const tokens = productName.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
      return tokens.some((t) => title.includes(t));
    }) ??
    hits[0]
  );
}

async function loadKickdbVariants(
  queries: string[],
  brand: string | null,
  productName: string,
  cache: KickdbVariantCache
): Promise<KickdbVariantList> {
  const normalizedQueries = [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
  if (!normalizedQueries.length || !kickdbEnabled()) return [];

  const cacheKey = normalizedQueries[0].toUpperCase();
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? [];

  for (const query of normalizedQueries) {
    let hits: Awaited<ReturnType<typeof searchStockxProducts>>["data"] = [];
    try {
      const response = await searchStockxProducts(query);
      hits = response.data ?? [];
    } catch {
      continue;
    }

    const hit = pickKickdbProductHit(hits, brand, productName);
    const idOrSlug = hit?.id ?? hit?.slug;
    if (!idOrSlug) continue;

    try {
      const product = await fetchStockxProductByIdOrSlug(String(idOrSlug));
      const variants = product.variants ?? [];
      cache.set(cacheKey, variants);
      return variants;
    } catch {
      continue;
    }
  }

  cache.set(cacheKey, []);
  return [];
}

/** HHV HTML has one GTIN/colorway — KickDB resolves per-size GTIN via MPN + EU size. */
export async function resolveGtinsBySku(
  meta: HhvProductMeta,
  sizes: HhvSizeVariant[],
  cache: KickdbVariantCache
): Promise<Map<string, string>> {
  const gtinBySku = new Map<string, string>();
  const queries = buildKickdbSearchQueries(meta);
  if (!queries.length) return gtinBySku;

  const kickdbVariants = await loadKickdbVariants(queries, meta.brand, meta.name, cache);
  if (!kickdbVariants.length) return gtinBySku;

  for (const size of sizes) {
    const matches = matchVariantsBySize(kickdbVariants, size.label, {
      brand: meta.brand,
      gender: meta.gender,
    });
    for (const matched of matches) {
      const gtin = normalizeBarcode(extractVariantGtin(matched));
      if (gtin) {
        gtinBySku.set(size.sku, gtin);
        break;
      }
    }
  }
  return gtinBySku;
}

export function buildEligibleRecords(
  shop: ScraperShop,
  meta: HhvProductMeta,
  sizes: HhvSizeVariant[],
  productUrl: string,
  gtinBySku: Map<string, string> = new Map(),
  gtinSourceBySku: Map<string, string> = new Map()
): HhvEligibleRecord[] {
  const out: HhvEligibleRecord[] = [];
  const baseTitle = meta.name || meta.mpn || "HHV sneaker";
  const productType = meta.category?.split(">").pop()?.trim() || "Sneaker";
  const sourcePrice = meta.price;
  if (!sourcePrice || sourcePrice <= 0) return out;

  const landed = computeHhvLandedCost(sourcePrice);

  for (const size of sizes) {
    // Buy-from id = HHV SKU. DB match = gtin column (per-size via KickDB when possible).
    const supplierVariantId = `${shop.key}_${size.sku}`;
    const sizeSuffix = size.label ? ` — EU ${size.label}` : "";
    const gtin = normalizeBarcode(gtinBySku.get(size.sku)) || null;
    const gtinSource = gtin ? gtinSourceBySku.get(size.sku) ?? null : null;
    const providerKey = gtin ? buildProviderKey(gtin, supplierVariantId) : null;
    const mappingStatus = gtin && providerKey ? "SUPPLIER_GTIN" : "PENDING_GTIN";
    const manualNote = formatHhvCostNote(landed, {
      mpn: meta.mpn,
      pageGtin: meta.pageGtin,
      gtinSource,
      hhvSku: size.sku,
      currency: meta.priceCurrency || shop.currency || "CHF",
      productUrl,
    });

    out.push({
      supplierVariantId,
      gtin,
      providerKey,
      mappingStatus,
      price: landed.landedPriceChf,
      supplierSku: size.sku,
      supplierBrand: meta.brand,
      supplierProductName: `${baseTitle}${sizeSuffix}`,
      supplierProductType: productType,
      supplierGender: meta.gender,
      sizeRaw: size.label,
      weightGrams: meta.weightGrams,
      sourceImageUrl: meta.image,
      available: size.available,
      manualNote,
    });
  }
  return out;
}

async function updateRun(runId: number, fields: Record<string, unknown>) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  await scraperQuery(`UPDATE scraper.scrape_runs SET ${sets} WHERE id = $1`, [runId, ...keys.map((k) => fields[k])]);
}

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

/** HHV sneaker scrape — discover styles on HHV, resolve GTIN via DB MPN+size match (not StockX). */
export async function scrapeHhvShop(shop: ScraperShop, runId: number, maxProducts?: number): Promise<void> {
  const prismaAny = prisma as any;
  let processed = 0;
  let parseErrors = 0;
  let wrote = 0;
  let gtinMatched = 0;
  let lastFlushAt = 0;
  const FLUSH_EVERY = 25;
  const seenSkus = new Set<string>();
  const imageSyncQueue = new Set<string>();
  const kickdbCache: KickdbVariantCache = new Map();
  const styleIndex = await loadStyleGtinIndex();
  let dbGtinMatched = 0;
  let kickdbGtinMatched = 0;

  let browser: Browser | null = null;

  const flushProgress = async () => {
    await updateRun(runId, {
      with_gtin: gtinMatched,
      variants_upserted: wrote,
      errors: parseErrors,
    });
  };

  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      locale: "de-CH",
      extraHTTPHeaders: { "Accept-Language": "de-CH,de;q=0.9,fr-CH;q=0.8,en;q=0.7" },
    });
    const catalogPage = await context.newPage();

    const productUrls = await collectCatalogProductUrls(catalogPage, shop.baseUrl, maxProducts);
    await catalogPage.close();
    await updateRun(runId, { products_listed: productUrls.length });

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

    const productPage = await context.newPage();
    for (const url of productUrls) {
      try {
        await productPage.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
        await dismissCookieBanner(productPage);
        await sleep(REQUEST_DELAY_MS);
        const html = await productPage.content();
        const meta = extractProductFromJsonLd(html);
        if (!meta || !isHhvSneakerProduct(meta)) continue;

        const sizes = extractSizeVariants(html);
        if (!sizes.length) continue;

        const dbGtins = resolveGtinsFromStyleIndex(meta, sizes, styleIndex);
        const kickdbGtins = kickdbEnabled()
          ? await resolveGtinsBySku(meta, sizes, kickdbCache)
          : new Map<string, string>();
        const { gtinBySku, sourceBySku } = mergeGtinResolutions(sizes, meta, [
          { map: dbGtins, source: "db_match" },
          { map: kickdbGtins, source: "kickdb" },
        ]);
        for (const source of sourceBySku.values()) {
          if (source === "db_match") dbGtinMatched++;
          if (source === "kickdb") kickdbGtinMatched++;
        }
        const records = buildEligibleRecords(shop, meta, sizes, url, gtinBySku, sourceBySku);
        const now = new Date();

        for (const r of records) {
          if (seenSkus.has(r.supplierVariantId)) continue;
          seenSkus.add(r.supplierVariantId);
          if (r.gtin) gtinMatched++;
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
                sizeRaw: r.sizeRaw,
                weightGrams: r.weightGrams,
                supplierBrand: r.supplierBrand,
                supplierProductName: r.supplierProductName,
                supplierProductType: r.supplierProductType,
                supplierGender: r.supplierGender,
                sourceImageUrl: r.sourceImageUrl,
                manualNote: r.manualNote,
                imageSyncStatus: r.sourceImageUrl ? "PENDING" : null,
                lastSyncAt: now,
              },
              update: {
                supplierSku: r.supplierSku,
                providerKey: r.providerKey,
                gtin: r.gtin,
                price: r.price,
                stock,
                sizeRaw: r.sizeRaw,
                weightGrams: r.weightGrams,
                supplierBrand: r.supplierBrand,
                supplierProductName: r.supplierProductName,
                supplierProductType: r.supplierProductType,
                supplierGender: r.supplierGender,
                sourceImageUrl: r.sourceImageUrl,
                manualNote: r.manualNote,
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
                status: r.mappingStatus,
              },
              update: {
                gtin: r.gtin,
                providerKey: r.providerKey,
                supplierKey: shop.key,
                status: r.mappingStatus,
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
            /* per-variant best effort */
          }
        }
      } catch {
        parseErrors++;
      }

      processed++;
      if (processed - lastFlushAt >= FLUSH_EVERY) {
        lastFlushAt = processed;
        await flushProgress();
      }
    }

    await productPage.close();
    await context.close();

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

    void runImageSync({
      supplierKeys: [shop.key],
      full: true,
      limit: 500,
      concurrency: 8,
    }).catch((e) => {
      console.error(`[SCRAPER] ${shop.key} image backfill failed:`, e?.message || e);
    });

    let enrichProcessed = 0;
    let enrichRows = 0;
    let enrichErrors = 0;
    if (kickdbEnabled()) {
      const enrichResult = await runKickdbEnrichMissing({
        supplierVariantIdPrefix: `${shop.key}_`,
        limit: 5000,
        concurrency: 5,
        force: true,
        respectRecentRun: false,
        includeNotFound: true,
      });
      enrichProcessed = enrichResult.processed;
      enrichRows = enrichResult.enrichedRows;
      enrichErrors = enrichResult.enrichErrors;
    }

    const withGtinCount = await prismaAny.supplierVariant.count({
      where: {
        supplierVariantId: { startsWith: `${shop.key}_` },
        gtin: { not: null },
      },
    });
    gtinMatched = withGtinCount;

    await updateRun(runId, {
      status: "ok",
      finished_at: new Date(),
      variants_upserted: wrote,
      with_gtin: gtinMatched,
      errors: parseErrors,
      message: `purpose=gtin_discovery catalog=${productUrls.length} processed=${processed} wrote=${wrote} gtin_matched=${gtinMatched} db_style_index=${styleIndex.size} db_gtin_hits=${dbGtinMatched} kickdb_gtin_hits=${kickdbGtinMatched} kickdb_styles=${kickdbCache.size} enrich_pass processed=${enrichProcessed} enriched=${enrichRows} enrich_errors=${enrichErrors} errors=${parseErrors} images_queued=${imageSyncQueue.size} images_synced=${imageSynced} images_failed=${imageFailed}`,
    });
  } catch (err: any) {
    await updateRun(runId, {
      status: "error",
      finished_at: new Date(),
      message: String(err?.message || err).slice(0, 2000),
    });
    throw err;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
