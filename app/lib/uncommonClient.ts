import { isValidGtin } from "@/galaxus/exports/feedValidation";

const DEFAULT_UA =
  process.env.SCRAPER_USER_AGENT ||
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** WooCommerce Store API caps ~50 here; 100 → Cloudflare 403. */
export const UNCOMMON_MAX_PAGE_SIZE = 50;

export type UncommonWooCategory = { id: number; name: string; slug: string; link?: string };
export type UncommonWooBrand = { id: number; name: string; slug: string; link?: string };
export type UncommonWooVariationRef = { id: number; attributes: Array<{ name: string; value: string }> };
export type UncommonWooPrices = {
  price: string;
  regular_price: string;
  sale_price: string;
  currency_code?: string;
  currency_minor_unit?: number;
};

export type UncommonWooProduct = {
  id: number;
  name: string;
  slug: string;
  parent: number;
  type: string;
  variation: string;
  permalink: string;
  sku: string;
  description?: string;
  short_description?: string;
  on_sale?: boolean;
  prices: UncommonWooPrices;
  images: Array<{ id: number; src: string; thumbnail?: string; name?: string; alt?: string }>;
  categories: UncommonWooCategory[];
  brands: UncommonWooBrand[];
  attributes?: Array<{ name: string; terms?: Array<{ name: string; slug: string }> }>;
  variations: UncommonWooVariationRef[];
  has_options?: boolean;
  is_in_stock: boolean;
  is_purchasable?: boolean;
  is_on_backorder?: boolean;
  stock_availability?: { text?: string; class?: string };
  add_to_cart?: { minimum?: number; maximum?: number; multiple_of?: number; text?: string };
  weight?: string;
};

export type UncommonSellDecision = {
  sellable: boolean;
  stock: number;
  reason: string;
  stockSource: string;
};

export type UncommonProduct = {
  productUrl: string;
  wooId: number;
  parentId: number | null;
  type: string;
  name: string;
  brand: string | null;
  productType: string | null;
  sku: string;
  gtin: string;
  gtinSource: string;
  priceChf: number;
  stock: number;
  sellable: boolean;
  sellReason: string;
  stockSource: string;
  imageUrl: string | null;
  categories: string[];
  variationLabel: string | null;
  weightKg: number | null;
};

