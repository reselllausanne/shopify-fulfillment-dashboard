/**
 * Conservative scraper stock — Galaxus cancel-rate guard.
 * Off-lager, preorder/backorder, long lead times → stock 0.
 * Fake default qty only when schema InStock + immediate delivery copy on PDP.
 */

/** schema.org Offer.availability — sellable only on explicit InStock. */
export function isSchemaOfferInStock(availability: string | null | undefined): boolean {
  const raw = String(availability ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");
  if (!raw) return false;
  if (
    raw.includes("outofstock") ||
    raw.includes("soldout") ||
    raw.includes("discontinued") ||
    raw.includes("preorder") ||
    raw.includes("backorder") ||
    raw.includes("limitedavailability")
  ) {
    return false;
  }
  return raw.includes("instock");
}

/** DE/FR/EN copy that must force stock=0 even when schema says InStock. */
export function availabilityTextImpliesOos(text: string | null | undefined): boolean {
  const t = String(text ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!t) return false;
  const patterns = [
    /\boff[\s-]?lager\b/,
    /\bnicht\s+(auf\s+lager|lieferbar|verf(?:ü|ue)gbar|vorr(?:ä|ae)tig|mehr\s+erh(?:ä|ae)ltlich)\b/,
    /\bderzeit\s+nicht\b/,
    /\bmomentan\s+nicht\b/,
    /\bausverkauft\b/,
    /\bvergriffen\b/,
    /\bnicht\s+mehr\s+verf(?:ü|ue)gbar\b/,
    /\bliefertermin\s+unbekannt\b/,
    /\blieferbar\s+ab\b/,
    /\bvorbestell(?:ung|bar|en)?\b/,
    /\bpre[\s-]?order\b/,
    /\bback[\s-]?order\b/,
    /\bauf\s+bestellung\b/,
    /\blieferzeit\s*(?:von\s*)?\d+\s*(?:-\s*\d+\s*)?(?:wochen|monate|months|weeks)\b/,
    /\bin\s+\d+\s*(?:wochen|monaten|months|weeks)\b/,
    /\b\d+\s*(?:wochen|monate|months|weeks)\s*lieferzeit\b/,
    /\blieferung\s+in\s+\d+/,
    /\btemporarily\s+unavailable\b/,
    /\bnot\s+available\b/,
    /\bno\s+longer\s+available\b/,
    /\bn['']est\s+plus\s+disponible\b/,
    /\bindisponible\b/,
    /\bépuisé\b/,
    /\brupture\s+de\s+stock\b/,
  ];
  return patterns.some((re) => re.test(t));
}

/** Long or vague lead time — not safe to sell on Galaxus dropship. */
export function availabilityTextImpliesDelayed(text: string | null | undefined): boolean {
  const t = String(text ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!t) return false;
  if (availabilityTextImpliesOos(t)) return true;
  if (/\blieferbar\s+ab\b/.test(t)) return true;
  if (/\b(\d+)\s*(wochen|monate|months|weeks)\b/.test(t)) return true;
  if (/\blieferzeit\b/.test(t) && !/\b(sofort|1\s*[-–]?\s*3\s*werktage|1\s*[-–]?\s*2\s*werktage)\b/.test(t)) {
    return true;
  }
  return false;
}

export function htmlAvailabilityText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type ResolveScraperStockInput = {
  schemaAvailability?: string | null;
  pageText?: string | null;
  explicitQty?: number | null;
  /** Only when InStock + immediate copy, no explicit qty. Default 0 = safest. */
  defaultStockWhenImmediate?: number;
  requireImmediateText?: boolean;
};

export type ResolveScraperStockResult = {
  inStock: boolean;
  stock: number;
  stockSource: string;
};

export function resolveScraperStock(input: ResolveScraperStockInput): ResolveScraperStockResult {
  const pageText = input.pageText ?? "";

  if (availabilityTextImpliesOos(pageText)) {
    return { inStock: false, stock: 0, stockSource: "page_text_oos" };
  }
  if (availabilityTextImpliesDelayed(pageText)) {
    return { inStock: false, stock: 0, stockSource: "page_text_delayed" };
  }

  const schemaOk = isSchemaOfferInStock(input.schemaAvailability);
  if (input.schemaAvailability && !schemaOk) {
    return { inStock: false, stock: 0, stockSource: "schema_not_instock" };
  }

  const qty = input.explicitQty;
  if (qty != null) {
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) {
      return { inStock: false, stock: 0, stockSource: "explicit_qty_zero" };
    }
    return { inStock: true, stock: n, stockSource: "explicit_qty" };
  }

  if (!schemaOk) {
    return { inStock: false, stock: 0, stockSource: "no_stock_signal" };
  }

  const defaultStock = Math.max(0, Number(input.defaultStockWhenImmediate ?? 0));
  if (defaultStock <= 0) {
    return { inStock: false, stock: 0, stockSource: "no_explicit_qty" };
  }

  if (input.requireImmediateText) {
    const immediate = /\b(sofort\s+(verf(?:ü|ue)gbar|lieferbar)|auf\s+lager|in\s+stock|lagernd|stück\s+an\s+lager|au\s+lager)\b/i.test(
      pageText
    );
    if (!immediate) {
      return { inStock: false, stock: 0, stockSource: "not_immediate" };
    }
  }

  return { inStock: true, stock: defaultStock, stockSource: "default_instock" };
}
