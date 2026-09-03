/** Ex Libris filters — physical SKU only; never expand PDP format siblings. */

const SKIP_CATEGORY_PATH_PARTS = [
  "/e-books-",
  "/e-books/",
  "/ebooks/",
  "/ebook/",
  "/download/",
  "/buecher-buch/e-books-deutsch/",
  "/buecher-buch/e-books-",
  "/buecher-buch/englische-ebooks/",
  "/buecher-buch/franzoesische-ebooks/",
];

const BLOCKED_PRODUCT_CATEGORIES = new Set(["b-dl", "b-dl-en", "b-dl-fr", "dl", "ebook", "e-book"]);

const DIGITAL_FORMAT_RE =
  /(?:e-?\s*book|ebook|epub|kindle|pdf\b|download-?\s*artikel|download\b|hörbuch.*download|audio-?\s*download|cloud-?\s*version|streaming|digital(?:er)?\s+(?:download|inhalt))/i;

export function isDigitalCategoryPath(path: string): boolean {
  const low = path.toLowerCase();
  return SKIP_CATEGORY_PATH_PARTS.some((part) => low.includes(part));
}

export function isDigitalFormatLabel(text: string): boolean {
  return DIGITAL_FORMAT_RE.test(text || "");
}

export function isPhysicalExlibrisItem(input: {
  url?: string;
  path?: string;
  medium?: string;
  formatLabel?: string;
  categoryCode?: string;
  isDownloadProduct?: boolean;
  showDownloadButton?: boolean;
}): { keep: boolean; reason: string } {
  if (input.isDownloadProduct) return { keep: false, reason: "is_download_product" };
  if (input.showDownloadButton) return { keep: false, reason: "show_download_button" };

  const p = (input.path || input.url || "").toLowerCase();
  if (isDigitalCategoryPath(p)) return { keep: false, reason: "digital_category_path" };

  const cat = String(input.categoryCode || "").toLowerCase();
  if (BLOCKED_PRODUCT_CATEGORIES.has(cat) || cat.endsWith("-dl")) {
    return { keep: false, reason: `product_category:${cat || "?"}` };
  }

  const blob = [input.medium, input.formatLabel].filter(Boolean).join(" ");
  if (isDigitalFormatLabel(blob)) return { keep: false, reason: "digital_format_label" };

  return { keep: true, reason: "physical" };
}

export function eanFromExlibrisUrl(url: string): string | null {
  const m = url.match(/\/id\/(\d{8,14})\//);
  return m?.[1] ?? null;
}

export function assertUrlEanMatches(prod: { EAN?: string; ProductId?: string }, url: string) {
  const urlEan = eanFromExlibrisUrl(url);
  const prodEan = String(prod.EAN || prod.ProductId || "");
  if (urlEan && prodEan && urlEan !== prodEan) {
    return { ok: false, reason: `ean_mismatch:url=${urlEan},product=${prodEan}` };
  }
  return { ok: true, reason: "ok" };
}
