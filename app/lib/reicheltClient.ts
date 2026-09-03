import { validateGtin } from "@/app/lib/normalize";
import { extractReicheltWeightGrams } from "@/app/lib/reicheltPricing";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const DEFAULT_UA =
  process.env.SCRAPER_USER_AGENT ||
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export const REICHELT_SITEMAP_INDEX_URL = "https://www.reichelt.com/ch/fr/sitemap.xml";
export const REICHELT_PRODUCT_SITEMAP_PREFIX = "https://www.reichelt.com/sitemaps/products/products_";
export const REICHELT_CATEGORY_SITEMAP_PREFIX = "https://www.reichelt.com/sitemaps/categories/category_";
/** Category XHR lives on apex domain — `/ch/fr/api/...` 404s. */
export const REICHELT_API_ORIGIN = "https://www.reichelt.com";

export type ReicheltCategorySettings = {
  count: number;
  start: number;
  offset: number;
  categoryId: string;
  sort: string;
};

export type ReicheltListItem = {
  articleId: string;
  name: string | null;
  reicheltSku: string | null;
  brand: string | null;
  priceEur: number | null;
  priceChf: number | null;
  stockStatus: string | null;
  stockText: string | null;
  productUrl: string | null;
  imageUrl: string | null;
};

export type ReicheltTechAttribute = {
  name: string;
  value: string;
};

export type ReicheltProduct = {
  articleId: string;
  reicheltSku: string;
  gtin: string;
  name: string;
  brand: string | null;
  manufacturerPartNo: string | null;
  priceChf: number | null;
  priceEur: number | null;
  weightGrams: number | null;
  stockStatus: string | null;
  stockText: string | null;
  inStock: boolean;
  imageUrl: string | null;
  breadcrumbs: string[];
  productUrl: string;
  descriptionHtml: string | null;
  /** Key/value pairs from `ul.articleAttribute` (FR/DE tech tables). */
  techAttributes: ReicheltTechAttribute[];
};

type CookieJar = Map<string, string>;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterMs(max = 400) {
  return Math.floor(Math.random() * max);
}

