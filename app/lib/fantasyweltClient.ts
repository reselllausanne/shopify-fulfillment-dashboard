import { isValidGtin } from "@/galaxus/exports/feedValidation";
import { computeFantasyweltLandedCost } from "@/app/lib/fantasyweltPricing";

const USER_AGENT =
  process.env.SCRAPER_USER_AGENT ||
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const FANTASYWELT_BASE = "https://www.fantasywelt.de";

/** Seed category paths — expand via env SCRAPER_FAN_CATEGORY_PATHS (comma-separated). */
export const FANTASYWELT_DEFAULT_CATEGORIES = [
  "Alle-deutschen-Brettspiele",
  "Alle-englischen-Brettspiele",
  "Neuheiten",
  "Bestseller",
  "SALE",
  "Warhammer-40k",
  "Age-of-Sigmar",
  "Kill-Team",
  "The-Old-World",
  "Tabletop-Miniaturen",
  "Brett-Kartenspiele-Puzzle",
  "Solospiele",
  "Familienspiele",
  "Kinderspiele",
  "Puzzle",
  "Kickstarter-Games",
  "Top-Games",
];

export type FantasyweltProduct = {
  productUrl: string;
  name: string;
  brand: string | null;
  sku: string | null;
  gtin: string | null;
  gtinSource: string | null;
  priceEur: number | null;
  availability: "InStock" | "PreOrder" | "OutOfStock" | "Unknown";
  stockLabel: string | null;
  leadTimeDays: string | null;
  imageUrl: string | null;
  jtlArticleId: string | null;
};

export function fantasyweltConfig() {
  const catsRaw = String(process.env.SCRAPER_FAN_CATEGORY_PATHS || "").trim();
  const categories = catsRaw
    ? catsRaw
        .split(",")
        .map((s) => s.trim().replace(/^\/+/, "").replace(/\/+$/, ""))
        .filter(Boolean)
    : FANTASYWELT_DEFAULT_CATEGORIES;
  return {
    userAgent: USER_AGENT,
    requestDelayMs: Math.max(
      0,
      Number(process.env.SCRAPER_FAN_REQUEST_DELAY_MS ?? process.env.SCRAPER_REQUEST_DELAY_MS ?? 400)
    ),
    gotoTimeoutMs: Math.max(15_000, Number(process.env.SCRAPER_FAN_GOTO_TIMEOUT_MS || 60_000)),
    cfWaitMs: Math.max(5_000, Number(process.env.SCRAPER_FAN_CF_WAIT_MS || 25_000)),
    maxCategoryPages: Math.max(1, Number(process.env.SCRAPER_FAN_MAX_CATEGORY_PAGES || 500)),
    defaultStock: Math.max(1, Number(process.env.SCRAPER_DEFAULT_STOCK || 5)),
    categories,
    progressFile:
      process.env.SCRAPER_FAN_PROGRESS_FILE ||
      "/app/.data/fantasywelt-scrape-progress.json",
    deferImageSync: String(process.env.SCRAPER_FAN_DEFER_IMAGE_SYNC ?? "1") !== "0",
  };
}

export function isFantasyweltCloudflare(html: string): boolean {
  const low = String(html ?? "").slice(0, 8_000).toLowerCase();
  if (!low.trim()) return true;
  if (low.includes("just a moment") || low.includes("cf-browser-verification")) return true;
  if (low.includes("challenge-platform") && low.length < 20_000) return true;
  if (low.includes("vérification de sécurité") || low.includes("checking your browser")) return true;
  return false;
}

const CATEGORY_BLOCKLIST = new Set(
  [
    "warenkorb",
    "registrieren",
    "passwort-vergessen",
    "newsletter",
    "impressum",
    "datenschutz",
    "agb",
    "kontakt",
    "login",
    "wunschliste",
    "blog",
    "neuheiten",
    "bestseller",
    "sale",
  ].map((s) => s.toLowerCase())
);

/** Product SEO slugs: hyphenated, not known nav/category-only stubs. */
export function isFantasyweltProductPath(path: string): boolean {
  const p = path.replace(/^\/+/, "").replace(/\/+$/, "").split("?")[0];
  if (!p || p.includes("/")) return false;
  if (!p.includes("-") || p.length < 8) return false;
  if (CATEGORY_BLOCKLIST.has(p.toLowerCase())) return false;
  // Multi-filter category pages
  if (p.includes("__")) return false;
  return true;
}

export function extractFantasyweltProductUrls(html: string, base = FANTASYWELT_BASE): string[] {
  const origin = base.replace(/\/+$/, "");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/href="(https?:\/\/www\.fantasywelt\.de\/[^"#?]+|\/[^"#?]+)"/gi)) {
    let href = match[1];
    if (href.startsWith("/")) href = `${origin}${href}`;
    if (!href.startsWith(origin)) continue;
    const path = href.slice(origin.length).split("#")[0].split("?")[0];
    if (!isFantasyweltProductPath(path)) continue;
    const url = `${origin}${path.startsWith("/") ? path : `/${path}`}`;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

export function categoryPageUrl(base: string, categoryPath: string, page: number): string {
  const origin = base.replace(/\/+$/, "");
  const path = categoryPath.replace(/^\/+/, "").replace(/\/+$/, "");
  if (page <= 1) return `${origin}/${path}`;
  // JTL NOVA often uses ?seite=N
  return `${origin}/${path}?seite=${page}`;
}

function metaItemprop(html: string, prop: string): string | null {
  const reContent = new RegExp(
    `itemprop=["']${prop}["'][^>]*content=["']([^"']+)["']|content=["']([^"']+)["'][^>]*itemprop=["']${prop}["']`,
    "i"
  );
  const m1 = html.match(reContent);
  if (m1) return (m1[1] || m1[2] || "").trim() || null;
  const reText = new RegExp(`<[^>]+itemprop=["']${prop}["'][^>]*>([^<]+)<`, "i");
  const m2 = html.match(reText);
  return m2?.[1]?.replace(/\s+/g, " ").trim() || null;
}

function normalizeBarcode(raw: string | null | undefined): { gtin: string; source: string } | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits || /^0+$/.test(digits)) return null;
  if (!isValidGtin(digits)) return null;
  return { gtin: digits, source: "gtin13" };
}

