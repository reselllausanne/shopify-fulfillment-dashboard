import { isValidGtin } from "@/galaxus/exports/feedValidation";
import { scraperFetchText } from "@/app/lib/scraperProxy";

const USER_AGENT =
  process.env.SCRAPER_USER_AGENT ||
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const HAWK_SITEMAP_URL = "https://www.hawk.ch/media/google_sitemap_3.xml";

export type HawkProduct = {
  productUrl: string;
  name: string;
  brand: string | null;
  productType: string | null;
  sku: string;
  magentoProductId: string | null;
  gtin: string;
  gtinSource: string;
  priceChf: number;
  stock: number;
  inStock: boolean;
  imageUrl: string | null;
  mpn: string | null;
};

export function hawkConfig() {
  return {
    userAgent: USER_AGENT,
    requestTimeoutMs: Number(process.env.SCRAPER_REQUEST_TIMEOUT_MS || 45_000),
    requestDelayMs: Math.max(
      0,
      Number(process.env.SCRAPER_HAW_REQUEST_DELAY_MS ?? process.env.SCRAPER_REQUEST_DELAY_MS ?? 100)
    ),
    productConcurrency: Math.max(1, Number(process.env.SCRAPER_HAW_CONCURRENCY || 6)),
    defaultStock: Math.max(1, Number(process.env.SCRAPER_DEFAULT_STOCK || 5)),
    sitemapUrl: String(process.env.SCRAPER_HAW_SITEMAP_URL || HAWK_SITEMAP_URL).trim(),
    excludePathPrefixes: parseHawkExcludePrefixes(),
  };
}

function parseHawkExcludePrefixes(): string[] {
  // Empty by default — adult (erotik/bdsm/…) sells; override via SCRAPER_HAW_EXCLUDE_PATH_PREFIXES if needed.
  const raw = process.env.SCRAPER_HAW_EXCLUDE_PATH_PREFIXES ?? "";
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-z]+);/gi, (m) => {
      const map: Record<string, string> = {
        nbsp: " ",
        auml: "ä",
        ouml: "ö",
        uuml: "ü",
        Auml: "Ä",
        Ouml: "Ö",
        Uuml: "Ü",
        szlig: "ß",
        apos: "'",
      };
      return map[m.slice(1, -1)] ?? m;
    });
}

export function isHawkExcludedPath(pathname: string, prefixes = parseHawkExcludePrefixes()): boolean {
  const path = pathname.toLowerCase();
  return prefixes.some((prefix) => {
    const p = prefix.toLowerCase().startsWith("/") ? prefix.toLowerCase() : `/${prefix.toLowerCase()}`;
    return path === p || path.startsWith(`${p}/`);
  });
}

/** Magento product PDP: https://www.hawk.ch/<category>/<slug>.html */
export function isHawkProductUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/(^|\.)hawk\.ch$/i.test(u.hostname)) return false;
    const pathname = u.pathname;
    if (!pathname.endsWith(".html")) return false;
    if (isHawkExcludedPath(pathname)) return false;
    const segments = pathname.split("/").filter(Boolean);
    // /<category>/<slug>.html — skip root CMS pages
    if (segments.length < 2) return false;
    if (pathname.includes("/catalog/")) return false;
    return true;
  } catch {
    return false;
  }
}

export function normalizeHawkGtin(raw: string | null | undefined): { gtin: string; source: string } | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits || /^0+$/.test(digits)) return null;
  if (!isValidGtin(digits)) return null;
  return { gtin: digits, source: digits.length === 13 ? "gtin13" : "gtin" };
}

function parseAvailability(value: string | null | undefined): boolean {
  const raw = String(value ?? "").toLowerCase();
  if (!raw) return true;
  if (raw.includes("outofstock") || raw.includes("discontinued") || raw.includes("soldout")) return false;
  return raw.includes("instock") || raw.includes("preorder") || raw.includes("backorder");
}

function parseJsonLdProduct(html: string): Record<string, unknown> | null {
  for (const match of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      const data = JSON.parse(raw) as Record<string, unknown> | Record<string, unknown>[];
      const candidates = Array.isArray(data) ? data : [data];
      for (const item of candidates) {
        if (item && typeof item === "object" && item["@type"] === "Product") {
          return item as Record<string, unknown>;
        }
      }
    } catch {
      /* next block */
    }
  }
  return null;
}

function offerFromProduct(product: Record<string, unknown>): Record<string, unknown> | null {
  const offers = product.offers;
  if (!offers) return null;
  if (Array.isArray(offers)) return (offers[0] as Record<string, unknown>) ?? null;
  if (typeof offers === "object") return offers as Record<string, unknown>;
  return null;
}

function brandName(product: Record<string, unknown>): string | null {
  const brand = product.brand;
  if (typeof brand === "string") return brand.trim() || null;
  if (brand && typeof brand === "object") {
    const name = (brand as { name?: unknown }).name;
    return typeof name === "string" ? name.trim() || null : null;
  }
  return null;
}

function imageUrl(product: Record<string, unknown>): string | null {
  const image = product.image;
  if (typeof image === "string") return image.trim() || null;
  if (Array.isArray(image) && typeof image[0] === "string") return image[0].trim() || null;
  return null;
}

