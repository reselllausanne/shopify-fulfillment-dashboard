/**
 * Fixed-price in-stock warehouse lane (Essentials / Bape / AP×Travis / Supreme boxers).
 *
 * Express 48h ship while physical > 0; price is manual — never StockX −30%.
 * Match by productId first (sizes share one product), then SKU base, then title.
 *
 * COGS: Essentials 42 all-in, Crocs Lightning McQueen 42, Bape 40, AP×Travis 40, boxers 20.
 * Sell prices stay fixed (Essentials tee/shorts 59/89, hoodies 129/169, Bape 69/99, AP×Travis 89/109, boxers 49/69).
 * Never StockX −30% soldes / never soldes-48h collection (`delivery_48h`).
 */

/** Essentials in-stock Shopify sell price (CHF). Never overwritten by StockX. */
export const ESSENTIALS_SELL_CHF = 59;
/** Essentials express metafield price (CHF). Never overwritten by StockX. */
export const ESSENTIALS_EXPRESS_CHF = 89;

/** Light Heather + FW24 Black hoodies — Shopify shelf 129, express 169. */
export const ESSENTIALS_HOODIE_SELL_CHF = 129;
export const ESSENTIALS_HOODIE_EXPRESS_CHF = 169;
/** Galaxus invoice. Sync job writes this, never the Shopify 129. */
export const ESSENTIALS_HOODIE_GALAXUS_EX_VAT_CHF = 69;

/** Audemars × Travis in-stock Shopify sell price (CHF). Never overwritten by StockX. */
export const AUDEMARS_TRAVIS_SELL_CHF = 89;
/** Audemars × Travis express metafield (CHF). Only when physical location stock > 0. */
export const AUDEMARS_TRAVIS_EXPRESS_CHF = 109;

/** Bape in-stock Shopify sell price (CHF). Never overwritten by StockX. */
export const BAPE_SELL_CHF = 69;
/** Bape express metafield (CHF). Only when physical location stock > 0. */
export const BAPE_EXPRESS_CHF = 99;

/** Supreme Hanes boxers (4-pack) — warehouse retail. Never StockX soldes. */
export const SUPREME_BOXER_SELL_CHF = 49;
/** Supreme boxers express metafield. Only when physical location stock > 0. */
export const SUPREME_BOXER_EXPRESS_CHF = 69;

/** Eden/Black Bird Head beanie — owned stock 10, Shopify 79 (hard target), express +20. */
export const EDEN_BEANIE_SELL_CHF = 79;
export const EDEN_BEANIE_EXPRESS_CHF = 99;
/** Nike Tech Fleece Dark Grey Heather/Black (joggers FB8002-063, windrunner FB7921-063) S/M/L. */
export const NIKE_TECH_GREY_SELL_CHF = 99;
export const NIKE_TECH_GREY_EXPRESS_CHF = 119;

export type InStockFixedPriceConfig = {
  costChf: number;
  label: string;
  matchReason: string;
  /** Shopify sell price when this lane is listed (Essentials = 59). */
  sellChf?: number;
  /** Shopify custom.express_price when this lane is listed (Essentials = 89). */
  expressChf?: number;
  /** Never offer express for this lane (standard shipping only), even with physical stock. */
  noExpress?: boolean;
  /** Registry sell is exact: never kept at a higher existing shelf price (default lanes keep the max). */
  hardSell?: boolean;
  /** Keep the product out of the "Livraison 48H" collection (custom.physical_in_stock stays false). Express only. */
  skipLivraison48h?: boolean;
  /** Galaxus invoice ex VAT. Shopify shelf stays sellChf. The sync job must not copy sellChf here. */
  galaxusExVatChf?: number;
};

export type InStockFixedPriceRule = InStockFixedPriceConfig & {
  /** Shopify product numeric IDs — preferred; covers all sizes/variants. */
  productIds?: string[];
  /** Model SKU base (same for S/M/L) — `125HO244368F` or `125HO244368F-M`. */
  skuBases?: string[];
  titlePatterns?: RegExp[];
};

/** Owned warehouse cost per unit (CHF). Essentials 42 all-in, Crocs 42, Bape 40. */
const ESSENTIALS_COST_CHF = 42;
const ESSENTIALS_HOODIE_COST_CHF = 42;
const CROCS_MCQUEEN_COST_CHF = 42;
const BAPE_COST_CHF = 40;
const AUDEMARS_TRAVIS_COST_CHF = 40;
const SUPREME_BOXER_COST_CHF = 20;
/** Placeholder COGS (CHF) — owned units, real invoice cost not in repo. Used for Galaxus local-stock margin only. */
const EDEN_BEANIE_COST_CHF = 40;
const NIKE_TECH_GREY_COST_CHF = 60;