function parseMoney(value: unknown): number | null {
  let raw = String(value ?? "").trim();
  if (!raw) return null;
  raw = raw
    .replace(/[\u00a0\u202f\u2009]/g, " ")
    .replace(/[^\d.,' -]/g, "")
    .trim();
  if (!raw) return null;

  // Normalize common thousands separators (spaces / apostrophes) before decimal inference.
  let normalized = raw.replace(/[\s']/g, "");
  const lastDot = normalized.lastIndexOf(".");
  const lastComma = normalized.lastIndexOf(",");

  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSep = lastDot > lastComma ? "." : ",";
    const thousandsSep = decimalSep === "." ? "," : ".";
    normalized = normalized.replace(new RegExp(`\\${thousandsSep}`, "g"), "");
    if (decimalSep === ",") normalized = normalized.replace(/,/g, ".");
  } else if (lastComma >= 0) {
    const decimals = normalized.length - lastComma - 1;
    normalized = decimals >= 1 && decimals <= 2 ? normalized.replace(/,/g, ".") : normalized.replace(/,/g, "");
  } else {
    const dotCount = (normalized.match(/\./g) ?? []).length;
    if (dotCount > 1) {
      const last = normalized.lastIndexOf(".");
      const decimals = normalized.length - last - 1;
      normalized =
        decimals >= 1 && decimals <= 2
          ? `${normalized.slice(0, last).replace(/\./g, "")}.${normalized.slice(last + 1)}`
          : normalized.replace(/\./g, "");
    }
  }

  const n = Number.parseFloat(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

/** Login CTAs / VAT / stock blurbs often leak into Reichelt breadcrumb UL. */
export function isJunkReicheltBreadcrumb(value: string): boolean {
  const t = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!t) return true;
  return (
    /^(vous êtes ici|you are here|home|page d'accueil|startseite)$/i.test(t) ||
    /veuillez vous connecter|bitte loggen|please (log|sign)\s*in|anmelden/i.test(t) ||
    /^taille d['’]origine$/i.test(t) ||
    /avec\s+[\d.,]+\s*%\s*tva|inkl\.?\s*mwst|hors frais|zzgl\.?\s*versand/i.test(t) ||
    /ex stock|délai de livraison|lieferzeit|sofort lieferbar/i.test(t)
  );
}

function absorbSetCookie(jar: CookieJar, header: string | null) {
  if (!header) return;
  for (const part of header.split(/,(?=\s*[^;]+=[^;]+)/)) {
    const seg = part.split(";")[0]?.trim();
    if (!seg || !seg.includes("=")) continue;
    const eq = seg.indexOf("=");
    const name = seg.slice(0, eq).trim();
    const value = seg.slice(eq + 1).trim();
    if (name) jar.set(name, value);
  }
}

function cookieHeader(jar: CookieJar): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

export function reicheltAcceptLanguage(url: string): string {
  const override = process.env.SCRAPER_REI_ACCEPT_LANGUAGE?.trim();
  if (override) return override;
  // MyraCloud WAF returns 503 when fr-CH is primary; de-DE also trips residential proxies.
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith("reichelt.de")) return "de-DE,de;q=0.9,en;q=0.8";
  } catch {
    /* ignore */
  }
  return "de-DE,de;q=0.9,en;q=0.8,fr;q=0.7";
}

export function reicheltReferer(url: string, baseUrl: string): string {
  try {
    const origin = new URL(url).origin;
    return `${origin}/`;
  } catch {
    return `${baseUrl.replace(/\/$/, "")}/`;
  }
}

/** LemonProxy/residential: Accept-Language + Referer → MyraCloud "Security Check" 503. */
export function reicheltShouldSendBrowserHints(): boolean {
  if (String(process.env.SCRAPER_REI_BROWSER_HINTS ?? "").trim() === "1") return true;
  if (String(process.env.SCRAPER_REI_BROWSER_HINTS ?? "").trim() === "0") return false;
  return !(reicheltForceCurlEnabled() || reicheltProxyPool().length > 0);
}

function reicheltCurlFallbackEnabled(): boolean {
  return process.env.SCRAPER_REI_CURL_FALLBACK !== "0";
}

function reicheltForceCurlEnabled(): boolean {
  return String(process.env.SCRAPER_REI_FORCE_CURL ?? "0") === "1";
}

/** `host:port:user:pass` (LemonProxy) → `http://user:pass@host:port`. */
export function normalizeReicheltProxyUrl(raw: string): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const parts = value.split(":");
  if (parts.length >= 4) {
    const host = parts[0];
    const port = parts[1];
    const password = parts[parts.length - 1];
    const user = parts.slice(2, -1).join(":");
    if (!host || !port || !user || !password) return null;
    return `http://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}`;
  }
  return null;
}

function splitProxyEntries(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function readProxyFileEntries(): string[] {
  const filePath = String(process.env.SCRAPER_REI_PROXY_FILE ?? "").trim();
  if (!filePath) return [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    if (!fs.existsSync(filePath)) return [];
    return splitProxyEntries(fs.readFileSync(filePath, "utf8"));
  } catch {
    return [];
  }
}

let proxyPoolCache: string[] | null = null;
let proxyPoolCursor = 0;

/** Round-robin pool from file / SCRAPER_REI_PROXY_URLS / SCRAPER_REI_PROXY_URL. */
export function reicheltProxyPool(): string[] {
  if (proxyPoolCache) return proxyPoolCache;
  const multi = String(process.env.SCRAPER_REI_PROXY_URLS ?? "").trim();
  const single =
    String(process.env.SCRAPER_REI_PROXY_URL ?? "").trim() ||
    String(process.env.SCRAPER_PROXY_URL ?? "").trim();
  const rawEntries = [
    ...readProxyFileEntries(),
    ...(multi ? splitProxyEntries(multi) : []),
    ...(single ? [single] : []),
  ];
  const seen = new Set<string>();
  proxyPoolCache = [];
  for (const entry of rawEntries) {
    const url = normalizeReicheltProxyUrl(entry);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    proxyPoolCache.push(url);
  }
  return proxyPoolCache;
}

function reicheltProxyUrl(): string | null {
  const pool = reicheltProxyPool();
  if (!pool.length) return null;
  const url = pool[proxyPoolCursor % pool.length]!;
  proxyPoolCursor = (proxyPoolCursor + 1) % pool.length;
  return url;
}

function reicheltProgressPath(): string {
  return String(process.env.SCRAPER_REI_PROGRESS_FILE || "/app/.data/reichelt-scrape-progress.json").trim();
}

export type ReicheltScrapeProgress = {
  lastShard: number;
  updatedAt: string;
  runId?: number;
};

export function readReicheltScrapeProgress(): ReicheltScrapeProgress | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    const path = reicheltProgressPath();
    if (!fs.existsSync(path)) return null;
    const raw = JSON.parse(fs.readFileSync(path, "utf8")) as ReicheltScrapeProgress;
    if (!Number.isFinite(raw?.lastShard)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeReicheltScrapeProgress(progress: ReicheltScrapeProgress): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pathMod = require("node:path") as typeof import("node:path");
    const path = reicheltProgressPath();
    fs.mkdirSync(pathMod.dirname(path), { recursive: true });
    fs.writeFileSync(path, JSON.stringify(progress));
  } catch (err) {
    console.warn("[SCRAPER] rei progress write failed:", (err as Error)?.message || err);
  }
}

export function clearReicheltScrapeProgress(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    const path = reicheltProgressPath();
    if (fs.existsSync(path)) fs.unlinkSync(path);
  } catch {
    /* ignore */
  }
}

/** Resume shard: progress file when SCRAPER_REI_RESUME≠0; else SCRAPER_REI_SITEMAP_START_SHARD. */
export function resolveReicheltStartShard(): number {
  if (String(process.env.SCRAPER_REI_RESUME ?? "1") !== "0") {
    const progress = readReicheltScrapeProgress();
    if (progress) return Math.max(0, progress.lastShard);
  }
  return Math.max(0, Number(process.env.SCRAPER_REI_SITEMAP_START_SHARD || 0));
}

export function reicheltConfig() {
  return {
    userAgent: DEFAULT_UA,
    requestDelayMs: Math.max(
      0,
      Number(process.env.SCRAPER_REI_REQUEST_DELAY_MS ?? process.env.SCRAPER_REQUEST_DELAY_MS ?? 40)
    ),
    requestTimeoutMs: Math.max(5_000, Number(process.env.SCRAPER_REI_REQUEST_TIMEOUT_MS || 45_000)),
    maxRetries: Math.max(1, Number(process.env.SCRAPER_REI_MAX_RETRIES || 2)),
    sitemapMaxRetries: Math.max(1, Number(process.env.SCRAPER_REI_SITEMAP_MAX_RETRIES || 3)),
    sitemapRetryBaseMs: Math.max(500, Number(process.env.SCRAPER_REI_SITEMAP_RETRY_BASE_MS || 3_000)),
    sitemapShardMaxRetries: Math.max(1, Number(process.env.SCRAPER_REI_SITEMAP_SHARD_MAX_RETRIES || 2)),
    sitemapShardRetryBaseMs: Math.max(500, Number(process.env.SCRAPER_REI_SITEMAP_SHARD_RETRY_BASE_MS || 2_000)),
    sitemapFallbackMaxShard: Math.max(0, Number(process.env.SCRAPER_REI_SITEMAP_FALLBACK_MAX_SHARD || 149)),
    // Reichelt HTML exposes only in-stock class (status_1/4/6/16/100), no real qty.
    // Default 1 to avoid Galaxus back-order overselling; raise via SCRAPER_REI_DEFAULT_STOCK.
    defaultStock: Math.max(
      1,
      Number(process.env.SCRAPER_REI_DEFAULT_STOCK || process.env.SCRAPER_DEFAULT_STOCK || 1)
    ),
    productConcurrency: Math.max(1, Number(process.env.SCRAPER_REI_PRODUCT_CONCURRENCY || 8)),
  };
}

export function parseReicheltProductSitemapShards(indexXml: string): number[] {
  return [...indexXml.matchAll(/products_(\d+)\.xml/g)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

export function fallbackReicheltProductSitemapShards(maxShard: number): number[] {
  const cap = Math.max(0, maxShard);
  return Array.from({ length: cap + 1 }, (_, i) => i);
}

export function reicheltCategoryPageUrl(categoryUrl: string, page: number): string {
  const pathname = new URL(categoryUrl).pathname;
  const u = new URL(categoryUrl);
  u.searchParams.set("q", pathname);
  u.searchParams.set("PAGE", String(page));
  return u.href;
}

/** `gate_driver-10497` → `gate driver` — cheap pre-filter before product HTML fetch. */
export function extractReicheltCategorySlug(categoryUrl: string): string | null {
  let decoded = String(categoryUrl);
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    /* keep raw */
  }
  const match = decoded.match(/\/(?:cat[eé]gorie|kategorie)\/([^/?#]+)/i);
  if (!match) return null;
  return match[1].replace(/-\d+$/, "").replace(/_/g, " ").trim() || null;
}

export function isRetryableReicheltError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? "").toLowerCase();
  return (
    msg.includes("http 429") ||
    msg.includes("http 451") ||
    msg.includes("http 502") ||
    msg.includes("http 503") ||
    msg.includes("http 504") ||
    msg.includes("timeout") ||
    msg.includes("aborted") ||
    msg.includes("econnreset") ||
    msg.includes("fetch failed")
  );
}

/** Permanent nginx 403 on a single shard (e.g. products_0.xml) — skip, don't abort run. */
export function isSoftSkipReicheltShardError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? "").toLowerCase();
  return msg.includes("http 403") || msg.includes("http 404");
}

/** Network/WAF failures worth a single DE fallback — not soft HTML misses. */
export function isHardReicheltFetchError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? "").toLowerCase();
  return (
    isRetryableReicheltError(err) ||
    msg.includes("ssl") ||
    msg.includes("tunnel") ||
    msg.includes("connect") ||
    msg.includes("curl:") ||
    msg.includes("http 400") ||
    msg.includes("http 500")
  );
}

