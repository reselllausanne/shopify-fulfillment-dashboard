/**
 * Fixed-price in-stock warehouse lane (Essentials / Bape / AP×Travis).
 *
 * Same 48h physical ship as liquidation; price is manual — never StockX −30%.
 * Match by productId first (sizes share one product), then SKU base, then title.
 *
 * COGS: already-expensed owned stock → costChf 0 (full margin on dashboard).
 * Sell prices stay fixed (Essentials 59/89, Bape 69/99, AP×Travis 89/109).
 */

/** Essentials in-stock Shopify sell price (CHF). Never overwritten by StockX. */
export const ESSENTIALS_SELL_CHF = 59;
/** Essentials express metafield price (CHF). Never overwritten by StockX. */
export const ESSENTIALS_EXPRESS_CHF = 89;

/** Audemars × Travis in-stock Shopify sell price (CHF). Never overwritten by StockX. */
export const AUDEMARS_TRAVIS_SELL_CHF = 89;
/** Audemars × Travis express metafield (CHF). Only when physical location stock > 0. */
export const AUDEMARS_TRAVIS_EXPRESS_CHF = 109;

/** Bape in-stock Shopify sell price (CHF). Never overwritten by StockX. */
export const BAPE_SELL_CHF = 69;
/** Bape express metafield (CHF). Only when physical location stock > 0. */
export const BAPE_EXPRESS_CHF = 99;

export type InStockFixedPriceConfig = {
  costChf: number;
  label: string;
  matchReason: string;
  /** Shopify sell price when this lane is listed (Essentials = 59). */
  sellChf?: number;
  /** Shopify custom.express_price when this lane is listed (Essentials = 89). */
  expressChf?: number;
};

export type InStockFixedPriceRule = InStockFixedPriceConfig & {
  /** Shopify product numeric IDs — preferred; covers all sizes/variants. */
  productIds?: string[];
  /** Model SKU base (same for S/M/L) — `125HO244368F` or `125HO244368F-M`. */
  skuBases?: string[];
  titlePatterns?: RegExp[];
};

/** Owned warehouse / Lab stock cost per unit (CHF). Values per user 2026-08-16. */
const ESSENTIALS_COST_CHF = 26;
const BAPE_COST_CHF = 35;
const AUDEMARS_TRAVIS_COST_CHF = 40;

export const IN_STOCK_FIXED_PRICE_RULES: InStockFixedPriceRule[] = [
  {
    costChf: ESSENTIALS_COST_CHF,
    sellChf: ESSENTIALS_SELL_CHF,
    expressChf: ESSENTIALS_EXPRESS_CHF,
    label: "Essential Hoodie (in stock)",
    matchReason: "Essential Hoodie (fixed 59/89, cost 26)",
    skuBases: ["192HO246258F", "192HO246250F"],
    titlePatterns: [/^Essentials Hoodie\b/i, /Fear of God Essentials.*Hoodie\b/i],
  },
  {
    costChf: ESSENTIALS_COST_CHF,
    sellChf: ESSENTIALS_SELL_CHF,
    expressChf: ESSENTIALS_EXPRESS_CHF,
    label: "Essential T-Shirt (in stock)",
    matchReason: "Essential T-Shirt (fixed 59/89, cost 26)",
    productIds: [
      "15340411617666", // Tee Stretch Limo SS22
      "15349630501250", // Tee Light Oatmeal (SS22)
      "15369534538114", // Tee Dark Oatmeal SS22
    ],
    skuBases: ["125HO244368F"],
    titlePatterns: [
      /Fear of God Essentials.*(Jersey|Crewneck|T-Shirt|Tee)\b/i,
      /^Essentials Tee\b/i,
    ],
  },
  {
    costChf: ESSENTIALS_COST_CHF,
    sellChf: ESSENTIALS_SELL_CHF,
    expressChf: ESSENTIALS_EXPRESS_CHF,
    label: "Essential Shorts (in stock)",
    matchReason: "Essential Shorts (fixed 59/89, cost 26)",
    productIds: [
      "15340410732930", // Shorts Stretch Limo (SS22)
      "15340410831234", // Shorts Dark Oatmeal (SS22)
      "15340410896770", // Shorts Light Oatmeal (SS22)
    ],
    skuBases: ["160BT212012F", "160BT212013F"],
    titlePatterns: [/^Essentials Shorts\b/i, /Fear of God Essentials.*Shorts\b/i],
  },
  {
    costChf: BAPE_COST_CHF,
    sellChf: BAPE_SELL_CHF,
    expressChf: BAPE_EXPRESS_CHF,
    label: "Bape Tee (in stock)",
    matchReason: "Bape Tee (fixed 69/99, cost 35)",
    productIds: [
      "15356478325122", // Check by Bathing Tee White/Beige
      "15356478357890", // Big Ape Head Tee White
    ],
    titlePatterns: [
      /^BAPE\b.*\bTee\b/i,
      /A Bathing Ape.*\bTee\b/i,
      /Big Ape Head Tee\b/i,
    ],
  },
  {
    costChf: AUDEMARS_TRAVIS_COST_CHF,
    sellChf: AUDEMARS_TRAVIS_SELL_CHF,
    expressChf: AUDEMARS_TRAVIS_EXPRESS_CHF,
    label: "Audemars x Travis Tee (in stock)",
    matchReason: "Audemars x Travis Tee (fixed 89/109, cost 40)",
    productIds: [
      "15115016733058", // Vintage Tee Black
      "15115016831362", // Watch Face Tee Green
    ],
    titlePatterns: [
      /Travis Scott.*Audemars.*\bTee\b/i,
      /Audemars Piguet.*\bTee\b/i,
    ],
  },
];

