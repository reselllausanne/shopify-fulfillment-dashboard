/** Venova.ch (Shopware 5) — gzip sitemap discovery + PDP JSON-LD parser. */

import { gunzipSync } from "node:zlib";
import { isValidGtin } from "@/galaxus/exports/feedValidation";

const USER_AGENT =
  process.env.SCRAPER_USER_AGENT ||
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const VENOVA_BASE = "https://www.venova.ch";
export const VENOVA_SITEMAP_INDEX_URL = "https://www.venova.ch/de/sitemap_index.xml";

export type VenovaProduct = {
  productUrl: string;
  name: string;
  brand: string | null;
  productType: string | null;
  sku: string;
  orderNumber: string | null;
  mpn: string | null;
  gtin: string;
  gtinSource: string;
  priceChf: number;
  stock: number;
  inStock: boolean;
  stockSource: string;
  weightKg: number | null;
  imageUrl: string | null;
};

export function venovaConfig() {
  return {
    userAgent: USER_AGENT,
    requestTimeoutMs: Number(process.env.SCRAPER_REQUEST_TIMEOUT_MS || 45_000),
    requestDelayMs: Math.max(
      0,
      Number(process.env.SCRAPER_VEN_REQUEST_DELAY_MS ?? process.env.SCRAPER_REQUEST_DELAY_MS ?? 120)
    ),
    productConcurrency: Math.max(1, Number(process.env.SCRAPER_VEN_CONCURRENCY || 6)),
    /** Only used when Sofort verfügbar but no qty signal and requireExactQty=0. */
    defaultStock: Math.max(1, Number(process.env.SCRAPER_VEN_DEFAULT_STOCK || 1)),
    /** If 1: stock=0 unless we have stock--quantity or sQuantity max. */
    requireExactQty: String(process.env.SCRAPER_VEN_REQUIRE_EXACT_QTY ?? "1") !== "0",
    sitemapIndexUrl: String(process.env.SCRAPER_VEN_SITEMAP_INDEX_URL || VENOVA_SITEMAP_INDEX_URL).trim(),
    locale: String(process.env.SCRAPER_VEN_LOCALE || "de").trim().toLowerCase() || "de",
    excludePathPrefixes: parseVenovaExcludePrefixes(),
  };
}

function parseVenovaExcludePrefixes(): string[] {
  const raw =
    process.env.SCRAPER_VEN_EXCLUDE_PATH_PREFIXES ??
    "/de/garantieverlaengerung,/de/montageservice,/de/montageservice-venova,/de/custom";
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

export function isVenovaExcludedPath(pathname: string, prefixes = parseVenovaExcludePrefixes()): boolean {
  const path = pathname.toLowerCase();
  return prefixes.some((prefix) => {
    const p = prefix.toLowerCase().startsWith("/") ? prefix.toLowerCase() : `/${prefix.toLowerCase()}`;
    return path === p || path.startsWith(`${p}/`);
  });
}

/**
 * Shopware 5 PDP: /{locale}/…/{categoryId}/{slug}[/{extra}]
 * categoryId is numeric; slug is hyphenated.
 */
export function isVenovaProductUrl(url: string, locale = venovaConfig().locale): boolean {
  try {
    const u = new URL(url);
    if (!/(^|\.)venova\.ch$/i.test(u.hostname)) return false;
    const pathname = u.pathname;
    if (isVenovaExcludedPath(pathname)) return false;
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length < 3) return false;
    if (segments[0]!.toLowerCase() !== locale.toLowerCase()) return false;
    const idIdx = segments.findIndex((s, i) => i > 0 && /^\d+$/.test(s));
    if (idIdx < 0) return false;
    const slug = segments[idIdx + 1];
    if (!slug || slug.length < 2) return false;
    return true;
  } catch {
    return false;
  }
}

export function normalizeVenovaGtin(raw: string | null | undefined): { gtin: string; source: string } | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits || /^0+$/.test(digits)) return null;
  if (!isValidGtin(digits)) return null;
  return { gtin: digits, source: digits.length === 13 ? "gtin13" : "gtin" };
}