/** Prefer slugged sitemap / CH-FR URL; avoid short `/-id` (often 451 + full body). */
export function resolveReicheltPrimaryProductUrl(
  articleId: string,
  productUrl: string | null | undefined,
  baseUrl: string
): string {
  const raw = String(productUrl ?? "").trim();
  if (raw && raw.includes(String(articleId))) {
    return toReicheltChFrProductUrl(raw) ?? raw;
  }
  if (raw) {
    const ch = toReicheltChFrProductUrl(raw);
    if (ch) return ch;
  }
  return `${baseUrl.replace(/\/$/, "")}/shop/produit/-${articleId}`;
}

/** Prefer CHF from `(12.34 CHF)` on CH storefront; reject absurd CHF/EUR pairs. */
export function parseReicheltChfPrice(html: string, priceEur: number | null = null): number | null {
  const pick = (raw: string | undefined): number | null => {
    const chf = parseMoney(raw);
    if (!chf || priceEur == null) return chf;
    if (chf > priceEur * 3) return null;
    // Guard against clipped-thousands parse like "1 906.08 CHF" -> "906.08 CHF".
    if (priceEur >= 100 && chf < priceEur * 0.6) return null;
    if (priceEur >= 20 && chf < priceEur * 0.4) return null;
    return chf;
  };

  const candidates: number[] = [];
  const patterns: RegExp[] = [
    /\(([0-9][\d.,' \u00a0\u202f]*)\s*CHF\)/gi,
    /([0-9][\d.,' \u00a0\u202f]*)\s*CHF\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const chf = pick(match[1]);
      if (chf) candidates.push(chf);
    }
  }
  if (!candidates.length) return null;
  if (priceEur == null) return Math.max(...candidates);

  let best = candidates[0]!;
  let bestDistance = Math.abs(best - priceEur);
  for (const value of candidates.slice(1)) {
    const distance = Math.abs(value - priceEur);
    if (distance < bestDistance) {
      best = value;
      bestDistance = distance;
    }
  }
  return best;
}

export function parseReicheltStockStatus(html: string): { status: string | null; text: string | null; inStock: boolean } {
  const status = html.match(/class="availability status_(\d+)/i)?.[1] ?? null;
  const textMatch = html.match(/class="availability[^"]*"[^>]*>[\s\S]*?([^<]{5,160})/i);
  const text = textMatch ? decodeHtml(textMatch[1].replace(/\s+/g, " ").trim()) : null;
  const inStock = status ? ["1", "4", "6", "16", "100"].includes(status) : /en stock|ex stock|lieferbar|disponible|in stock/i.test(text ?? "");
  return { status, text, inStock };
}

/**
 * True when the Reichelt product page renders the discontinued marker.
 * FR: "n'est … plus disponible" · DE: "nicht mehr verfügbar" · EN: "no longer available".
 * Used to distinguish a delisted SKU (must zero stock) from a transient parse failure.
 */
export function isReicheltDelistedHtml(html: string): boolean {
  if (!html) return false;
  return /n['\u2019]est[^<]{0,60}plus\s+disponible|nicht\s+mehr\s+verf(ü|u)gbar|no\s+longer\s+available|status_0\b/i.test(
    html
  );
}

export function parseReicheltCategorySettings(html: string): ReicheltCategorySettings | null {
  const match = html.match(/id="settings">\s*(\{[\s\S]*?\})\s*</i);
  if (!match) return null;
  try {
    const raw = JSON.parse(match[1]) as Record<string, unknown>;
    const categoryId = String(raw.categoryId ?? "").trim();
    if (!categoryId) return null;
    return {
      count: Number(raw.count ?? 0),
      start: Number.parseInt(String(raw.start ?? "0"), 10) || 0,
      offset: Number.parseInt(String(raw.offset ?? "16"), 10) || 16,
      categoryId,
      sort: String(raw.sort ?? "null"),
    };
  } catch {
    return null;
  }
}

export function parseReicheltListHtml(html: string, baseUrl: string): ReicheltListItem[] {
  const out: ReicheltListItem[] = [];
  const seen = new Set<string>();
  for (const block of html.match(/<div class="al_gallery_article[\s\S]*?(?=<div class="al_gallery_article|$)/gi) ?? []) {
    const articleId = block.match(/produit\/[^"']+-(\d+)"/i)?.[1] ?? block.match(/product\/[^"']+-(\d+)"/i)?.[1];
    if (!articleId || seen.has(articleId)) continue;
    seen.add(articleId);
    const name =
      block.match(/itemprop="name"\s+content="([^"]+)"/i)?.[1] ??
      block.match(/class="al_artname[^"]*"[^>]*>([^<]+)/i)?.[1] ??
      null;
    const reicheltSku = block.match(/num[eé]ro d'article:\s*([^<\n]+)/i)?.[1]?.trim() ?? null;
    const brand = block.match(/itemprop="brand"\s+content="([^"]+)"/i)?.[1] ?? null;
    const priceEur = parseMoney(block.match(/itemprop="price"[^>]*content="([^"]+)"/i)?.[1]);
    const priceChf = parseReicheltChfPrice(block, priceEur);
    const stock = parseReicheltStockStatus(block);
    const rel = block.match(/href="([^"]*(?:produit|product)\/[^"]+-(\d+))"/i)?.[1] ?? null;
    const productUrl = rel ? (rel.startsWith("http") ? rel : new URL(rel, baseUrl).href) : `${baseUrl}/shop/produit/-${articleId}`;
    const imageUrl = decodeHtml(
      block.match(/itemprop="image"[^>]*src="([^"]+)"/i)?.[1] ??
        block.match(/src="(https:\/\/cdn-reichelt[^"]+)"/i)?.[1] ??
        ""
    ) || null;
    out.push({
      articleId,
      name: name ? decodeHtml(name.trim()) : null,
      reicheltSku,
      brand: brand ? decodeHtml(brand.trim()) : null,
      priceEur,
      priceChf,
      stockStatus: stock.status,
      stockText: stock.text,
      productUrl,
      imageUrl,
    });
  }
  if (out.length) return out;

  for (const match of html.matchAll(/(?:produit|product)\/[^"']+-(\d+)"/gi)) {
    const articleId = match[1];
    if (seen.has(articleId)) continue;
    seen.add(articleId);
    out.push({
      articleId,
      name: null,
      reicheltSku: null,
      brand: null,
      priceEur: null,
      priceChf: null,
      stockStatus: null,
      stockText: null,
      productUrl: `${baseUrl}/shop/produit/-${articleId}`,
      imageUrl: null,
    });
  }
  return out;
}

export function parseReicheltProductHtml(html: string, articleId: string, baseUrl: string): ReicheltProduct | null {
  const gtinRaw = html.match(/itemprop="gtin13">([^<]+)</i)?.[1]?.trim();
  if (!gtinRaw || !validateGtin(gtinRaw)) return null;

  const reicheltSku = html.match(/itemprop="sku"><b>([^<]+)</i)?.[1]?.trim();
  if (!reicheltSku) return null;

  const name =
    html.match(/itemprop="name"\s+content="([^"]+)"/i)?.[1] ??
    html.match(/<title>\s*([^|<]+)/i)?.[1] ??
    reicheltSku;
  const brand = html.match(/itemprop="brand">([^<]+)</i)?.[1]?.trim() ?? null;
  const manufacturerPartNo =
    html.match(/Man\.\s*part no\.:[\s\S]{0,80}?<[^>]+>\s*([^<]+)/i)?.[1]?.trim() ??
    html.match(/R[eé]f[\s\S]{0,40}?fabricant[\s\S]{0,80}?<[^>]+>\s*([^<]+)/i)?.[1]?.trim() ??
    null;
  const priceEur = parseMoney(html.match(/itemprop="price"[^>]*content="([^"]+)"/i)?.[1]);
  const priceChf = parseReicheltChfPrice(html, priceEur);
  const weightGrams = extractReicheltWeightGrams(html);

  const stock = parseReicheltStockStatus(html);
  const canonical = html.match(/rel="canonical"\s+href="([^"]+)"/i)?.[1];
  const productUrl = canonical ?? `${baseUrl}/shop/produit/-${articleId}`;
  const imageUrl = decodeHtml(
    html.match(/itemprop="image"[^>]*src="([^"]+)"/i)?.[1] ??
      html.match(/itemprop="image"[^>]*content="([^"]+)"/i)?.[1] ??
      ""
  ) || null;
  const breadcrumbs = [
    ...(html.match(/class="breadcrumb"[\s\S]*?<\/ul>/i)?.[0]?.matchAll(/<a[^>]*>([^<]+)</gi) ?? []),
  ]
    .map((m) => decodeHtml(m[1].replace(/\s+/g, " ").trim()))
    .filter((b) => b && !isJunkReicheltBreadcrumb(b));
  const descriptionHtml = html.match(/itemprop="description"[^>]*>([\s\S]*?)<\/div>/i)?.[1]?.trim() ?? null;
  const techAttributes = parseReicheltArticleAttributes(html);

  return {
    articleId,
    reicheltSku,
    gtin: gtinRaw,
    name: decodeHtml(name.trim()),
    brand: brand ? decodeHtml(brand) : null,
    manufacturerPartNo: manufacturerPartNo ? decodeHtml(manufacturerPartNo) : null,
    priceChf,
    priceEur,
    weightGrams,
    stockStatus: stock.status,
    stockText: stock.text,
    inStock: stock.inStock,
    imageUrl,
    breadcrumbs,
    productUrl,
    descriptionHtml,
    techAttributes,
  };
}