function parseAvailability(
  href: string | null,
  text: string
): FantasyweltProduct["availability"] {
  const h = String(href || "").toLowerCase();
  if (h.includes("outofstock") || h.includes("soldout") || h.includes("discontinued")) {
    return "OutOfStock";
  }
  if (h.includes("preorder")) return "PreOrder";
  if (h.includes("instock")) return "InStock";
  if (/nicht\s+auf\s+lager|ausverkauft|nicht\s+lieferbar/i.test(text)) return "OutOfStock";
  if (/lieferbar\s+ab|vorbestell/i.test(text)) return "PreOrder";
  if (/auf\s+lager|sofort\s+lieferbar/i.test(text)) return "InStock";
  return "Unknown";
}

/** Parse JTL product HTML (schema.org microdata). */
export function parseFantasyweltProductHtml(html: string, url: string): FantasyweltProduct | null {
  if (isFantasyweltCloudflare(html)) return null;

  const titleRaw = metaItemprop(html, "name") || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  let name = titleRaw.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  name = name
    .replace(/\s*-\s*FantasyWelt\.de.*$/i, "")
    .replace(/,\s*\d+[.,]\d+\s*€\s*$/, "")
    .trim();
  if (!name) {
    const h1 = html.match(/<h1[^>]*itemprop=["']name["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1];
    name = (h1 || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  }
  if (!name) return null;

  const sku =
    metaItemprop(html, "sku") ||
    html.match(/Artikelnummer:\s*<\/strong>\s*<span[^>]*itemprop=["']sku["'][^>]*>([^<]+)/i)?.[1]?.trim() ||
    html.match(/Artikelnummer:\s*([A-Za-z0-9._-]+)/i)?.[1]?.trim() ||
    null;

  const gtinRaw =
    metaItemprop(html, "gtin13") ||
    metaItemprop(html, "gtin") ||
    html.match(/itemprop=["']gtin13["'][^>]*>(\d{8,14})</i)?.[1] ||
    html.match(/EAN:\s*<\/strong>\s*<span[^>]*>(\d{8,14})</i)?.[1] ||
    html.match(/EAN:\s*(\d{8,14})/i)?.[1] ||
    null;
  const barcode = normalizeBarcode(gtinRaw);

  const brand =
    html.match(
      /itemprop=["']brand["'][\s\S]{0,600}?<a[^>]*>\s*([^<]{1,80})\s*<\/a>/i
    )?.[1]
      ?.replace(/\s+/g, " ")
      .trim() ||
    html.match(/Hersteller:\s*([^<\n]+)/i)?.[1]?.replace(/\s+/g, " ").trim() ||
    null;

  const priceRaw = metaItemprop(html, "price");
  const priceEur = priceRaw ? Number.parseFloat(priceRaw.replace(",", ".")) : null;

  const availHref =
    metaItemprop(html, "availability") ||
    html.match(/itemprop=["']availability["'][^>]*href=["']([^"']+)["']/i)?.[1] ||
    html.match(/href=["']([^"']+)["'][^>]*itemprop=["']availability["']/i)?.[1] ||
    null;

  const plain = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const stockLabel =
    plain.match(/auf Lager|nicht auf Lager|lieferbar ab[^.]{0,40}\.?|Sofort lieferbar/i)?.[0] || null;
  const lead =
    plain.match(/Lieferzeit\s+(\d+)\s*[-–]\s*(\d+)\s*Werktage/i) ||
    plain.match(/lieferbar ab\s+(\d{1,2}\.\d{1,2}\.\d{2,4})/i);
  let leadTimeDays: string | null = null;
  if (lead) {
    leadTimeDays = lead[2] && /^\d+$/.test(lead[2]) ? `${lead[1]}-${lead[2]}` : `from_${lead[1]}`;
  }

  const imageUrl =
    metaItemprop(html, "image") ||
    html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
    null;

  const jtlArticleId =
    html.match(/name=["']a["'][^>]*value=["'](\d+)["']/i)?.[1] ||
    html.match(/value=["'](\d+)["'][^>]*name=["']a["']/i)?.[1] ||
    null;

  return {
    productUrl: url,
    name,
    brand,
    sku,
    gtin: barcode?.gtin ?? null,
    gtinSource: barcode?.source ?? null,
    priceEur: Number.isFinite(priceEur) && (priceEur as number) > 0 ? (priceEur as number) : null,
    availability: parseAvailability(availHref, plain),
    stockLabel,
    leadTimeDays,
    imageUrl,
    jtlArticleId,
  };
}

export function fantasyweltSellPriceChf(priceEur: number): number | null {
  return computeFantasyweltLandedCost(priceEur)?.sellPriceChf ?? null;
}

export function formatFantasyweltNote(product: FantasyweltProduct): string {
  const cost = product.priceEur != null ? computeFantasyweltLandedCost(product.priceEur) : null;
  return JSON.stringify({
    type: "fantasywelt_landed_cost",
    productUrl: product.productUrl,
    supplierSku: product.sku,
    jtlArticleId: product.jtlArticleId,
    gtinSource: product.gtinSource,
    availability: product.availability,
    stockLabel: product.stockLabel,
    leadTimeDays: product.leadTimeDays,
    currency: "EUR",
    ...cost,
  });
}
