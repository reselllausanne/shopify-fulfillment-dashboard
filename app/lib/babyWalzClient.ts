import { isValidGtin } from "@/galaxus/exports/feedValidation";

const USER_AGENT =
  process.env.SCRAPER_USER_AGENT ||
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const BABY_WALZ_SITEMAP_INDEX_URL = "https://www.baby-walz.ch/sitemap/index.xml";
export const BABY_WALZ_CDN_BASE = "https://walz-live.cdn.aboutyou.cloud/";

const NUXT_SPECIAL = new Set([
  "Reactive",
  "ShallowReactive",
  "Ref",
  "EmptyRef",
  "Set",
  "Map",
  "DirtyObject",
  "EmptySet",
  "EmptyMap",
]);

export type BabyWalzProduct = {
  productUrl: string;
  articleId: string;
  variantReferenceKey: string;
  name: string;
  brand: string | null;
  productType: string | null;
  sku: string;
  gtin: string;
  gtinSource: string;
  priceChf: number;
  stock: number;
  inStock: boolean;
  imageUrl: string | null;
  sizeRaw: string | null;
  masterKey: string | null;
  bulkyOrLoad: boolean;
};

export function babyWalzConfig() {
  return {
    userAgent: USER_AGENT,
    requestTimeoutMs: Number(process.env.SCRAPER_REQUEST_TIMEOUT_MS || 45_000),
    requestDelayMs: Math.max(
      0,
      Number(process.env.SCRAPER_BWZ_REQUEST_DELAY_MS ?? process.env.SCRAPER_REQUEST_DELAY_MS ?? 120)
    ),
    productConcurrency: Math.max(1, Number(process.env.SCRAPER_BWZ_CONCURRENCY || 4)),
    defaultStock: Math.max(1, Number(process.env.SCRAPER_DEFAULT_STOCK || 5)),
    sitemapIndexUrl: String(
      process.env.SCRAPER_BWZ_SITEMAP_INDEX_URL || BABY_WALZ_SITEMAP_INDEX_URL
    ).trim(),
    localePathPrefix: String(process.env.SCRAPER_BWZ_LOCALE_PREFIX || "/de/p/").trim() || "/de/p/",
    cdnBase: String(process.env.SCRAPER_BWZ_CDN_BASE || BABY_WALZ_CDN_BASE).trim(),
    /** Skip / zero-stock below this buy price (CHF). Avoids tiny absolute margin after ship. */
    minPriceChf: Math.max(0, Number(process.env.SCRAPER_BWZ_MIN_PRICE_CHF || 5)),
    /** Skip Sperrgut/Fracht (CHF 19.95 freight) — cancel risk vs baked CHF 2 ship. */
    skipBulky: String(process.env.SCRAPER_BWZ_SKIP_BULKY ?? "1") !== "0",
  };
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

export function normalizeBabyWalzGtin(raw: string | null | undefined): { gtin: string; source: string } | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits || /^0+$/.test(digits)) return null;
  if (!isValidGtin(digits)) return null;
  return { gtin: digits, source: digits.length === 13 ? "gtin13" : "gtin" };
}

/** PDP: https://www.baby-walz.ch/de/p/<slug>-<articleId>/ */
export function isBabyWalzProductUrl(
  url: string,
  localePathPrefix = babyWalzConfig().localePathPrefix
): boolean {
  try {
    const u = new URL(url);
    if (!/(^|\.)baby-walz\.ch$/i.test(u.hostname)) return false;
    const pathname = u.pathname.replace(/\/+$/, "") + "/";
    const prefix = localePathPrefix.endsWith("/") ? localePathPrefix : `${localePathPrefix}/`;
    if (!pathname.toLowerCase().startsWith(prefix.toLowerCase())) return false;
    const slug = pathname.slice(prefix.length).replace(/\/+$/, "");
    if (!slug || slug.includes("/")) return false;
    return /\d{4,}$/.test(slug);
  } catch {
    return false;
  }
}

export function articleIdFromBabyWalzUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const m = pathname.match(/\/p\/[^/]*?-(\d+)\/?$/i);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

function centsToChf(cents: unknown): number | null {
  const n = typeof cents === "number" ? cents : Number(cents);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Scayle stores CHF as minor units (4595 → 45.95)
  return Math.round(n) / 100;
}