export const IN_STOCK_FIXED_PRICE_RULES: InStockFixedPriceRule[] = [
  {
    costChf: ESSENTIALS_HOODIE_COST_CHF,
    sellChf: ESSENTIALS_HOODIE_SELL_CHF,
    noExpress: true,
    galaxusExVatChf: ESSENTIALS_HOODIE_GALAXUS_EX_VAT_CHF,
    label: "Essential Hoodie (in stock)",
    matchReason: "Essential Hoodie (Shopify 129, Galaxus 69)",
    productIds: [
      "15139794682242", // Fleece Hoodie Light Heather Gray
      "15139794616706", // Fleece Hoodie (FW24) Black
    ],
    skuBases: ["192HO246258F", "192HO246250F"],
    // SKU + productId, plus the exact Fleece Hoodie title (no Kids / NBA).
    titlePatterns: [
      /Fear of God Essentials Fleece Hoodie/i,
      /Fear of God Essentials Fleece Essential Sweatpant/i,
    ],
  },
  {
    costChf: ESSENTIALS_COST_CHF,
    sellChf: ESSENTIALS_SELL_CHF,
    expressChf: ESSENTIALS_EXPRESS_CHF,
    label: "Essential T-Shirt (in stock)",
    matchReason: "Essential T-Shirt (fixed 59/89, cost 42)",
    productIds: [
      "15340411617666", // Tee Stretch Limo SS22
      "15349630501250", // Tee Light Oatmeal (SS22)
      "15369534538114", // Tee Dark Oatmeal SS22
    ],
    skuBases: ["125HO244368F", "125HO244360F"],
    titlePatterns: [
      /Fear of God Essentials.*(Jersey|Crewneck|T-Shirt|Tee)\b/i,
      /Essentials Fear of God.*(Jersey|Crewneck|T-Shirt|Tee)\b/i,
      /^Essentials Tee\b/i,
      /^Essentials Fear of God Jersey Crewneck T-Shirt\b/i,
    ],
  },
  {
    costChf: ESSENTIALS_COST_CHF,
    sellChf: ESSENTIALS_SELL_CHF,
    expressChf: ESSENTIALS_EXPRESS_CHF,
    label: "Essential Shorts (in stock)",
    matchReason: "Essential Shorts (fixed 59/89, cost 42)",
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
    matchReason: "Bape Tee (fixed 69/99, cost 40)",
    productIds: [
      "15356478325122", // Check by Bathing Tee White/Beige
      "15356478357890", // Big Ape Head Tee White
    ],
    // Warehouse retail tees only — never all BAPE * Tee (dropship / MK).
    skuBases: [
      "8d665d38-a271-46ee-9b51-9da28c3bbb6c", // Sakura Tree Tee Black
    ],
    titlePatterns: [
      /^BAPE A Bathing Ape Check by Bathing Tee White\/Beige\b/i,
      /^BAPE Big Ape Head Tee White\b/i,
      /^BAPE Sakura Tree Tee Black\b/i,
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
  {
    costChf: SUPREME_BOXER_COST_CHF,
    sellChf: SUPREME_BOXER_SELL_CHF,
    expressChf: SUPREME_BOXER_EXPRESS_CHF,
    label: "Supreme Hanes Boxer Briefs (in stock)",
    matchReason: "Supreme boxers (fixed 49/69, no soldes)",
    productIds: [
      "15074846179714", // 4 Pack Black
      "15075733504386", // 4 Pack White
    ],
    skuBases: [
      "eadd2461-f6c4-45eb-86f8-83869bb034b3",
      "5ae9ed80-6772-46d8-922d-a7d03b251d01",
    ],
    titlePatterns: [/Supreme Hanes Boxer Briefs \(4 Pack\)/i],
  },
  {
    costChf: EDEN_BEANIE_COST_CHF,
    sellChf: EDEN_BEANIE_SELL_CHF,
    expressChf: EDEN_BEANIE_EXPRESS_CHF,
    hardSell: true,
    skipLivraison48h: true,
    label: "Arc'teryx Bird Head Beanie Eden/Black + Arctic Silk/Rune (in stock)",
    matchReason: "Arc'teryx Eden/Black + Arctic Silk/Rune beanies (fixed 79/99, express only)",
    productIds: [
      "15233996095874", // Arc'teryx Bird Head Toque Beanie Eden/Black (single One Size variant)
      "15240946155906", // Arc'teryx Bird Head Toque Beanie Arctic Silk/Rune (owned stock, bought 27 Nov)
    ],
  },
  {
    costChf: NIKE_TECH_GREY_COST_CHF,
    sellChf: NIKE_TECH_GREY_SELL_CHF,
    expressChf: NIKE_TECH_GREY_EXPRESS_CHF,
    hardSell: true,
    skipLivraison48h: true,
    label: "Nike Tech Fleece Dark Grey Heather (in stock)",
    matchReason: "Nike Tech grey joggers/windrunner S/M/L (fixed 99/119, express only)",
    // Exact variant SKUs only: other sizes of these products stay dropship at StockX pricing.
    skuBases: [
      "CU4495-063-S", // Joggers FB8002-063 (Shopify SKU still CU4495-063)
      "CU4495-063-M",
      "CU4495-063-L",
      "281c30b7-d092-4607-a39d-37d27b5a3ac9-S", // Windrunner FB7921-063
      "FB7921-063-M",
      "281c30b7-d092-4607-a39d-37d27b5a3ac9-L",
    ],
  },
  {
    costChf: CROCS_MCQUEEN_COST_CHF,
    label: "Crocs Lightning McQueen (warehouse)",
    matchReason: "Crocs Lightning McQueen warehouse buy 42",
    titlePatterns: [/Crocs Lightning McQueen/i],
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
    noExpress: rule.noExpress,
    hardSell: rule.hardSell,
    skipLivraison48h: rule.skipLivraison48h,
    galaxusExVatChf: rule.galaxusExVatChf,
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
