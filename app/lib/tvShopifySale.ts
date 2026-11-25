import { isPackageProtectionShopifyLine, resolveOrderMatchCost } from "@/app/utils/matching";
import { resolveInStockFixedPrice } from "@/shopify/inventory/inStockFixedPrice";
import { toNumberSafe } from "@/app/utils/numbers";

/**
 * TV kiosk sale card.
 * Shopify often lists "Protection du colis" first. That add-on is not the sale.
 * Real margin comes from OrderMatch COGS (same rules as the daily dashboard).
 * A protection match must not replace the pair's cost. Unmatched pairs stay estimated.
 */

const FALLBACK_MARGIN = 0.2;

/** Ask is not a purchase. Use it only when it still sits under the sale price. */
export function estimateUnboughtMarginChf(
  revenue: number,
  qty: number,
  unitBuy: number | undefined
): number {
  const q = Math.max(1, qty || 1);
  const unitRev = revenue / q;
  if (unitBuy && unitBuy > 0 && unitBuy < unitRev) return (unitRev - unitBuy) * q;
  return revenue * FALLBACK_MARGIN;
}

/**
 * AAA / Bussigny warehouse sale.
 * Essentials (and the other fixed-cost lanes) keep their unit buy price.
 * Every other warehouse pair is already expensed → 100% margin.
 * Returns null when the line is not warehouse stock.
 */
export function aaaWarehouseMarginChf(input: {
  revenue: number;
  qty: number;
  warehouse: boolean;
  fixedUnitCostChf?: number | null;
}): number | null {
  if (!input.warehouse) return null;
  const qty = Math.max(1, input.qty || 1);
  const unitCost = input.fixedUnitCostChf;
  if (unitCost != null && unitCost > 0) return input.revenue - unitCost * qty;
  return input.revenue;
}

export type TvCostMatch = {
  shopifyLineItemId?: string | null;
  shopifyOrderName: string;
  shopifyProductTitle?: string | null;
  shopifySku?: string | null;
  shopifySizeEU?: string | null;
  shopifyTotalPrice: unknown;
  manualRevenueAdjustment?: unknown;
  supplierCost?: unknown;
  manualCostOverride?: unknown;
  supplierSource?: string | null;
  stockxStatus?: string | null;
  stockxOrderNumber?: string | null;
  returnReason?: string | null;
  returnFeePercent?: unknown;
  returnFeeAmountChf?: unknown;
  shopifyLineItemImageUrl?: string | null;
  shopifyCreatedAt?: Date | null;
};

export type TvLiveLine = {
  id?: string | null;
  title?: string | null;
  name?: string | null;
  sku?: string | null;
  quantity?: number | null;
  unitPrice: number;
  imageUrl?: string | null;
  gtin?: string | null;
  variantTitle?: string | null;
};

export type TvSalePresentation = {
  title: string;
  extraItems: number;
  imageUrl: string | null;
  salesChf: number;
  marginChf: number | null;
  marginEstimated: boolean;
  refreshGtins: string[];
};

export function lineItemIdKeys(id: string | null | undefined): string[] {
  const raw = String(id ?? "").trim();
  if (!raw) return [];
  const tail = raw.includes("/") ? (raw.split("/").pop() ?? raw) : raw;
  const keys = new Set<string>([raw]);
  if (tail) keys.add(tail);
  if (/^\d+$/.test(tail)) keys.add(`gid://shopify/LineItem/${tail}`);
  return [...keys];
}

function isAddon(line: { title?: string | null; name?: string | null; sku?: string | null }): boolean {
  return isPackageProtectionShopifyLine(line.title || line.name, line.sku);
}

function matchIsAddon(m: TvCostMatch): boolean {
  return isPackageProtectionShopifyLine(m.shopifyProductTitle, m.shopifySku);
}

function sameLine(a?: string | null, b?: string | null): boolean {
  const keys = new Set(lineItemIdKeys(b));
  return lineItemIdKeys(a).some((k) => keys.has(k));
}

/** Revenue and COGS margin for one OrderMatch row. Null when cost is still unknown. */
export function priceShopifyMatch(
  m: TvCostMatch
): { revenue: number; margin: number } | null {
  const { cost, fullMargin } = resolveOrderMatchCost(m);
  const base = toNumberSafe(m.shopifyTotalPrice, 0) + toNumberSafe(m.manualRevenueAdjustment, 0);
  const pct = toNumberSafe(m.returnFeePercent, 0);
  const fee = m.returnReason
    ? toNumberSafe(
        m.returnFeeAmountChf,
        pct > 0 ? (toNumberSafe(m.shopifyTotalPrice, 0) * pct) / 100 : 0
      )
    : 0;
  const revenue = m.returnReason ? fee : base;
  if (!fullMargin && !m.returnReason && (cost <= 0 || revenue <= 0)) return null;
  return { revenue, margin: revenue - cost };
}

function liveGross(li: TvLiveLine): number {
  return Math.max(0, li.unitPrice) * Math.max(1, li.quantity ?? 1);
}

function liveTitle(li: TvLiveLine): string {
  const name = String(li.name ?? "").trim();
  const title = String(li.title ?? "").trim();
  const base = name || title;
  const variant = String(li.variantTitle ?? "").trim();
  if (
    variant &&
    variant.toLowerCase() !== "default title" &&
    base &&
    !base.toLowerCase().includes(variant.toLowerCase())
  ) {
    return `${base} · ${variant}`;
  }
  return base || "Commande Shopify";
}