function normalizeShopifyNumericId(id: string | null | undefined): string {
  const raw = String(id ?? "").trim();
  if (!raw) return "";
  const gidMatch = raw.match(/\/(\d+)$/);
  if (gidMatch) return gidMatch[1]!;
  const digits = raw.replace(/\D/g, "");
  return digits || raw;
}

function normalizeSkuKey(sku: string): string {
  return sku.trim().toUpperCase();
}

function skuMatchesBase(sku: string, base: string): boolean {
  const normalizedSku = normalizeSkuKey(sku);
  const normalizedBase = normalizeSkuKey(base);
  return normalizedSku === normalizedBase || normalizedSku.startsWith(`${normalizedBase}-`);
}

export function resolveInStockFixedPriceRule(input: {
  sku?: string | null;
  title?: string | null;
  productId?: string | null;
}): InStockFixedPriceRule | null {
  const productId = normalizeShopifyNumericId(input.productId);
  const sku = input.sku?.trim() ?? "";
  const title = input.title?.trim() ?? "";

  // 1) productId — covers all sizes on one Shopify product
  for (const rule of IN_STOCK_FIXED_PRICE_RULES) {
    if (productId && rule.productIds?.some((id) => normalizeShopifyNumericId(id) === productId)) {
      return rule;
    }
  }

  // 2) title before SKU — some tees incorrectly share shorts SKU bases in admin
  for (const rule of IN_STOCK_FIXED_PRICE_RULES) {
    if (title && rule.titlePatterns?.some((pattern) => pattern.test(title))) {
      return rule;
    }
  }

  for (const rule of IN_STOCK_FIXED_PRICE_RULES) {
    if (sku && rule.skuBases?.some((base) => skuMatchesBase(sku, base))) {
      return rule;
    }
  }

  return null;
}

export function resolveInStockFixedPrice(input: {
  sku?: string | null;
  title?: string | null;
  productId?: string | null;
}): InStockFixedPriceConfig | null {
  const rule = resolveInStockFixedPriceRule(input);
  if (!rule) return null;
  return {
    costChf: rule.costChf,
    label: rule.label,
    matchReason: rule.matchReason,
    sellChf: rule.sellChf,
    expressChf: rule.expressChf,
  };
}

/** True when rule is Essentials lane (fixed 59 / express 89). */
export function isEssentialsFixedSellRule(rule: InStockFixedPriceConfig | null | undefined): boolean {
  return rule?.sellChf === ESSENTIALS_SELL_CHF && rule?.expressChf === ESSENTIALS_EXPRESS_CHF;
}

export function isInStockFixedPriceProduct(input: {
  sku?: string | null;
  title?: string | null;
  productId?: string | null;
}): boolean {
  return resolveInStockFixedPriceRule(input) !== null;
}

/** All product IDs in the fixed-price registry (for admin-only / automation skip). */
export function inStockFixedPriceProductIds(): string[] {
  const ids = new Set<string>();
  for (const rule of IN_STOCK_FIXED_PRICE_RULES) {
    for (const id of rule.productIds ?? []) {
      const n = normalizeShopifyNumericId(id);
      if (n) ids.add(n);
    }
  }
  return [...ids];
}
