/**
 * When StockX slug resolution fails: decide skipped vs needs_human.
 *
 * Warehouse merch / retail socks packs are never bought on StockX → skip (no ops mail).
 * StockX-plausible categories (sneakers, hobby boxes, TCG) stay needs_human so ops can
 * map the slug manually.
 */
import { isStockxAutoBuyExcluded } from "@/lib/stockxAutoCheckout/precheckAvailability";
import { isInStockFixedPriceProduct } from "@/shopify/inventory/inStockFixedPrice";

export type NonStockxBuyableLine = {
  title?: string | null;
  sku?: string | null;
  productId?: string | null;
};

/**
 * Manual hold: buy elsewhere, never StockX. Checked before the plausible-sneaker
 * short-circuit so a Jordan title cannot override it.
 * 2026-11-10: #7707 Jordan 1 Swarovski → GOAT, cheaper.
 */
const MANUAL_GOAT_HOLD: ReadonlyArray<{ re: RegExp; label: string }> = [
  {
    re: /HF6248-002|\bjordan\b[\s\S]{0,50}\bswarovski\b|\bswarovski\b[\s\S]{0,50}\bjordan\b/i,
    label: "goat_jordan_swarovski",
  },
];

/** Strong StockX signals — never auto-skip even if a denylist token overlaps. */
const STOCKX_PLAUSIBLE_RE =
  /\b(hobby\s*box|booster\s*box|blaster\s*box|elite\s*trainer|trading\s*cards?|\btcg\b|panini|topps|pokemon|pokémon|lego\b|dunk|jordan|yeezy|air\s*(?:max|force|jordan)|samba|gazelle|campus|superstar|sneaker|new\s*balance|asics|salomon|gel[-\s]?lyte|ultraboost|handball\s*spezial)\b/i;

/**
 * Durable denylist: warehouse collab merch tees + mass-market sock packs.
 * Prefer patterns over one-off SKUs. Extend carefully — streetwear tees CAN be on StockX.
 */
const NON_STOCKX_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /\bwatch\s*face\b[\s\S]{0,40}\btee\b|\btee\b[\s\S]{0,40}\bwatch\s*face\b/i, label: "watch_face_tee" },
  { re: /\baudemars\b[\s\S]{0,60}\btee\b|\btee\b[\s\S]{0,60}\baudemars\b/i, label: "audemars_merch_tee" },
  {
    re: /\bnike\b[\s\S]{0,50}\beveryday\b[\s\S]{0,50}\bsocks?\b|\beveryday\b[\s\S]{0,50}\bnike\b[\s\S]{0,50}\bsocks?\b/i,
    label: "nike_everyday_socks",
  },
  { re: /\beveryday\s+plus\b[\s\S]{0,40}\bsocks?\b/i, label: "everyday_plus_socks" },
  { re: /\bcushioned\s+crew\s+socks?\b/i, label: "cushioned_crew_socks" },
  {
    re: /\b(nike|adidas)\b[\s\S]{0,80}\b(\d+\s*[-–]?\s*pack)\b[\s\S]{0,40}\bsocks?\b/i,
    label: "sport_brand_sock_multipack",
  },
];

export function isStockxPlausibleWithoutSlug(line: NonStockxBuyableLine): boolean {
  const hay = `${line.title ?? ""} ${line.sku ?? ""}`.trim();
  return Boolean(hay) && STOCKX_PLAUSIBLE_RE.test(hay);
}

/**
 * True when product is clearly not StockX-sourced (warehouse fixed-price, excluded
 * brands, merch/socks denylist). False for StockX-plausible titles and unknowns.
 */
export function isClearlyNotStockxBuyable(line: NonStockxBuyableLine): {
  notBuyable: boolean;
  label?: string;
} {
  const hay = `${line.title ?? ""} ${line.sku ?? ""}`;
  for (const p of MANUAL_GOAT_HOLD) {
    if (p.re.test(hay)) return { notBuyable: true, label: p.label };
  }

  if (isStockxPlausibleWithoutSlug(line)) {
    return { notBuyable: false };
  }

  if (isInStockFixedPriceProduct(line)) {
    return { notBuyable: true, label: "in_stock_fixed_price" };
  }

  const excl = isStockxAutoBuyExcluded(line);
  if (excl.excluded) {
    return { notBuyable: true, label: `excluded:${excl.keyword}` };
  }

  for (const p of NON_STOCKX_PATTERNS) {
    if (p.re.test(hay)) return { notBuyable: true, label: p.label };
  }

  return { notBuyable: false };
}

/** Slug-missing branch outcome for auto-checkout. */
export function classifySlugMissingOutcome(
  line: NonStockxBuyableLine
): "skipped" | "needs_human" {
  return isClearlyNotStockxBuyable(line).notBuyable ? "skipped" : "needs_human";
}
