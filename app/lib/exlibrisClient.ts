/** Ex Libris CH storefront — Next.js __NEXT_DATA__ listing/PDP parser. */

import { isPhysicalExlibrisItem } from "@/app/lib/exlibrisFilters";
import { validateGtin } from "@/app/lib/normalize";

export const EXLIBRIS_BASE = "https://www.exlibris.ch";

export const EXLIBRIS_CATALOG_ROOTS: Record<string, string> = {
  spiele: "/de/hobby-spiele-brettspiele/",
  musik_cd: "/de/musik/cd/",
  musik_vinyl: "/de/musik/vinyl/",
  games: "/de/games/",
};

const SKIP_CATEGORY_SUFFIXES = [
  "/charts-aktuell/",
  "/charts-bestseller/",
  "/charts-dauerbrenner/",
  "/charts-taschenbuch/",
  "/neuheiten/",
  "/vorbestellungen/",
  "/sofort-lieferbar/",
  "/club-aktionen/",
];

export type ExlibrisTile = {
  ean: string;
  title: string;
  url: string;
  buyChf: number;
  currency: string;
  availabilityText: string;
  stockLabel: string;
  imageUrl: string;
  formatLabel: string;
  sampleBucket: string;
  brand: string;
};

export type ExlibrisScrapeProgress = {
  catalog: string;
  catalogRoot: string;
  seenEans: string[];
  pendingCategories: string[];
  doneCategories: string[];
  categoryPages: Record<string, number>;
  rowsWritten: number;
  requests: number;
  updatedAt: string;
};

export function exlibrisConfig() {
  return {
    defaultStock: Math.max(0, Number(process.env.SCRAPER_EXL_DEFAULT_STOCK || 5)),
    requestDelayMs: Math.max(0, Number(process.env.SCRAPER_EXL_REQUEST_DELAY_MS || 400)),
    deferImageSync: String(process.env.SCRAPER_EXL_DEFER_IMAGE_SYNC ?? "1") !== "0",
    flushEvery: Math.max(1, Number(process.env.SCRAPER_EXL_FLUSH_EVERY || 100)),
    resume: String(process.env.SCRAPER_EXL_RESUME ?? "1") !== "0",
    progressFile:
      process.env.SCRAPER_EXL_PROGRESS_FILE || "/app/.data/exlibris-scrape-progress.json",
  };
}

export function catalogPrefix(catalog: string): string {
  if (catalog in EXLIBRIS_CATALOG_ROOTS) return EXLIBRIS_CATALOG_ROOTS[catalog]!;
  if (catalog.startsWith("/de/")) return catalog.endsWith("/") ? catalog : `${catalog}/`;
  throw new Error(`unknown exlibris catalog ${catalog}`);
}

export function categoryPageUrl(path: string, page = 1): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (page <= 1) return `${EXLIBRIS_BASE}${normalized}`;
  return `${EXLIBRIS_BASE}${normalized.replace(/\/$/, "")}/?page=${page}`;
}

function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  const lower = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
  for (const k of keys) {
    const v = lower[k.toLowerCase()];
    if (v !== undefined && v !== null) return v;
  }
  return null;
}