/** Parse Reichelt FR/DE `ul.articleAttribute` name/value pairs (tech + general). */
export function parseReicheltArticleAttributes(html: string): ReicheltTechAttribute[] {
  const out: ReicheltTechAttribute[] = [];
  const seen = new Set<string>();
  for (const block of html.matchAll(/<ul class="articleAttribute">([\s\S]*?)<\/ul>/gi)) {
    const lis = [...block[1].matchAll(/<li>([\s\S]*?)<\/li>/gi)].map((m) =>
      decodeHtml(m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    );
    for (let i = 0; i + 1 < lis.length; i += 2) {
      const name = lis[i];
      const value = lis[i + 1];
      if (!name || !value) continue;
      const key = `${name.toLowerCase()}::${value.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, value });
    }
  }
  return out;
}

export function extractReicheltArticleIdFromUrl(url: string): string | null {
  const match = String(url).match(/-(\d+)(?:\?|#|$)/);
  return match?.[1] ?? null;
}

export function toReicheltChFrCategoryUrl(sitemapUrl: string): string | null {
  const match = String(sitemapUrl).match(/\/shop\/(?:kategorie|cat[eé]gorie)\/([^/?#]+)$/i);
  if (!match) return null;
  return `https://www.reichelt.com/ch/fr/shop/cat%C3%A9gorie/${match[1]}`;
}

/** Sitemap uses /de/en/shop/product/… — rewrite to CH/FR slug URL for CHF + bot tolerance. */
export function toReicheltChFrProductUrl(sitemapUrl: string): string | null {
  const match = String(sitemapUrl).match(/\/shop\/(?:product|produit)\/([^/?#]+)$/i);
  if (!match) return null;
  return `https://www.reichelt.com/ch/fr/shop/produit/${match[1]}`;
}

/** DE storefront slug URL — often more tolerant when CH/FR WAF blocks Node fetch. */
export function toReicheltDeProductUrl(sitemapUrl: string): string | null {
  const match = String(sitemapUrl).match(/\/shop\/(?:product|produit|produkt)\/([^/?#]+)$/i);
  if (!match) return null;
  const slug = match[1];
  const articleId = extractReicheltArticleIdFromUrl(slug) ?? extractReicheltArticleIdFromUrl(sitemapUrl);
  if (articleId && !slug.endsWith(`-${articleId}`)) {
    return `https://www.reichelt.de/de/de/shop/produkt/${slug}-${articleId}`;
  }
  return `https://www.reichelt.de/de/de/shop/produkt/${slug}`;
}

function buildReicheltFetchHeaders(
  url: string,
  baseUrl: string,
  jar: CookieJar,
  xsrf: string | null,
  init: RequestInit = {}
): Headers {
  const cfg = reicheltConfig();
  const headers = new Headers(init.headers);
  headers.set("User-Agent", cfg.userAgent);
  headers.set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
  if (reicheltShouldSendBrowserHints()) {
    headers.set("Accept-Language", reicheltAcceptLanguage(url));
    headers.set("Referer", reicheltReferer(url, baseUrl));
  }
  const cookie = cookieHeader(jar);
  if (cookie) headers.set("Cookie", cookie);
  if (xsrf) headers.set("X-CSRF-TOKEN", xsrf);
  return headers;
}

let curlBinaryAvailable: boolean | null = null;

async function ensureCurlAvailable(): Promise<boolean> {
  if (curlBinaryAvailable != null) return curlBinaryAvailable;
  try {
    await execFile("curl", ["--version"], { timeout: 5_000 });
    curlBinaryAvailable = true;
  } catch {
    curlBinaryAvailable = false;
    console.warn(
      "[SCRAPER] rei curl fallback disabled — curl binary missing in container (install curl in Dockerfile)"
    );
  }
  return curlBinaryAvailable;
}

async function fetchTextViaCurl(url: string, headers: Headers): Promise<string> {
  if (!(await ensureCurlAvailable())) {
    throw new Error(`Reichelt curl unavailable ${url}`);
  }
  const cfg = reicheltConfig();
  const proxy = reicheltProxyUrl();
  const args = [
    "-sS",
    "-L",
    "--compressed",
    "--max-time",
    String(Math.max(5, Math.ceil(cfg.requestTimeoutMs / 1000))),
    "-w",
    "\n__REI_CURL_HTTP__:%{http_code}",
  ];
  if (proxy) args.push("--proxy", proxy);
  headers.forEach((value, key) => {
    args.push("-H", `${key}: ${value}`);
  });
  args.push(url);
  const { stdout } = await execFile("curl", args, { maxBuffer: 25 * 1024 * 1024 });
  const marker = "\n__REI_CURL_HTTP__:";
  const idx = stdout.lastIndexOf(marker);
  const body = idx >= 0 ? stdout.slice(0, idx) : stdout;
  const status = idx >= 0 ? Number(stdout.slice(idx + marker.length).trim()) : 0;
  if (status && status >= 400) {
    throw new Error(`Reichelt curl HTTP ${status} ${url}`);
  }
  if (/<title>\s*Security Check\s*<\/title>/i.test(body) || /myracloud-blocked/i.test(body)) {
    throw new Error(`Reichelt curl HTTP 503 ${url} (myracloud security check)`);
  }
  return body;
}

export class ReicheltClient {
  private jar: CookieJar = new Map();
  private xsrf: string | null = null;

  constructor(private readonly baseUrl: string) {}

  private async fetchOnce(url: string, init: RequestInit = {}): Promise<Response> {
    const cfg = reicheltConfig();
    const headers = buildReicheltFetchHeaders(url, this.baseUrl, this.jar, this.xsrf, init);
    const res = await fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(cfg.requestTimeoutMs),
      redirect: "follow",
    });
    absorbSetCookie(this.jar, res.headers.get("set-cookie"));
    const xsrf = this.jar.get("XSRF-TOKEN");
    if (xsrf) {
      try {
        this.xsrf = decodeURIComponent(xsrf);
      } catch {
        this.xsrf = xsrf;
      }
    }
    return res;
  }

  async fetchText(url: string, init: RequestInit = {}): Promise<string> {
    return this.fetchTextWithRetry(url, init, reicheltConfig().maxRetries, reicheltConfig().requestDelayMs);
  }

  private async fetchTextWithRetry(
    url: string,
    init: RequestInit,
    maxRetries: number,
    retryBaseMs: number
  ): Promise<string> {
    if (reicheltForceCurlEnabled()) {
      let lastCurlErr: unknown = null;
      // Cap attempts at maxRetries — do NOT inflate to proxy-pool size (burns GB).
      const attempts = Math.max(1, maxRetries);
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          const headers = buildReicheltFetchHeaders(url, this.baseUrl, this.jar, this.xsrf, init);
          const text = await fetchTextViaCurl(url, headers);
          const delayMs = reicheltConfig().requestDelayMs;
          if (delayMs) await sleep(delayMs + jitterMs(250));
          return text;
        } catch (err) {
          lastCurlErr = err;
          if (!isRetryableReicheltError(err) || attempt >= attempts - 1) break;
          await sleep(retryBaseMs * Math.pow(2, attempt) + jitterMs(400));
        }
      }
      throw lastCurlErr instanceof Error ? lastCurlErr : new Error(String(lastCurlErr));
    }

    let lastErr: unknown = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const res = await this.fetchOnce(url, init);
        if (!res.ok) throw new Error(`Reichelt HTTP ${res.status} ${url}`);
        const text = await res.text();
        const delayMs = reicheltConfig().requestDelayMs;
        if (delayMs) await sleep(delayMs + jitterMs(250));
        return text;
      } catch (err) {
        lastErr = err;
        if (!isRetryableReicheltError(err) || attempt >= maxRetries - 1) break;
        const backoff = retryBaseMs * Math.pow(2, attempt) + jitterMs(Math.min(retryBaseMs, 2_000));
        await sleep(backoff);
      }
    }

    const msg = String((lastErr as Error)?.message ?? lastErr ?? "");
    if (reicheltCurlFallbackEnabled() && /http 503|http 502|http 429|fetch failed|timeout|econnreset/i.test(msg)) {
      try {
        const headers = buildReicheltFetchHeaders(url, this.baseUrl, this.jar, this.xsrf, init);
        const text = await fetchTextViaCurl(url, headers);
        const looksXml = /<\?xml|<sitemapindex|<urlset/i.test(text);
        const looksHtml = /<html/i.test(text);
        if (!text || text.length < 200 || (!looksXml && !looksHtml)) {
          throw new Error(`Reichelt curl empty/invalid response ${url}`);
        }
        const delayMs = reicheltConfig().requestDelayMs;
        if (delayMs) await sleep(delayMs + jitterMs(250));
        return text;
      } catch (curlErr) {
        throw curlErr instanceof Error ? curlErr : new Error(String(curlErr));
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  /** Homepage visit — seeds cookies/XSRF before sitemap/API calls. */
  async warmSession(): Promise<void> {
    try {
      await this.fetchTextWithRetry(`${this.baseUrl}/`, {}, 2, 1_000);
    } catch (err) {
      console.warn("[SCRAPER] rei session warmup failed:", (err as Error)?.message || err);
    }
  }

  /** Index XML first; if 503/outage, scan known shard range without index. */
  async resolveProductSitemapShards(): Promise<number[]> {
    const cfg = reicheltConfig();
    await this.warmSession();

    const indexUrls = [REICHELT_SITEMAP_INDEX_URL, "https://www.reichelt.com/sitemap.xml"];
    for (const indexUrl of indexUrls) {
      try {
        const indexXml = await this.fetchTextWithRetry(
          indexUrl,
          {},
          cfg.sitemapMaxRetries,
          cfg.sitemapRetryBaseMs
        );
        const shards = parseReicheltProductSitemapShards(indexXml);
        if (shards.length) return shards;
      } catch (err) {
        console.warn(
          `[SCRAPER] rei sitemap index ${indexUrl} failed:`,
          (err as Error)?.message || err
        );
      }
    }

    const fallback = fallbackReicheltProductSitemapShards(cfg.sitemapFallbackMaxShard);
    console.warn(
      `[SCRAPER] rei sitemap index unavailable — blind shard scan 0..${cfg.sitemapFallbackMaxShard}`
    );
    return fallback;
  }

  async fetchCategory(categoryUrl: string, page = 0): Promise<{ html: string; settings: ReicheltCategorySettings | null; items: ReicheltListItem[] }> {
    const html = await this.fetchText(reicheltCategoryPageUrl(categoryUrl, page));
    const settings = parseReicheltCategorySettings(html);
    const items = parseReicheltListHtml(html, this.baseUrl);
    return { html, settings, items };
  }

  /** Reliable pagination: `?q={pathname}&PAGE=N` (16 products/page). XHR API is flaky server-side. */
  async *iterCategoryProductPages(categoryUrl: string): AsyncGenerator<ReicheltListItem[]> {
    const first = await this.fetchCategory(categoryUrl, 0);
    if (first.items.length) yield first.items;
    const total = first.settings?.count ?? first.items.length;
    const pageSize = first.settings?.offset ?? 16;
    if (total <= first.items.length) return;
    const pages = Math.ceil(total / pageSize);
    for (let page = 1; page < pages; page++) {
      const { items } = await this.fetchCategory(categoryUrl, page);
      if (!items.length) break;
      yield items;
    }
  }

  async fetchCategoryProductsPage(settings: ReicheltCategorySettings, start: number, referer: string): Promise<ReicheltListItem[]> {
    const sort = encodeURIComponent(settings.sort);
    const url = `${REICHELT_API_ORIGIN}/api/category/getProducts/${settings.categoryId}/${start}/${settings.offset}/*/0/2000000/filter/null/null/0/0/0/${sort}`;
    const html = await this.fetchText(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Referer: referer,
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ filter: [] }),
    });
    try {
      const json = JSON.parse(html) as { html?: string };
      return parseReicheltListHtml(json.html ?? "", this.baseUrl);
    } catch {
      return [];
    }
  }

  async fetchProductByArticleId(
    articleId: string,
    productUrl?: string | null
  ): Promise<{ product: ReicheltProduct | null; delisted: boolean }> {
    const primary = resolveReicheltPrimaryProductUrl(articleId, productUrl, this.baseUrl);
    const deFallbackEnabled = String(process.env.SCRAPER_REI_DE_FALLBACK ?? "1") !== "0";

    const tryOne = async (
      url: string
    ): Promise<{ product: ReicheltProduct | null; delisted: boolean }> => {
      const html = await this.fetchText(url);
      const product = parseReicheltProductHtml(html, articleId, this.baseUrl);
      if (product) return { product, delisted: false };
      return { product: null, delisted: isReicheltDelistedHtml(html) };
    };

    try {
      const res = await tryOne(primary);
      if (res.product || res.delisted) return res;
      return { product: null, delisted: false };
    } catch (err) {
      if (!deFallbackEnabled || !isHardReicheltFetchError(err)) {
        throw err instanceof Error ? err : new Error(String(err));
      }
      const de = productUrl ? toReicheltDeProductUrl(productUrl) : null;
      if (!de || de === primary) throw err instanceof Error ? err : new Error(String(err));
      try {
        return await tryOne(de);
      } catch (deErr) {
        throw deErr instanceof Error ? deErr : new Error(String(deErr));
      }
    }
  }

  /** Map articleId → canonical sitemap product URL (slugged; short `/-id` often 451/503). */
  collectArticleTargetsFromProductUrls(urls: string[]): Array<{ articleId: string; productUrl: string }> {
    const out: Array<{ articleId: string; productUrl: string }> = [];
    const seen = new Set<string>();
    for (const url of urls) {
      const articleId = extractReicheltArticleIdFromUrl(url);
      if (!articleId || seen.has(articleId)) continue;
      seen.add(articleId);
      out.push({ articleId, productUrl: toReicheltChFrProductUrl(url) ?? url });
    }
    return out;
  }

  async *iterProductSitemapShards(): AsyncGenerator<{ shard: number; urls: string[] }> {
    const cfg = reicheltConfig();
    const startShard = resolveReicheltStartShard();
    if (startShard > 0) {
      console.log(`[SCRAPER] rei resuming sitemap from shard ${startShard}`);
    }
    const shards = await this.resolveProductSitemapShards();
    let consecutiveHardSkips = 0;
    const maxConsecutiveSkips = Math.max(
      5,
      Number(process.env.SCRAPER_REI_SITEMAP_MAX_CONSECUTIVE_SKIPS || 12)
    );
    for (const shard of shards) {
      if (shard < startShard) continue;
      let xml: string | null = null;
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < cfg.sitemapShardMaxRetries; attempt++) {
        try {
          xml = await this.fetchTextWithRetry(
            `${REICHELT_PRODUCT_SITEMAP_PREFIX}${shard}.xml`,
            {},
            cfg.sitemapShardMaxRetries,
            cfg.sitemapShardRetryBaseMs
          );
          break;
        } catch (err) {
          lastErr = err;
          if (!isRetryableReicheltError(err) || attempt >= cfg.sitemapShardMaxRetries - 1) break;
          await sleep(cfg.sitemapShardRetryBaseMs * Math.pow(2, attempt) + jitterMs(400));
        }
      }
      if (!xml) {
        const soft = isSoftSkipReicheltShardError(lastErr);
        if (!soft) {
          consecutiveHardSkips++;
          // Session cookies expire mid-run — re-warm before giving up the batch.
          if (consecutiveHardSkips === 3 || consecutiveHardSkips === 6) {
            console.warn(`[SCRAPER] rei re-warming session after ${consecutiveHardSkips} hard shard skips`);
            await this.warmSession();
          }
        }
        console.warn(
          `[SCRAPER] rei sitemap shard ${shard} skipped${soft ? " (soft)" : ""}:`,
          (lastErr as Error)?.message || lastErr
        );
        if (consecutiveHardSkips >= maxConsecutiveSkips) {
          console.warn(
            `[SCRAPER] rei sitemap aborting after ${consecutiveHardSkips} consecutive hard shard failures (site likely down)`
          );
          break;
        }
        continue;
      }
      consecutiveHardSkips = 0;
      writeReicheltScrapeProgress({ lastShard: shard, updatedAt: new Date().toISOString() });
      const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
      yield { shard, urls };
    }
  }

  async *iterCategorySitemapUrls(): AsyncGenerator<string> {
    for (let i = 0; i < 32; i++) {
      try {
        const xml = await this.fetchText(`${REICHELT_CATEGORY_SITEMAP_PREFIX}${i}.xml`);
        for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
          const ch = toReicheltChFrCategoryUrl(match[1]);
          if (ch) yield ch;
        }
      } catch {
        break;
      }
    }
  }

  collectArticleIdsFromProductUrls(urls: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const url of urls) {
      const id = extractReicheltArticleIdFromUrl(url);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }
}