export function uncommonConfig() {
  return {
    userAgent: DEFAULT_UA,
    pageSize: Math.min(
      UNCOMMON_MAX_PAGE_SIZE,
      Math.max(1, Number(process.env.SCRAPER_TUS_PAGE_SIZE || UNCOMMON_MAX_PAGE_SIZE))
    ),
    requestDelayMs: Math.max(
      0,
      Number(process.env.SCRAPER_TUS_REQUEST_DELAY_MS ?? process.env.SCRAPER_REQUEST_DELAY_MS ?? 80)
    ),
    requestTimeoutMs: Math.max(5_000, Number(process.env.SCRAPER_TUS_REQUEST_TIMEOUT_MS || 45_000)),
    maxRetries: Math.max(1, Number(process.env.SCRAPER_TUS_MAX_RETRIES || 5)),
    productConcurrency: Math.max(1, Number(process.env.SCRAPER_TUS_CONCURRENCY || 6)),
    variationConcurrency: Math.max(1, Number(process.env.SCRAPER_TUS_VARIATION_CONCURRENCY || 8)),
    /** CH Post / same-day shop → short Galaxus lead. */
    leadTimeDays: Math.max(1, Number(process.env.SCRAPER_TUS_LEAD_TIME_DAYS || 2)),
    requireExactQty: String(process.env.SCRAPER_TUS_REQUIRE_EXACT_QTY ?? "1") !== "0",
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function decodeUncommonHtml(value: string): string {
  return value
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&#038;/g, "&")
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

export function parseUncommonChfPrice(prices: UncommonWooPrices | null | undefined): number | null {
  const raw = String(prices?.price ?? prices?.sale_price ?? prices?.regular_price ?? "").trim();
  if (!raw) return null;
  const minor = Number.parseInt(raw, 10);
  if (!Number.isFinite(minor) || minor <= 0) return null;
  const unit = prices?.currency_minor_unit ?? 2;
  return Math.round((minor / 10 ** unit) * 100) / 100;
}

export function normalizeUncommonGtin(raw: string | null | undefined): { gtin: string; source: string } | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits || /^0+$/.test(digits)) return null;
  if (!isValidGtin(digits)) return null;
  return { gtin: digits, source: digits.length === 13 ? "gtin13" : "gtin" };
}

/** Gift cards / vouchers — never sell on Galaxus. */
export function isUncommonGiftCard(product: Pick<UncommonWooProduct, "type" | "slug" | "name" | "sku">): boolean {
  const type = String(product.type || "").toLowerCase();
  if (type.includes("gift")) return true;
  const blob = `${product.slug || ""} ${product.name || ""} ${product.sku || ""}`.toLowerCase();
  return /geschenkgutschein|gift\s*card|gutschein/.test(blob);
}

/**
 * WEL lesson: preorder often looks in-stock with a qty.
 * TUS marks preorders via product_cat slug/name (vorbestellbar*, *-preorder),
 * not schema.org PreOrder (those still say InStock).
 */
export function isUncommonPreorderSignal(
  product: Pick<UncommonWooProduct, "name" | "slug" | "sku" | "categories" | "description" | "short_description">
): boolean {
  for (const cat of product.categories || []) {
    const slug = String(cat.slug || "").toLowerCase();
    const name = String(cat.name || "").toLowerCase();
    if (/vorbestell|pre-?order/.test(slug) || /vorbestell|pre-?order/.test(name)) return true;
  }
  const blob = [
    product.name,
    product.slug,
    product.sku,
    product.description,
    product.short_description,
  ]
    .map((s) => String(s || "").toLowerCase())
    .join(" ");
  return /\bvorbestell|\bpre-?orders?\b|\bvorverkauf\b|\bcoming\s*soon\b/.test(blob);
}

/**
 * Parse physical qty from Store API stock text / cart max.
 * Never trust maximum≥9000 (OOS still exposes 9999 + is_purchasable).
 */
export function parseUncommonStockQty(product: UncommonWooProduct): {
  qty: number | null;
  source: string;
} {
  const text = String(product.stock_availability?.text || "").trim();
  const cls = String(product.stock_availability?.class || "").toLowerCase();

  if (/out-of-stock/.test(cls) || /nicht\s+(auf\s+lager|vorrätig|verfuegbar|verfügbar)/i.test(text)) {
    return { qty: 0, source: "oos_text" };
  }

  const mVorr = text.match(/(\d+)\s*vorrätig/i);
  if (mVorr) {
    const n = Number(mVorr[1]);
    if (Number.isFinite(n) && n >= 0) return { qty: n, source: "stock_text_vorraetig" };
  }
  const mVerf = text.match(/verf(?:ü|ue)gbar\s*:\s*(\d+)/i);
  if (mVerf) {
    const n = Number(mVerf[1]);
    if (Number.isFinite(n) && n >= 0) return { qty: n, source: "stock_text_verfuegbar" };
  }
  const mAny = text.match(/(\d+)/);
  if (mAny && /lager|stock|stück|stueck/i.test(text)) {
    const n = Number(mAny[1]);
    if (Number.isFinite(n) && n >= 0) return { qty: n, source: "stock_text_digit" };
  }

  const max = Number(product.add_to_cart?.maximum);
  // 9999 = Woo "unlimited" placeholder on OOS / untracked — WEL-style oversell trap.
  if (Number.isFinite(max) && max > 0 && max < 9000) {
    return { qty: max, source: "add_to_cart_maximum" };
  }

  return { qty: null, source: "unknown" };
}

/**
 * Sellable only with explicit positive qty + not preorder/backorder/gift.
 * Mirrors WEL fix: available:true + qty 0 / continue ≠ physical stock.
 */
export function resolveUncommonSellable(
  product: UncommonWooProduct,
  opts?: { requireExactQty?: boolean }
): UncommonSellDecision {
  const requireExactQty = opts?.requireExactQty ?? uncommonConfig().requireExactQty;

  if (isUncommonGiftCard(product)) {
    return { sellable: false, stock: 0, reason: "gift_card", stockSource: "n/a" };
  }
  if (isUncommonPreorderSignal(product)) {
    return { sellable: false, stock: 0, reason: "preorder", stockSource: "category_or_copy" };
  }
  if (product.is_on_backorder) {
    return { sellable: false, stock: 0, reason: "backorder", stockSource: "is_on_backorder" };
  }
  if (!product.is_in_stock) {
    return { sellable: false, stock: 0, reason: "oos_flag", stockSource: "is_in_stock" };
  }

  const parsed = parseUncommonStockQty(product);
  if (parsed.qty === null) {
    if (requireExactQty) {
      return { sellable: false, stock: 0, reason: "qty_hidden", stockSource: parsed.source };
    }
    return { sellable: true, stock: 1, reason: "in_stock_no_qty", stockSource: parsed.source };
  }
  if (parsed.qty <= 0) {
    return { sellable: false, stock: 0, reason: "qty_zero", stockSource: parsed.source };
  }
  return { sellable: true, stock: parsed.qty, reason: "ok", stockSource: parsed.source };
}

export function extractUncommonGtinFromHtml(html: string): { gtin: string; source: string } | null {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of blocks) {
    const raw = match[1]?.trim();
    if (!raw || (!/gtin/i.test(raw) && !/"Product"/i.test(raw))) continue;
    try {
      const data = JSON.parse(raw) as unknown;
      const nodes: unknown[] = Array.isArray(data)
        ? data
        : data && typeof data === "object" && Array.isArray((data as { "@graph"?: unknown })["@graph"])
          ? ((data as { "@graph": unknown[] })["@graph"] as unknown[])
          : [data];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const obj = node as Record<string, unknown>;
        const type = obj["@type"];
        const isProduct =
          type === "Product" || (Array.isArray(type) && type.includes("Product"));
        if (!isProduct && !obj.gtin && !obj.gtin13 && !obj.gtin14) continue;
        const gtinRaw =
          (typeof obj.gtin13 === "string" && obj.gtin13) ||
          (typeof obj.gtin14 === "string" && obj.gtin14) ||
          (typeof obj.gtin === "string" && obj.gtin) ||
          null;
        const normalized = normalizeUncommonGtin(gtinRaw);
        if (normalized) return normalized;
      }
    } catch {
      /* next */
    }
  }
  const m =
    html.match(/"gtin13"\s*:\s*"(\d{8,14})"/i) ||
    html.match(/"gtin"\s*:\s*"(\d{8,14})"/i) ||
    html.match(/itemprop=["']gtin13["'][^>]*content=["'](\d{8,14})["']/i);
  return normalizeUncommonGtin(m?.[1] ?? null);
}

export function isSchemaPreorderAvailability(html: string): boolean {
  return /schema\.org\/PreOrder/i.test(html) || /"availability"\s*:\s*"[^"]*PreOrder/i.test(html);
}