function parseAvailability(value: string | null | undefined): boolean {
  const raw = String(value ?? "").toLowerCase();
  if (!raw) return false;
  if (raw.includes("outofstock") || raw.includes("discontinued") || raw.includes("soldout")) return false;
  // LimitedAvailability = Liefertermin unbekannt — not sellable.
  if (raw.includes("limitedavailability")) return false;
  return raw.includes("instock") || raw.includes("preorder") || raw.includes("backorder");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseMainDeliveryBlock(html: string, orderNumber: string | null): string {
  if (orderNumber) {
    const re = new RegExp(
      `product--delivery\\s+for-${escapeRegExp(orderNumber)}[\\s\\S]{0,1200}`,
      "i"
    );
    const m = html.match(re);
    if (m) return m[0];
  }
  return html.match(/class="[^"]*product--delivery[^"]*"[\s\S]{0,1200}/i)?.[0] ?? "";
}

/** True only for green "Sofort verfügbar" on main PDP delivery block. */
export function isVenovaSofortVerfuegbar(deliveryHtml: string): boolean {
  const block = deliveryHtml.toLowerCase();
  if (block.includes("delivery--text-more-is-coming")) return false;
  if (block.includes("delivery--text-not-available")) return false;
  if (block.includes("liefertermin unbekannt")) return false;
  if (block.includes("nicht verfügbar") || block.includes("nicht verfuegbar")) return false;
  return (
    block.includes("delivery--text-available") ||
    block.includes("sofort verfügbar") ||
    block.includes("sofort verfuegbar")
  );
}

function parseStockQty(html: string): number | null {
  const m =
    html.match(/stock--quantity-number[^>]*>\s*(\d+)\s*</i) ||
    html.match(/Nur noch[\s\S]{0,80}?(\d+)\s*Stück/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Shopware buybox qty select — max option ≈ available when Sofort verfügbar. */
export function parseVenovaQuantitySelectMax(html: string): number | null {
  const select =
    html.match(/<select[^>]*name=["']sQuantity["'][^>]*>([\s\S]*?)<\/select>/i)?.[1] ??
    html.match(/<select[^>]*id=["']sQuantity["'][^>]*>([\s\S]*?)<\/select>/i)?.[1] ??
    null;
  if (!select) return null;
  const values = [...select.matchAll(/value=["'](\d+)["']/gi)].map((m) => Number(m[1]));
  const positive = values.filter((n) => Number.isFinite(n) && n > 0);
  if (!positive.length) return null;
  return Math.max(...positive);
}

/** Parse article weight from description / spec tables. null = not published on PDP. */
export function parseVenovaWeightKg(html: string): number | null {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#\d+;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  const candidates: number[] = [];

  const pushKg = (raw: string) => {
    const n = Number.parseFloat(raw.replace(",", "."));
    // Ignore noise / absurd (shipping Planzer cap ~few tonnes still; >2t = junk)
    if (Number.isFinite(n) && n > 0 && n < 2000) candidates.push(n);
  };

  for (const m of text.matchAll(/\bMaschinengewicht\b\s*:?\s*(\d+(?:[.,]\d+)?)\s*kg\b/gi)) {
    pushKg(m[1]!);
  }
  for (const m of text.matchAll(/\bGewicht\b\s*:?\s*(?:von\s+)?(\d+(?:[.,]\d+)?)\s*kg\b/gi)) {
    pushKg(m[1]!);
  }
  for (const m of text.matchAll(/\bGewicht\b\s*(?:von\s+)?(\d+(?:[.,]\d+)?)\s*(?:g|gramm)\b/gi)) {
    const grams = Number.parseFloat(m[1]!.replace(",", "."));
    if (Number.isFinite(grams) && grams > 0) pushKg(String(grams / 1000));
  }

  if (!candidates.length) return null;
  // Prefer heaviest stated weight (shipping-relevant article mass).
  return Math.round(Math.max(...candidates) * 1000) / 1000;
}

/**
 * Sellable only when schema InStock AND Sofort verfügbar.
 * Qty: stock--quantity-number → else sQuantity max → else default/0 per config.
 */
export function resolveVenovaStock(input: {
  availability: string | null | undefined;
  deliveryHtml: string;
  pageHtml: string;
  defaultStock: number;
  requireExactQty: boolean;
}): { inStock: boolean; stock: number; stockSource: string } {
  const schemaOk = parseAvailability(input.availability);
  const sofort = isVenovaSofortVerfuegbar(input.deliveryHtml);
  if (!schemaOk || !sofort) {
    return {
      inStock: false,
      stock: 0,
      stockSource: !schemaOk ? "schema_not_instock" : "not_sofort_verfuegbar",
    };
  }

  const explicit = parseStockQty(input.pageHtml);
  if (explicit != null) {
    return { inStock: true, stock: explicit, stockSource: "stock_quantity_number" };
  }

  const selectMax = parseVenovaQuantitySelectMax(input.pageHtml);
  if (selectMax != null) {
    return { inStock: true, stock: selectMax, stockSource: "sQuantity_max" };
  }

  if (input.requireExactQty) {
    return { inStock: false, stock: 0, stockSource: "sofort_but_no_exact_qty" };
  }
  return { inStock: true, stock: input.defaultStock, stockSource: "default_stock" };
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

function parseOrderNumber(html: string): string | null {
  return (
    html.match(/name=["']sAdd["']\s+value=["']([^"']+)["']/i)?.[1]?.trim() ||
    html.match(
      /Artikel-Nr\.\s*:[\s\S]{0,120}?class="entry--content"[^>]*>\s*([A-Za-z0-9._-]+)\s*</i
    )?.[1]?.trim() ||
    html.match(/Artikel-Nr\.\s*:\s*([A-Za-z0-9._-]+)/i)?.[1]?.trim() ||
    null
  );
}

function parseMpn(html: string): string | null {
  return (
    html.match(
      /Hersteller-Art\.-Nr\.\s*:[\s\S]{0,120}?class="entry--content"[^>]*>\s*([A-Za-z0-9._/-]+)\s*</i
    )?.[1]?.trim() ||
    html.match(/Hersteller-Art\.-Nr\.\s*:\s*([A-Za-z0-9._/-]+)/i)?.[1]?.trim() ||
    null
  );
}

function parseBreadcrumbs(html: string): string[] {
  const block =
    html.match(/class="[^"]*breadcrumb[^"]*"[\s\S]*?<\/(?:nav|ol|ul)>/i)?.[0] ??
    html.match(/itemtype="https?:\/\/schema\.org\/BreadcrumbList"[\s\S]*?<\/(?:nav|ol|ul|div)>/i)?.[0] ??
    "";
  const names = [
    ...block.matchAll(/itemprop="name"[^>]*>([^<]+)</gi),
    ...block.matchAll(/class="[^"]*breadcrumb--link[^"]*"[^>]*>([^<]+)</gi),
  ]
    .map((m) => decodeHtml(m[1]!.replace(/\s+/g, " ").trim()))
    .filter((b) => b && !/^(home|übersicht|uebersicht)$/i.test(b));
  return [...new Set(names)];
}

function productTypeFromUrl(productUrl: string, locale: string): string | null {
  try {
    const segments = new URL(productUrl).pathname.split("/").filter(Boolean);
    if (segments[0]?.toLowerCase() !== locale.toLowerCase()) return null;
    const idIdx = segments.findIndex((s, i) => i > 0 && /^\d+$/.test(s));
    if (idIdx <= 1) return null;
    return segments
      .slice(1, idIdx)
      .map((s) => decodeURIComponent(s))
      .join(" > ");
  } catch {
    return null;
  }
}

export function parseVenovaProductHtml(
  html: string,
  productUrl: string,
  defaultStock = venovaConfig().defaultStock
): VenovaProduct | null {
  const product = parseJsonLdProduct(html);
  if (!product) return null;

  const name =
    decodeHtml(String(product.name ?? "").trim()) ||
    decodeHtml(html.match(/<h1[^>]*>([^<]+)</i)?.[1]?.trim() ?? "");
  if (!name) return null;

  const offer = offerFromProduct(product);
  const gtinRaw =
    (typeof product.gtin13 === "string" ? product.gtin13 : null) ||
    (typeof product.gtin === "string" ? product.gtin : null) ||
    (typeof product.gtin14 === "string" ? product.gtin14 : null) ||
    (typeof product.gtin12 === "string" ? product.gtin12 : null) ||
    (typeof offer?.gtin === "string" ? offer.gtin : null);
  const barcode = normalizeVenovaGtin(gtinRaw);
  if (!barcode) return null;

  const priceRaw =
    offer?.price ??
    html.match(/class="[^"]*liveshopping--price[^"]*"[^>]*>\s*([0-9][0-9.'\s,]*)\s*(?:&nbsp;|\s)*CHF/i)?.[1] ??
    html.match(/class="[^"]*price--content[^"]*"[^>]*>\s*([0-9][0-9.'\s,]*)/i)?.[1] ??
    null;
  const priceChf = Number.parseFloat(
    String(priceRaw ?? "")
      .replace(/'/g, "")
      .replace(/\s/g, "")
      .replace(",", ".")
  );
  if (!Number.isFinite(priceChf) || priceChf <= 0) return null;

  const orderNumber =
    (typeof product.sku === "string" ? product.sku.trim() : null) || parseOrderNumber(html);
  const cfg = venovaConfig();
  const deliveryHtml = parseMainDeliveryBlock(html, orderNumber);
  const stockInfo = resolveVenovaStock({
    availability: typeof offer?.availability === "string" ? offer.availability : null,
    deliveryHtml,
    pageHtml: html,
    defaultStock: defaultStock ?? cfg.defaultStock,
    requireExactQty: cfg.requireExactQty,
  });

  const mpn = parseMpn(html);
  const sku = orderNumber || mpn || barcode.gtin;
  const weightKg = parseVenovaWeightKg(html);

  const crumbs = parseBreadcrumbs(html);
  const locale = cfg.locale;
  const productType =
    crumbs.length > 0 ? crumbs.join(" > ") : productTypeFromUrl(productUrl, locale);

  return {
    productUrl,
    name,
    brand: brandName(product),
    productType,
    sku,
    orderNumber,
    mpn,
    gtin: barcode.gtin,
    gtinSource: barcode.source,
    priceChf,
    stock: stockInfo.stock,
    inStock: stockInfo.inStock,
    stockSource: stockInfo.stockSource,
    weightKg,
    imageUrl: imageUrl(product),
  };
}

async function fetchBytes(url: string, timeoutMs: number, userAgent: string): Promise<ArrayBuffer> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": userAgent,
          Accept: "application/xml,text/xml,application/gzip,*/*",
          "Accept-Language": "de-CH,de;q=0.9,en;q=0.8",
        },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
      if (res.status === 429 || res.status === 503 || res.status === 502) {
        lastErr = new Error(`HTTP ${res.status}`);
        await sleep(Math.min(4_000 * 2 ** attempt, 90_000));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.arrayBuffer();
    } catch (err) {
      lastErr = err;
      await sleep(Math.min(4_000 * 2 ** attempt, 90_000));
    }
  }
  throw new Error(`GET failed ${url}: ${lastErr}`);
}

export function decodePossiblyGzippedXml(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return gunzipSync(Buffer.from(bytes)).toString("utf8");
  }
  return new TextDecoder("utf-8").decode(bytes);
}

export class VenovaClient {
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
    const cfg = venovaConfig();
    const useDelay = opts?.delay !== false && cfg.requestDelayMs > 0;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": cfg.userAgent,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "de-CH,de;q=0.9,en;q=0.8",
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

  async listProductUrls(maxProducts?: number): Promise<string[]> {
    const cfg = venovaConfig();
    const indexUrl = cfg.sitemapIndexUrl.startsWith("http")
      ? cfg.sitemapIndexUrl
      : `${this.siteRoot()}${cfg.sitemapIndexUrl.startsWith("/") ? "" : "/"}${cfg.sitemapIndexUrl}`;
    const indexXml = await this.fetchText(indexUrl, { delay: false });
    const shardUrls = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1]!.trim());
    const out: string[] = [];
    const seen = new Set<string>();

    for (const shardUrl of shardUrls) {
      try {
        const buf = await fetchBytes(shardUrl, cfg.requestTimeoutMs, cfg.userAgent);
        const xml = decodePossiblyGzippedXml(buf);
        for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/gi)) {
          const url = match[1]!.trim();
          if (!isVenovaProductUrl(url, cfg.locale)) continue;
          const canonical = url.split("?")[0]!;
          if (seen.has(canonical)) continue;
          seen.add(canonical);
          out.push(canonical);
          if (maxProducts && out.length >= maxProducts) return out;
        }
      } catch (err) {
        console.warn(`[SCRAPER] ven sitemap shard failed ${shardUrl}:`, (err as Error)?.message || err);
      }
    }
    return out;
  }

  async fetchProduct(productUrl: string): Promise<VenovaProduct | null> {
    const html = await this.fetchText(productUrl);
    return parseVenovaProductHtml(html, productUrl);
  }
}