function matchTitle(m: TvCostMatch): string {
  const base = String(m.shopifyProductTitle ?? "").trim();
  const size = String(m.shopifySizeEU ?? "").trim();
  if (size && base && !base.toLowerCase().includes(size.toLowerCase())) return `${base} · EU ${size}`;
  return base || "Commande Shopify";
}

function pickHero<T>(rows: T[], gross: (row: T) => number, addon: (row: T) => boolean): {
  hero: T | null;
  extraItems: number;
} {
  const products = rows.filter((row) => !addon(row));
  const pool = products.length ? products : rows;
  if (!pool.length) return { hero: null, extraItems: 0 };
  let hero = pool[0];
  for (const row of pool) {
    if (gross(row) > gross(hero)) hero = row;
  }
  return { hero, extraItems: Math.max(0, products.length - 1) };
}

function matchIndex(matches: TvCostMatch[]): Map<string, TvCostMatch> {
  const byKey = new Map<string, TvCostMatch>();
  for (const m of matches) {
    for (const key of lineItemIdKeys(m.shopifyLineItemId)) byKey.set(key, m);
  }
  return byKey;
}

function findMatch(id: string | null | undefined, byKey: Map<string, TvCostMatch>): TvCostMatch | undefined {
  for (const key of lineItemIdKeys(id)) {
    const hit = byKey.get(key);
    if (hit) return hit;
  }
  return undefined;
}

function productImage(matches: TvCostMatch[]): string | null {
  for (const m of matches) {
    if (matchIsAddon(m) || !m.shopifyLineItemImageUrl) continue;
    return m.shopifyLineItemImageUrl;
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function presentShopifyLiveSale(args: {
  lines: TvLiveLine[];
  matches: TvCostMatch[];
  physicalLineIds?: string[];
  buyUnitChf?: (gtin: string) => number | undefined;
}): TvSalePresentation {
  const buyUnitChf = args.buyUnitChf ?? (() => undefined);
  const physicalKeys = new Set((args.physicalLineIds ?? []).flatMap((id) => lineItemIdKeys(id)));
  const byKey = matchIndex(args.matches);
  const used = new Set<TvCostMatch>();

  let margin = 0;
  let known = 0;
  let estimated = false;
  const refreshGtins: string[] = [];

  const consider = (li: TvLiveLine) => {
    const gross = liveGross(li);
    const addon = isAddon(li);
    const match = findMatch(li.id, byKey);
    if (match) used.add(match);
    if (match) {
      const priced = priceShopifyMatch(match);
      if (priced) {
        margin += priced.margin;
        known += 1;
        return;
      }
    }
    if (addon) {
      if (gross > 0) {
        margin += gross;
        known += 1;
      }
      return;
    }
    const physical = lineItemIdKeys(li.id).some((key) => physicalKeys.has(key));
    if (physical) {
      if (gross > 0) {
        const fixed = resolveInStockFixedPrice({
          title: li.title || li.name,
          sku: li.sku,
        });
        margin +=
          aaaWarehouseMarginChf({
            revenue: gross,
            qty: li.quantity ?? 1,
            warehouse: true,
            fixedUnitCostChf: fixed?.costChf ?? null,
          }) ?? gross;
        known += 1;
      }
      return;
    }
    if (gross <= 0) return;
    const gtin = String(li.gtin ?? "").trim();
    if (gtin) refreshGtins.push(gtin);
    const unit = gtin ? buyUnitChf(gtin) : undefined;
    margin += estimateUnboughtMarginChf(gross, li.quantity ?? 1, unit);
    estimated = true;
    known += 1;
  };

  for (const li of args.lines) consider(li);

  for (const m of args.matches) {
    if (used.has(m)) continue;
    if (args.lines.some((li) => sameLine(li.id, m.shopifyLineItemId))) continue;
    const priced = priceShopifyMatch(m);
    if (!priced) continue;
    margin += priced.margin;
    known += 1;
  }

  const { hero, extraItems } = pickHero(args.lines, liveGross, isAddon);
  const title = hero ? liveTitle(hero) : "Commande Shopify";
  const imageUrl = hero?.imageUrl || productImage(args.matches) || null;

  return {
    title,
    extraItems,
    imageUrl,
    salesChf: 0,
    marginChf: known > 0 ? round2(margin) : null,
    marginEstimated: estimated,
    refreshGtins,
  };
}

/** DB-only fallback when the live Shopify fetch fails. Sales/margin stay on saved matches. */
export function summarizeDbShopifyOrder(matches: TvCostMatch[]): TvSalePresentation | null {
  const priced = matches
    .map((m) => ({ m, priced: priceShopifyMatch(m) }))
    .filter((row): row is { m: TvCostMatch; priced: { revenue: number; margin: number } } => row.priced != null);
  if (!priced.length) return null;

  let sales = 0;
  let margin = 0;
  for (const row of priced) {
    sales += row.priced.revenue;
    margin += row.priced.margin;
  }
  const { hero, extraItems } = pickHero(priced, (row) => row.priced.revenue, (row) => matchIsAddon(row.m));
  const title = hero ? matchTitle(hero.m) : "Commande Shopify";
  const imageUrl =
    (hero && !matchIsAddon(hero.m) ? hero.m.shopifyLineItemImageUrl : null) || productImage(matches);

  return {
    title,
    extraItems,
    imageUrl,
    salesChf: round2(sales),
    marginChf: round2(margin),
    marginEstimated: false,
    refreshGtins: [],
  };
}