function parseStockQty(html: string): number | null {
  const m =
    html.match(/stock-label-qty[^>]*>[\s\S]*?Stück an Lager:\s*<span[^>]*>\s*(\d+)\s*<\/span>/i) ||
    html.match(/Stück an Lager:\s*<span[^>]*>\s*(\d+)\s*<\/span>/i) ||
    html.match(/Stück an Lager:\s*(\d+)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseMagentoProductId(html: string): string | null {
  const m =
    html.match(/name="product"\s+value="(\d+)"/i) ||
    html.match(/data-product-id="(\d+)"/i) ||
    html.match(/"productId"\s*:\s*"?(\d+)"?/i);
  return m?.[1] ?? null;
}

function categoryFromUrl(productUrl: string): string | null {
  try {
    const segments = new URL(productUrl).pathname.split("/").filter(Boolean);
    return segments.length >= 2 ? decodeURIComponent(segments[0]!) : null;
  } catch {
    return null;
  }
}

export function parseHawkProductHtml(
  html: string,
  productUrl: string,
  defaultStock = hawkConfig().defaultStock
): HawkProduct | null {
  const product = parseJsonLdProduct(html);
  if (!product) return null;

  const name =
    decodeHtml(String(product.name ?? "").trim()) ||
    decodeHtml(html.match(/<h1[^>]*>([^<]+)</i)?.[1]?.trim() ?? "");
  if (!name) return null;

  const offer = offerFromProduct(product);
  const gtinRaw =
    (typeof product.gtin === "string" ? product.gtin : null) ||
    (typeof offer?.gtin === "string" ? offer.gtin : null) ||
    html.match(/data-loadbee-gtin="(\d+)"/i)?.[1] ||
    html.match(/data-th="EAN">\s*(\d+)/i)?.[1] ||
    html.match(/product_ean\s*=\s*"(\d+)"/i)?.[1];
  const barcode = normalizeHawkGtin(gtinRaw);
  if (!barcode) return null;

  const priceRaw =
    offer?.price ??
    html.match(/data-price-amount="([0-9.]+)"/i)?.[1] ??
    null;
  const priceChf = Number.parseFloat(String(priceRaw ?? ""));
  if (!Number.isFinite(priceChf) || priceChf <= 0) return null;

  const inStock = parseAvailability(
    typeof offer?.availability === "string" ? offer.availability : null
  );
  const qty = parseStockQty(html);
  const stock = !inStock ? 0 : qty != null ? qty : defaultStock;

  const mpn =
    (typeof product.mpn === "string" ? product.mpn.trim() : null) ||
    (typeof offer?.mpn === "string" ? String(offer.mpn).trim() : null) ||
    null;
  const magentoProductId = parseMagentoProductId(html);
  const sku = mpn || magentoProductId || barcode.gtin;

  return {
    productUrl,
    name,
    brand: brandName(product),
    productType: categoryFromUrl(productUrl),
    sku,
    magentoProductId,
    gtin: barcode.gtin,
    gtinSource: barcode.source,
    priceChf,
    stock,
    inStock,
    imageUrl: imageUrl(product),
    mpn,
  };
}

export class HawkClient {
  constructor(private readonly baseUrl: string) {}

  private siteRoot(): string {
    try {
      const u = new URL(this.baseUrl);
      return `${u.protocol}//${u.host}`;
    } catch {
      return this.baseUrl.replace(/\/+$/, "");
    }
  }

  async fetchText(url: string, opts?: { delay?: boolean }): Promise<string> {
    const cfg = hawkConfig();
    const useDelay = opts?.delay !== false && cfg.requestDelayMs > 0;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const text = await scraperFetchText(url, {
          shopKey: "haw",
          timeoutMs: cfg.requestTimeoutMs,
          headers: {
            "User-Agent": cfg.userAgent,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "de-CH,de;q=0.9,en;q=0.8",
          },
        });
        if (useDelay) await sleep(cfg.requestDelayMs + Math.floor(Math.random() * 120));
        return text;
      } catch (err) {
        lastErr = err;
        const msg = String((err as Error)?.message || err);
        if (/HTTP (429|502|503)/.test(msg) || attempt < 4) {
          await sleep(Math.min(4_000 * 2 ** attempt, 90_000));
          continue;
        }
        break;
      }
    }
    throw new Error(`GET failed ${url}: ${lastErr}`);
  }

  async listProductUrls(maxProducts?: number): Promise<string[]> {
    const cfg = hawkConfig();
    const sitemapUrl = cfg.sitemapUrl.startsWith("http")
      ? cfg.sitemapUrl
      : `${this.siteRoot()}${cfg.sitemapUrl.startsWith("/") ? "" : "/"}${cfg.sitemapUrl}`;
    const xml = await this.fetchText(sitemapUrl, { delay: false });
    const out: string[] = [];
    const seen = new Set<string>();

    for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/gi)) {
      const url = match[1].trim();
      if (!isHawkProductUrl(url)) continue;
      const canonical = url.split("?")[0]!;
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      out.push(canonical);
      if (maxProducts && out.length >= maxProducts) return out;
    }
    return out;
  }

  async fetchProduct(productUrl: string): Promise<HawkProduct | null> {
    const html = await this.fetchText(productUrl);
    return parseHawkProductHtml(html, productUrl);
  }
}