function absoluteImageUrl(src: string | null | undefined, cdnBase: string): string | null {
  const raw = String(src ?? "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw.split("?")[0] || raw;
  const base = cdnBase.endsWith("/") ? cdnBase : `${cdnBase}/`;
  const path = raw.replace(/^\/+/, "");
  return `${base}${path}`;
}

type NuxtPayload = unknown[];

function nuxtGet(payload: NuxtPayload, ref: unknown): unknown {
  if (typeof ref !== "number" || !Number.isInteger(ref) || ref < 0 || ref >= payload.length) {
    return null;
  }
  let v: unknown = payload[ref];
  // Unwrap Vue/Nuxt marker tuples: ["ShallowReactive", idx] etc.
  while (
    Array.isArray(v) &&
    v.length >= 2 &&
    typeof v[0] === "string" &&
    NUXT_SPECIAL.has(v[0]) &&
    typeof v[1] === "number"
  ) {
    if (v[1] < 0 || v[1] >= payload.length) return null;
    v = payload[v[1]];
  }
  return v;
}

function nuxtStr(payload: NuxtPayload, ref: unknown): string | null {
  const v = typeof ref === "string" ? ref : nuxtGet(payload, ref);
  if (typeof v !== "string") return null;
  const s = decodeHtml(v).trim();
  return s || null;
}

function nuxtBool(payload: NuxtPayload, ref: unknown): boolean | null {
  if (typeof ref === "boolean") return ref;
  const v = nuxtGet(payload, ref);
  return typeof v === "boolean" ? v : null;
}

function nuxtNum(payload: NuxtPayload, ref: unknown): number | null {
  // Object fields hold refs (ints); never treat the ref index itself as the value.
  const v = typeof ref === "number" ? nuxtGet(payload, ref) : ref;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function nuxtObj(payload: NuxtPayload, ref: unknown): Record<string, unknown> | null {
  const v = typeof ref === "object" && ref && !Array.isArray(ref) ? ref : nuxtGet(payload, ref);
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function nuxtList(payload: NuxtPayload, ref: unknown): unknown[] {
  const v = Array.isArray(ref) ? ref : nuxtGet(payload, ref);
  return Array.isArray(v) ? v : [];
}

function attrValue(payload: NuxtPayload, attrRef: unknown): string | null {
  const attr = nuxtObj(payload, attrRef);
  if (!attr) return null;
  const values = nuxtGet(payload, attr.values);
  if (values && typeof values === "object" && !Array.isArray(values)) {
    const row = values as Record<string, unknown>;
    return nuxtStr(payload, row.value) || nuxtStr(payload, row.label);
  }
  if (Array.isArray(values) && values.length) {
    const row = nuxtObj(payload, values[0]);
    if (!row) return null;
    // Nested fieldSet form used by advancedAttributes (asGro)
    if (row.fieldSet != null) {
      const fieldSet = nuxtList(payload, row.fieldSet);
      const first = nuxtList(payload, fieldSet[0]);
      const cell = nuxtObj(payload, first[0]);
      return cell ? nuxtStr(payload, cell.value) : null;
    }
    return nuxtStr(payload, row.value) || nuxtStr(payload, row.label);
  }
  return null;
}

function parseNuxtPayload(html: string): NuxtPayload | null {
  const m = html.match(/id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m?.[1]) return null;
  try {
    const data = JSON.parse(m[1]) as unknown;
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

function productFromNuxt(
  payload: NuxtPayload,
  productUrl: string,
  articleId: string,
  opts: { defaultStock: number; cdnBase: string }
): BabyWalzProduct[] {
  const root = nuxtObj(payload, 1);
  if (!root) return [];
  const dataObj = nuxtObj(payload, root.data);
  if (!dataObj) return [];

  const productKey = `product:${articleId}`;
  const container = nuxtObj(payload, dataObj[productKey]);
  if (!container) return [];
  const product = nuxtObj(payload, container.product);
  if (!product) return [];

  const name = nuxtStr(payload, product.name);
  if (!name) return [];

  const brand = nuxtStr(payload, product.brand);
  const masterKey = nuxtStr(payload, product.masterKey);
  const productSoldOut = nuxtBool(payload, product.isSoldOut) === true;
  const productType = breadcrumbCategory(payload, product.breadcrumbs);
  const imageUrl = firstProductImage(payload, product.images, opts.cdnBase);

  const variantDetails = nuxtObj(payload, container.variantDetails) || {};
  const variants = nuxtList(payload, product.variants);
  const out: BabyWalzProduct[] = [];

  for (const variantRef of variants) {
    const variant = nuxtObj(payload, variantRef);
    if (!variant) continue;

    const variantReferenceKey =
      nuxtStr(payload, variant.referenceKey) || articleId;
    const attrs = nuxtObj(payload, variant.attributes) || {};
    const gtinRaw = attrValue(payload, attrs.ean);
    const barcode = normalizeBabyWalzGtin(gtinRaw);
    if (!barcode) continue;

    const priceObj = nuxtObj(payload, variant.price);
    const priceChf = centsToChf(priceObj ? nuxtNum(payload, priceObj.withTax) : null);
    if (priceChf == null) continue;

    const stockObj = nuxtObj(payload, variant.stock);
    const qty = stockObj ? nuxtNum(payload, stockObj.quantity) : null;
    const buyable = nuxtBool(payload, variant.isProductBuyable);
    const inStock = !productSoldOut && buyable !== false && (qty == null || qty > 0);
    const stock = !inStock ? 0 : qty != null && qty > 0 ? qty : opts.defaultStock;

    const detail = nuxtObj(payload, variantDetails[variantReferenceKey]);
    const adv = detail ? nuxtObj(payload, detail.advancedAttributes) : null;
    const sizeRaw = adv ? attrValue(payload, adv.asGro) : null;
    const bulkyRaw =
      attrValue(payload, attrs.bulkyOrLoad) ||
      (detail ? attrValue(payload, nuxtObj(payload, detail.attributes)?.bulkyOrLoad) : null);
    const bulkyOrLoad = isTruthyBulky(bulkyRaw);

    out.push({
      productUrl,
      articleId,
      variantReferenceKey,
      name,
      brand,
      productType,
      sku: variantReferenceKey,
      gtin: barcode.gtin,
      gtinSource: barcode.source,
      priceChf,
      stock,
      inStock,
      imageUrl,
      sizeRaw,
      masterKey,
      bulkyOrLoad,
    });
  }

  return out;
}

function isTruthyBulky(raw: string | null | undefined): boolean {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!v) return false;
  if (v === "n" || v === "no" || v === "false" || v === "0") return false;
  if (v === "y" || v === "yes" || v === "true" || v === "1") return true;
  // label form e.g. "Sperrgut/Fracht" when value resolves oddly
  return v.includes("sperr") || v.includes("fracht") || v.includes("bulky");
}

function breadcrumbCategory(payload: NuxtPayload, breadcrumbsRef: unknown): string | null {
  const crumbs = nuxtList(payload, breadcrumbsRef);
  for (const crumbRef of crumbs) {
    const crumb = nuxtObj(payload, crumbRef);
    if (!crumb) continue;
    const label = nuxtStr(payload, crumb.label);
    if (label) return label;
  }
  return null;
}

function firstProductImage(
  payload: NuxtPayload,
  imagesRef: unknown,
  cdnBase: string
): string | null {
  const images = nuxtList(payload, imagesRef);
  for (const imgRef of images) {
    const img = nuxtObj(payload, imgRef);
    if (!img) continue;
    const src = nuxtStr(payload, img.src);
    const abs = absoluteImageUrl(src, cdnBase);
    if (abs) return abs;
  }
  return null;
}

function parseJsonLdProductGroup(html: string): Record<string, unknown> | null {
  for (const match of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      const data = JSON.parse(raw) as Record<string, unknown> | Record<string, unknown>[];
      const candidates = Array.isArray(data) ? data : [data];
      for (const item of candidates) {
        if (item && typeof item === "object" && item["@type"] === "ProductGroup") {
          return item as Record<string, unknown>;
        }
      }
    } catch {
      /* next */
    }
  }
  return null;
}

/**
 * Primary path: Nuxt SSR payload (EAN + stock qty + sizes).
 * Fallback: ProductGroup JSON-LD (no EAN on baby-walz → usually empty).
 */
export function parseBabyWalzProductHtml(
  html: string,
  productUrl: string,
  defaultStock = babyWalzConfig().defaultStock
): BabyWalzProduct[] {
  const cfg = babyWalzConfig();
  const articleId = articleIdFromBabyWalzUrl(productUrl);
  if (!articleId) return [];

  const payload = parseNuxtPayload(html);
  if (payload) {
    const fromNuxt = productFromNuxt(payload, productUrl, articleId, {
      defaultStock,
      cdnBase: cfg.cdnBase,
    });
    if (fromNuxt.length) return fromNuxt;
  }

  // JSON-LD rarely has GTIN on this shop — kept as last-resort name/price probe only.
  const group = parseJsonLdProductGroup(html);
  if (!group) return [];
  const variants = Array.isArray(group.hasVariant) ? group.hasVariant : [];
  const out: BabyWalzProduct[] = [];
  for (const raw of variants) {
    if (!raw || typeof raw !== "object") continue;
    const variant = raw as Record<string, unknown>;
    const offer =
      variant.offers && typeof variant.offers === "object" && !Array.isArray(variant.offers)
        ? (variant.offers as Record<string, unknown>)
        : null;
    const gtinRaw =
      (typeof variant.gtin === "string" ? variant.gtin : null) ||
      (typeof offer?.gtin === "string" ? offer.gtin : null);
    const barcode = normalizeBabyWalzGtin(gtinRaw);
    if (!barcode) continue;
    const priceChf = Number.parseFloat(String(offer?.price ?? ""));
    if (!Number.isFinite(priceChf) || priceChf <= 0) continue;
    const availability = String(offer?.availability ?? "").toLowerCase();
    const inStock = !availability.includes("outofstock");
    const name =
      decodeHtml(String(variant.name ?? group.name ?? "").trim()) ||
      decodeHtml(html.match(/<h1[^>]*>([^<]+)</i)?.[1]?.trim() ?? "");
    if (!name) continue;
    const brandObj = group.brand;
    const brand =
      typeof brandObj === "string"
        ? brandObj
        : brandObj && typeof brandObj === "object"
          ? String((brandObj as { name?: unknown }).name ?? "").trim() || null
          : null;
    const image =
      typeof variant.image === "string"
        ? variant.image
        : Array.isArray(variant.image) && typeof variant.image[0] === "string"
          ? variant.image[0]
          : null;
    out.push({
      productUrl,
      articleId,
      variantReferenceKey: String(variant.sku ?? articleId),
      name,
      brand,
      productType: null,
      sku: String(variant.sku ?? articleId),
      gtin: barcode.gtin,
      gtinSource: barcode.source,
      priceChf,
      stock: inStock ? defaultStock : 0,
      inStock,
      imageUrl: image,
      sizeRaw: null,
      masterKey: null,
      bulkyOrLoad: false,
    });
  }
  return out;
}

export class BabyWalzClient {
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
    const cfg = babyWalzConfig();
    const useDelay = opts?.delay !== false && cfg.requestDelayMs > 0;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": cfg.userAgent,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "de-CH,de;q=0.9,fr-CH;q=0.8,en;q=0.7",
          },
          signal: AbortSignal.timeout(cfg.requestTimeoutMs),
          redirect: "follow",
        });
        if (res.status === 429 || res.status === 503 || res.status === 502) {
          lastErr = new Error(`HTTP ${res.status}`);
          await sleep(Math.min(4_000 * 2 ** attempt, 90_000));
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (useDelay) await sleep(cfg.requestDelayMs + Math.floor(Math.random() * 120));
        return text;
      } catch (err) {
        lastErr = err;
        await sleep(Math.min(4_000 * 2 ** attempt, 90_000));
      }
    }
    throw new Error(`GET failed ${url}: ${lastErr}`);
  }

  async listProductSitemapUrls(): Promise<string[]> {
    const cfg = babyWalzConfig();
    const indexUrl = cfg.sitemapIndexUrl.startsWith("http")
      ? cfg.sitemapIndexUrl
      : `${this.siteRoot()}${cfg.sitemapIndexUrl.startsWith("/") ? "" : "/"}${cfg.sitemapIndexUrl}`;
    const xml = await this.fetchText(indexUrl, { delay: false });
    const out: string[] = [];
    for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/gi)) {
      const url = match[1].trim();
      if (/\/sitemap\/products(?:_\d+)?\.xml$/i.test(url)) out.push(url);
    }
    return out;
  }

  async listProductUrls(maxProducts?: number): Promise<string[]> {
    const cfg = babyWalzConfig();
    const sitemaps = await this.listProductSitemapUrls();
    const out: string[] = [];
    const seen = new Set<string>();

    for (const sitemapUrl of sitemaps) {
      const xml = await this.fetchText(sitemapUrl, { delay: false });
      for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/gi)) {
        const url = match[1].trim();
        if (!isBabyWalzProductUrl(url, cfg.localePathPrefix)) continue;
        const canonical = `${url.split("?")[0]!.replace(/\/+$/, "")}/`;
        if (seen.has(canonical)) continue;
        seen.add(canonical);
        out.push(canonical);
        if (maxProducts && out.length >= maxProducts) return out;
      }
    }
    return out;
  }

  async fetchProducts(productUrl: string): Promise<BabyWalzProduct[]> {
    const html = await this.fetchText(productUrl);
    return parseBabyWalzProductHtml(html, productUrl);
  }
}