export function extractNextData(html: string): Record<string, unknown> | null {
  const m = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!m?.[1]) return null;
  try {
    return JSON.parse(m[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function deps(nextData: Record<string, unknown>): Record<string, unknown> {
  const props = (nextData.props as Record<string, unknown> | undefined) ?? {};
  return (props.dependencyResolver as Record<string, unknown> | undefined) ?? {};
}

function normalizeTile(t: Record<string, unknown>): Record<string, unknown> | null {
  const ean = String(pick(t, "Ean", "ean") || "");
  if (!ean) return null;

  const cover = (pick(t, "Cover", "cover") as Record<string, unknown> | null) ?? {};
  const price = (pick(t, "Price", "price") as Record<string, unknown> | null) ?? {};
  const avail = (pick(t, "Availability", "availability") as Record<string, unknown> | null) ?? {};
  const info = (pick(t, "info") as Record<string, unknown> | null) ?? {};

  const title =
    String(pick(t, "Slot1") || info.slot1 || pick(cover, "AltText", "alt") || "").trim();
  const formatLabel = String(pick(t, "Slot3") || info.slot3 || "").trim();
  const medium = String(pick(t, "Medium", "medium") || pick(t, "Slot2") || info.slot2 || "").trim();

  let link = String(pick(cover, "Link", "link") || "");
  if (!link) link = `${EXLIBRIS_CATALOG_ROOTS.spiele}id/${ean}/`;

  const listPrice = pick(price, "List", "list");
  const salesPrice = pick(price, "Sales", "sales");
  const currency = String(pick(price, "Currency", "currency") || "CHF");
  const availText = String(pick(avail, "Text", "text") || "");
  const availIcon = String(pick(avail, "IconKey", "iconKey") || "");
  const availColor = String(pick(avail, "Color", "color", "MessageColor") || "");

  let imageUrl = String(pick(cover, "Url", "url") || "");
  const covers = pick(cover, "Covers", "covers");
  if (!imageUrl && Array.isArray(covers)) {
    for (const c of covers) {
      if (c && typeof c === "object") {
        const u = pick(c as Record<string, unknown>, "Url", "url");
        if (u) {
          imageUrl = String(u);
          break;
        }
      }
    }
  }

  return {
    ean,
    title,
    medium,
    format: formatLabel,
    path: link,
    url: link.startsWith("http") ? link : `${EXLIBRIS_BASE}${link}`,
    list_price: listPrice,
    sales_price: salesPrice,
    currency,
    availability_text: availText,
    availability_icon: availIcon,
    availability_color: availColor,
    image_url: imageUrl,
    category_code: String(pick(t, "categoryCode", "CategoryCode") || ""),
    is_download_product: Boolean(pick(t, "isDownloadProduct", "IsDownloadProduct")),
    show_download_button: Boolean(pick(t, "showDownloadButton", "ShowDownloadButton")),
  };
}

function stockLabel(icon: string, color: string): string {
  const i = icon.toLowerCase();
  const c = color.toLowerCase();
  if (i.includes("nicht") || c === "red") return "out_of_stock";
  if (i.includes("vorbestell") || i.includes("preorder")) return "preorder";
  if (i || c === "green") return "in_stock_unquantified";
  return "unknown";
}

export function tileToProduct(tile: Record<string, unknown>, sampleBucket = ""): ExlibrisTile | null {
  const { keep } = isPhysicalExlibrisItem({
    url: String(tile.url || ""),
    path: String(tile.path || ""),
    medium: String(tile.medium || ""),
    formatLabel: String(tile.format || ""),
    categoryCode: String(tile.category_code || ""),
    isDownloadProduct: Boolean(tile.is_download_product),
    showDownloadButton: Boolean(tile.show_download_button),
  });
  if (!keep) return null;

  const ean = String(tile.ean || "");
  const rawPrice = tile.sales_price ?? tile.list_price;
  const buyChf = Number(rawPrice);
  if (!Number.isFinite(buyChf) || buyChf <= 0) return null;

  if (!validateGtin(ean)) return null;

  return {
    ean,
    title: String(tile.title || ""),
    url: String(tile.url || ""),
    buyChf,
    currency: String(tile.currency || "CHF"),
    availabilityText: String(tile.availability_text || ""),
    stockLabel: stockLabel(
      String(tile.availability_icon || ""),
      String(tile.availability_color || "")
    ),
    imageUrl: String(tile.image_url || ""),
    formatLabel: String(tile.format || ""),
    sampleBucket: sampleBucket || String(tile.format || ""),
    brand: "",
  };
}

export function extractProductTiles(html: string): ExlibrisTile[] {
  const nd = extractNextData(html);
  if (!nd) return [];
  const d = deps(nd);
  const pcd = ((d.CategoryPageStore as Record<string, unknown> | undefined)?.productCategoryData ??
    {}) as Record<string, unknown>;
  let raw = pcd.ProductTiles;
  if (!Array.isArray(raw) || !raw.length) {
    raw = (d.PaginationStore as Record<string, unknown> | undefined)?.productTiles;
  }
  if (!Array.isArray(raw)) return [];

  const out: ExlibrisTile[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const norm = normalizeTile(t as Record<string, unknown>);
    if (!norm) continue;
    const product = tileToProduct(norm);
    if (product) out.push(product);
  }
  return out;
}

export function discoverCategoryPaths(html: string, catalogRoot: string): string[] {
  const prefix = catalogRoot.endsWith("/") ? catalogRoot : `${catalogRoot}/`;
  const found: string[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/href="(\/de\/[^"]+\/ci\/\d+\/)"/g)) {
    const href = m[1]!;
    if (!href.startsWith(prefix)) continue;
    if (SKIP_CATEGORY_SUFFIXES.some((s) => href.endsWith(s))) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    found.push(href);
  }
  return found;
}

export function exlibrisStockFromLabel(stockLabel: string, availabilityText: string): number {
  const cfg = exlibrisConfig();
  const low = availabilityText.toLowerCase();
  if (
    stockLabel === "out_of_stock" ||
    /vergriffen|nicht\s+lieferbar|ausverkauft/.test(low)
  ) {
    return 0;
  }
  if (stockLabel === "preorder") return 0;
  return cfg.defaultStock;
}

const UA =
  process.env.SCRAPER_USER_AGENT ||
  "Mozilla/5.0 (compatible; ResellScraper/1.0; +https://resell.ch)";

let lastFetchAt = 0;

export async function fetchExlibrisHtml(url: string): Promise<string> {
  const cfg = exlibrisConfig();
  const waitMs = cfg.requestDelayMs - (Date.now() - lastFetchAt);
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));

  const res = await fetch(url, {
    headers: {
      Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      "Accept-Language": "de,en;q=0.8",
      "User-Agent": UA,
    },
    redirect: "follow",
  });
  lastFetchAt = Date.now();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

export function emptyProgress(catalog: string): ExlibrisScrapeProgress {
  const catalogRoot = catalogPrefix(catalog);
  return {
    catalog,
    catalogRoot,
    seenEans: [],
    pendingCategories: [],
    doneCategories: [],
    categoryPages: {},
    rowsWritten: 0,
    requests: 0,
    updatedAt: new Date().toISOString(),
  };
}