export function isRetryableUncommonError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? "").toLowerCase();
  return (
    msg.includes("http 429") ||
    msg.includes("http 502") ||
    msg.includes("http 503") ||
    msg.includes("http 504") ||
    msg.includes("http 403") ||
    msg.includes("timeout") ||
    msg.includes("fetch failed")
  );
}

export class UncommonClient {
  constructor(private readonly baseUrl: string) {}

  private apiUrl(path: string, params?: Record<string, string | number>): string {
    const u = new URL(`${this.baseUrl.replace(/\/+$/, "")}/wp-json/wc/store/v1/${path.replace(/^\/+/, "")}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
    }
    return u.href;
  }

  async fetchJson<T>(url: string): Promise<{ data: T; total: number; totalPages: number }> {
    const cfg = uncommonConfig();
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < cfg.maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": cfg.userAgent,
            Accept: "application/json",
            "Accept-Language": "de-CH,de;q=0.9,en;q=0.8",
          },
          signal: AbortSignal.timeout(cfg.requestTimeoutMs),
        });
        if (!res.ok) throw new Error(`Uncommon HTTP ${res.status} ${url}`);
        const data = (await res.json()) as T;
        const total = Number(res.headers.get("x-wp-total") || 0);
        const totalPages = Number(res.headers.get("x-wp-totalpages") || 0);
        if (cfg.requestDelayMs) await sleep(cfg.requestDelayMs);
        return { data, total, totalPages };
      } catch (err) {
        lastErr = err;
        if (!isRetryableUncommonError(err) || attempt >= cfg.maxRetries - 1) break;
        await sleep(Math.min(4_000 * 2 ** attempt, 60_000));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  async fetchText(url: string): Promise<string> {
    const cfg = uncommonConfig();
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < cfg.maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": cfg.userAgent,
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "de-CH,de;q=0.9,en;q=0.8",
          },
          signal: AbortSignal.timeout(cfg.requestTimeoutMs),
        });
        if (!res.ok) throw new Error(`Uncommon HTTP ${res.status} ${url}`);
        const text = await res.text();
        if (cfg.requestDelayMs) await sleep(cfg.requestDelayMs);
        return text;
      } catch (err) {
        lastErr = err;
        if (!isRetryableUncommonError(err) || attempt >= cfg.maxRetries - 1) break;
        await sleep(Math.min(4_000 * 2 ** attempt, 60_000));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  async *iterProducts(maxProducts?: number): AsyncGenerator<{ product: UncommonWooProduct; total: number }> {
    const cfg = uncommonConfig();
    let page = 1;
    let total = 0;
    let yielded = 0;

    for (;;) {
      const { data: batch, total: t, totalPages } = await this.fetchJson<UncommonWooProduct[]>(
        this.apiUrl("products", { per_page: cfg.pageSize, page })
      );
      if (!total) total = t;
      if (!batch.length) break;

      for (const product of batch) {
        if (product.type !== "variable" && product.type !== "simple") continue;
        yielded++;
        yield { product, total };
        if (maxProducts && yielded >= maxProducts) return;
      }

      if (page >= totalPages) break;
      page++;
    }
  }

  fetchProductById(id: number): Promise<UncommonWooProduct> {
    return this.fetchJson<UncommonWooProduct>(this.apiUrl(`products/${id}`)).then((r) => r.data);
  }

  async enrichFromPdp(
    product: UncommonWooProduct,
    decision: UncommonSellDecision
  ): Promise<UncommonProduct | null> {
    const priceChf = parseUncommonChfPrice(product.prices);
    if (!priceChf || priceChf <= 0) return null;

    const productUrl = String(product.permalink || "").split("?")[0] || "";
    if (!productUrl) return null;

    let html = "";
    try {
      html = await this.fetchText(productUrl);
    } catch {
      return null;
    }

    // Extra guard: schema PreOrder (rare on TUS — cats usually catch it).
    let sellable = decision.sellable;
    let stock = decision.stock;
    let reason = decision.reason;
    if (sellable && isSchemaPreorderAvailability(html)) {
      sellable = false;
      stock = 0;
      reason = "schema_preorder";
    }

    const gtin = extractUncommonGtinFromHtml(html);
    if (!gtin) return null;

    const brand = product.brands?.[0]?.name ? decodeUncommonHtml(product.brands[0].name) : null;
    const productType = product.categories?.[0]?.name
      ? decodeUncommonHtml(product.categories[0].name)
      : null;
    const weightRaw = Number.parseFloat(String(product.weight || "").replace(",", "."));
    const weightKg = Number.isFinite(weightRaw) && weightRaw > 0 ? weightRaw : null;
    const variationLabel = String(product.variation || "").trim() || null;
    const baseName = decodeUncommonHtml(product.name || "");
    const name = variationLabel ? `${baseName} — ${variationLabel}` : baseName;

    return {
      productUrl,
      wooId: product.id,
      parentId: product.parent > 0 ? product.parent : null,
      type: product.type,
      name,
      brand,
      productType,
      sku: String(product.sku || "").trim() || gtin.gtin,
      gtin: gtin.gtin,
      gtinSource: gtin.source,
      priceChf,
      stock: sellable ? stock : 0,
      sellable,
      sellReason: reason,
      stockSource: decision.stockSource,
      imageUrl: product.images?.[0]?.src || null,
      categories: (product.categories || []).map((c) => c.slug),
      variationLabel,
      weightKg,
    };
  }
}
