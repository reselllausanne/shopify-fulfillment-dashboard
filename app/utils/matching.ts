import { FALLBACK_SIZE_CHARTS, type SizeChartEntry } from "@/galaxus/kickdb/sizeCharts";
import { isLiquidationProductTitle } from "@/inventory/pricingPolicy";

export interface NormalizedSupplierOrder {
  chainId: string; // StockX long chainId (e.g. "14826275139352606543")
  orderId: string; // StockX orderId (often = orderNumber)
  supplierOrderNumber: string;
  purchaseDate: string; // ISO
  offerAmount: number | null;
  totalTTC: number | null;
  productTitle: string;
  productName?: string; // Optional: original product name (for workers)
  skuKey: string;
  sizeEU: string | null;
  statusKey: string | null;
  statusTitle: string | null;
  currencyCode: string | null;
  estimatedDeliveryDate?: string | null; // Optional: ISO date (for workers)
  latestEstimatedDeliveryDate?: string | null; // Optional: ISO date (for workers)
  productVariantId?: string; // Optional: for pricing queries (for workers)
  awb?: string | null; // ✅ Air Waybill / tracking number (from Query B)
  trackingUrl?: string | null; // ✅ Full tracking URL (from Query B)
  stockxCheckoutType?: string | null;
  stockxStates?: any | null;
}

export interface ShopifyLineItem {
  shopifyOrderId: string;
  orderName: string;
  createdAt: string;
  displayFinancialStatus: string;
  displayFulfillmentStatus: string | null;
  customerEmail: string | null;
  customerName: string | null;
  customerFirstName: string | null;
  customerLastName: string | null;
  shippingCountry: string | null;
  shippingCity: string | null;
  lineItemId: string;
  title: string;
  sku: string | null;
  variantTitle: string | null;
  quantity: number;
  price: string;
  totalPrice: string;
  currencyCode: string;
  sizeEU: string | null;
  lineItemImageUrl: string | null;
  /** From `Order.risk` (Shopify fraud analysis). */
  fraudRiskLevel?: string | null;
  fraudRecommendation?: string | null;
  fraudSummaryLabel?: string | null;
  /** From line item custom attributes / variant metafields at checkout. */
  deliveryMode?: "express" | "standard" | null;
  deliveryModeLabel?: string | null;
  deliveryEstimate?: string | null;
  expressAvailable?: boolean | null;
  expressPrice?: string | null;
  variantExpressPrice?: string | null;
}

/** True when Shopify order is fully refunded (not partial — partial refunds stay matchable). */
export function isShopifyFinancialRefunded(displayFinancialStatus: string | null | undefined): boolean {
  if (!displayFinancialStatus) return false;
  const fin = displayFinancialStatus.toUpperCase();
  if (fin.startsWith("PARTIALLY_REFUNDED")) return false;
  return fin.includes("REFUND");
}

/** Liquidation: "%" before " - {size}" or at title end — not mid-string (e.g. "100% cotton"). */
export function isLiquidationShopifyTitle(title: string | null | undefined): boolean {
  return isLiquidationProductTitle(title);
}

export interface MatchCandidate {
  supplierOrder: NormalizedSupplierOrder;
  score: number;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  timeDiffHours: number;
  overThreshold: boolean;
}

export interface MatchResult {
  shopifyItem: ShopifyLineItem;
  bestMatch: MatchCandidate | null;
  allCandidates: MatchCandidate[];
}

const THRESHOLD_HOURS = 96; // 4 days (default)
const SKU_EXACT_AUTO_THRESHOLD_HOURS = 168; // 7 days for exact SKU delayed fulfillment flows

export type InStockEssentialConfig = {
  costChf: number;
  label: string;
  matchReason: string;
};

type InStockEssentialRule = InStockEssentialConfig & {
  skuBases?: string[];
  titlePatterns?: RegExp[];
};

const IN_STOCK_ESSENTIAL_RULES: InStockEssentialRule[] = [
  {
    costChf: 42,
    label: "Essential Hoodie (in stock)",
    matchReason: "Essential Hoodie (auto 42 CHF)",
    skuBases: ["192HO246258F", "192HO246250F"],
  },
  {
    costChf: 20,
    label: "Essential T-Shirt (in stock)",
    matchReason: "Essential T-Shirt (auto 20 CHF)",
    skuBases: ["125HO244368F"],
    titlePatterns: [
      /Fear of God Essentials.*(Jersey|Crewneck|T-Shirt|Tee)\b/i,
      /^Essentials Tee\b/i,
    ],
  },
  {
    costChf: 20,
    label: "Essential Shorts (in stock)",
    matchReason: "Essential Shorts (auto 20 CHF)",
    skuBases: ["160BT212012F", "160BT212013F"],
    titlePatterns: [/^Essentials Shorts\b/i],
  },
];

function normalizeSkuKey(sku: string): string {
  return sku.trim().toUpperCase();
}

function skuMatchesBase(sku: string, base: string): boolean {
  const normalizedSku = normalizeSkuKey(sku);
  const normalizedBase = normalizeSkuKey(base);
  return normalizedSku === normalizedBase || normalizedSku.startsWith(`${normalizedBase}-`);
}

function resolveInStockEssentialRule(
  sku: string | null | undefined,
  title?: string | null
): InStockEssentialRule | null {
  const normalizedSku = sku?.trim() ?? "";
  const normalizedTitle = title?.trim() ?? "";

  for (const rule of IN_STOCK_ESSENTIAL_RULES) {
    if (
      normalizedSku &&
      rule.skuBases?.some((base) => skuMatchesBase(normalizedSku, base))
    ) {
      return rule;
    }
    if (
      normalizedTitle &&
      rule.titlePatterns?.some((pattern) => pattern.test(normalizedTitle))
    ) {
      return rule;
    }
  }

  return null;
}

/** Fear of God Essentials in-stock lines: auto-link with fixed COGS, skip StockX matching. */
export function resolveInStockEssential(
  sku: string | null | undefined,
  title?: string | null
): InStockEssentialConfig | null {
  const rule = resolveInStockEssentialRule(sku, title);
  if (!rule) return null;
  return {
    costChf: rule.costChf,
    label: rule.label,
    matchReason: rule.matchReason,
  };
}

export function isInStockEssentialLine(
  sku: string | null | undefined,
  title?: string | null
): boolean {
  return resolveInStockEssentialRule(sku, title) !== null;
}

/** @deprecated Use isInStockEssentialLine() — kept for legacy imports. */
export const EXCLUDED_SKUS = [
  // Light Heather Gray hoodie
  "192HO246258F-XS", "192HO246258F-S", "192HO246258F-M",
  "192HO246258F-L", "192HO246258F-XL", "192HO246258F-XXL",
  // Black FW24 hoodie
  "192HO246250F-XXS", "192HO246250F-XS", "192HO246250F-S",
  "192HO246250F-M", "192HO246250F-L", "192HO246250F-XL", "192HO246250F-XXL",
];

// Retail descriptor stopwords to remove from product names
// CONSERVATIVE: Only low-risk retail descriptors
const STOPWORDS = new Set([
  "asos",      // ASOS exclusive
  "exclusive", // Retailer exclusive
  "limited",   // Limited edition (generic)
  "edition",   // Edition (generic)
  "retailer",  // Retailer name
  "online",    // Online exclusive
  "store",     // Store exclusive
]);

type SizeMatchContext = {
  brand?: string | null;
  gender?: string | null;
};

function normalizeBrandForChart(value?: string | null): string | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower.includes("yeezy") && lower.includes("slide")) return "yeezyslide";
  if (lower.includes("yeezy") || lower.includes("yeez") || lower.includes("yzy")) return "adidas";
  if (lower.includes("jordan")) return "air jordan";
  return lower;
}

function normalizeGenderForChart(value?: string | null, sizeRaw?: string | null): "men" | "women" | "youth" {
  const lower = (value ?? "").toLowerCase();
  if (/(women|womens|woman|female|\bw\b)/.test(lower)) return "women";
  if (/(youth|kids|kid|gs|grade school|child|children)/.test(lower)) return "youth";
  const size = (sizeRaw ?? "").toUpperCase();
  if (/(^|\b)\d+(\.\d+)?\s*Y\b/.test(size)) return "youth";
  if (/(^|\b)GS\b/.test(size)) return "youth";
  return "men";
}

function getChart(brand?: string | null, gender?: string | null, sizeRaw?: string | null): SizeChartEntry | null {
  const normalizedBrand = normalizeBrandForChart(brand);
  if (!normalizedBrand) return null;
  const normalizedGender = normalizeGenderForChart(gender, sizeRaw);
  return (
    FALLBACK_SIZE_CHARTS.find(
      (entry) =>
        entry.brand.toLowerCase() === normalizedBrand.toLowerCase() &&
        entry.gender === normalizedGender
    ) ?? null
  );
}

function normalizeUsSize(value: string): string {
  let cleaned = value.trim();
  cleaned = cleaned.replace(/^US\s*M\s*/i, "");
  cleaned = cleaned.replace(/^US\s*W\s*/i, "");
  cleaned = cleaned.replace(/^US\s*/i, "");
  cleaned = cleaned.replace(/\s*(Y|GS)\b/i, "");
  return cleaned.trim();
}

function normalizeEuSize(value: string): string {
  return value.replace(/^EU\s*/i, "").trim();
}

function inferSizeSystem(value: string): "EU" | "US" | null {
  const upper = value.toUpperCase();
  if (/(^|[^A-Z])(\d+(\.\d+)?)(Y|GS)\b/.test(upper)) return "US";
  if (upper.includes("EU")) return "EU";
  if (upper.includes("US")) return "US";
  // Adidas-style EU (e.g. Shopify variant "41 1/3" without EU prefix)
  if (/\d+\s+\d+\s*\/\s*\d+/.test(value) || /\d+\s+2\/3/.test(value)) return "EU";
  return null;
}

function convertUsToEu(usValue: string, context?: SizeMatchContext): string | null {
  const chart = getChart(context?.brand ?? null, context?.gender ?? null, usValue);
  if (!chart) return null;
  const normalized = normalizeUsSize(usValue).replace(/\s+/g, "");
  if (!normalized) return null;
  const index = chart.sizes.US.findIndex(
    (entry) => entry.replace(/\s+/g, "") === normalized
  );
  if (index < 0 || index >= chart.sizes.EU.length) return null;
  return chart.sizes.EU[index] ?? null;
}

function inferBrandFromTitle(...titles: Array<string | null | undefined>): string | null {
  const brandList = Array.from(
    new Set(FALLBACK_SIZE_CHARTS.map((entry) => entry.brand.toLowerCase()))
  );
  for (const title of titles) {
    if (!title) continue;
    const lower = title.toLowerCase();
    if (!lower) continue;
    if (lower.includes("jordan")) return "air jordan";
    if (lower.includes("yeezy") || lower.includes("yzy")) return "adidas";
    for (const brand of brandList) {
      if (lower.includes(brand)) return brand;
    }
  }
  return null;
}

function buildSizeMatchContext(
  shopifyItem: ShopifyLineItem,
  supplierOrder: NormalizedSupplierOrder,
  shopifySize?: string | null,
  supplierSize?: string | null
): SizeMatchContext {
  const brand = inferBrandFromTitle(
    shopifyItem.title,
    supplierOrder.productTitle,
    supplierOrder.productName
  );
  const genderSource = `${shopifyItem.title ?? ""} ${supplierOrder.productTitle ?? ""}`;
  const gender = normalizeGenderForChart(genderSource, shopifySize ?? supplierSize ?? null);
  return { brand, gender };
}

function cleanShopifyTitleForMatch(title: string): string {
  return title
    // Remove liquidation "%" before size suffix: " … % - 38.5"
    .replace(/\s+%\s*-\s*(EU\s*)?\d+(\.\d+)?\s*$/i, "")
    // Remove trailing numeric size (+ optional Birkenstock width): " - 39N", " - EU 42"
    .replace(/\s*-\s*(EU\s*)?\d+(?:\.\d+)?[NRMW]?\s*$/i, "")
    // Remove trailing composite letter sizes: " - L/XL", " - S/M", " - 2XL/3XL"
    .replace(/\s*-\s*[A-Z0-9]+(?:\/[A-Z0-9]+)+\s*$/i, "")
    // Remove trailing letter size: " - L", " - XL", " - One Size", " - OS"
    .replace(/\s*-\s*(XXS|XS|S|M|L|XL|XXL|XXXL|One Size|OS|EU\s*\d+(\.\d+)?)\s*$/i, "")
    // Remove trailing liquidation "%": "Nike Dunk 20%"
    .replace(/\s*%\s*$/i, "")
    .trim();
}

function normalizeProductName(name: string): string {
  const normalized = name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ") // normalize spaces
    .replace(/[^\w\s-]/g, ""); // remove special chars except dash
  
  // Remove stopwords (retail descriptors)
  const words = normalized.split(/\s+/);
  const filteredWords = words.filter(word => !STOPWORDS.has(word));
  
  return filteredWords.join(" ");
}

/**
 * Extract base SKU from Shopify SKU by removing trailing size suffix
 * 
 * Examples:
 * - "U9060ASP-37.5" → "U9060ASP"
 * - "BQ6546-011-L" → "BQ6546-011"
 * - "<uuid>-OS" → "<uuid>"
 * 
 * Rules:
 * 1. Remove trailing size patterns: -XXS/-XS/-S/-M/-L/-XL/-XXL/-XXXL
 * 2. Remove trailing: -OS, -O/S, -ONE SIZE
 * 3. Remove trailing numeric sizes: -37.5, -42, -36 2/3, etc.
 * 4. Keep everything else (e.g., color codes like "-011")
 */
function skuBaseFromShopifySKU(sku: string | null): string | null {
  if (!sku) return null;
  
  const trimmed = sku.trim();
  
  // Pattern: Match trailing size suffix
  // Composite letter sizes first: -L/XL, -S/M, -2XL/3XL (must precede single -L/-XL)
  // Letter sizes: -XXS, -XS, -S, -M, -L, -XL, -XXL, -XXXL (case insensitive)
  // One Size: -OS, -O/S, -ONE SIZE
  // Numeric sizes: -37.5, -42, -36 2/3, -39N (Birkenstock width), -EU 36 2/3
  // Guarded to 1-2 leading digits to avoid stripping SKU color codes like "-011".
  const sizePattern =
    /-(?:[A-Z0-9]+(?:\/[A-Z0-9]+)+|XXXL|XXL|XL|XXS|XS|L|M|S|OS|O\/S|ONE\s*SIZE|EU\s*[1-9]\d?(?:[.,]\d+)?(?:\s+\d+\/\d+)?[NRMW]?|[1-9]\d?(?:[.,]\d+)?(?:\s+\d+\/\d+)?[NRMW]?)$/i;
  
  const baseSku = trimmed.replace(sizePattern, "");
  
  if (baseSku !== trimmed) {
    console.log(`[SKU_BASE] Extracted base: "${trimmed}" → "${baseSku}"`);
  }
  
  return baseSku || null;
}

/**
 * Check if SKU matches strongly (conservative)
 * 
 * Strong match criteria:
 * 1. Exact match after base extraction
 * 2. OR: Both >= 6 chars AND one contains the other with >= 90% overlap
 * 
 * This is conservative to avoid false positives.
 */
function skuStrongMatch(shopifySKU: string | null, supplierSkuKey: string): boolean {
  if (!shopifySKU || !supplierSkuKey) return false;
  
  const shopifyBase = skuBaseFromShopifySKU(shopifySKU);
  if (!shopifyBase) return false;
  
  const s1 = shopifyBase.toUpperCase();
  const s2 = supplierSkuKey.toUpperCase();
  
  // Exact match
  if (s1 === s2) {
    console.log(`[SKU_MATCH] ✅ EXACT match: "${shopifyBase}" === "${supplierSkuKey}"`);
    return true;
  }
  
  // Conservative contains match
  // Both must be >= 6 chars to avoid false positives on short codes
  if (s1.length >= 6 && s2.length >= 6) {
    const shorter = s1.length <= s2.length ? s1 : s2;
    const longer = s1.length > s2.length ? s1 : s2;
    
    // One contains the other
    if (longer.includes(shorter)) {
      // Calculate overlap percentage
      const overlap = shorter.length / longer.length;
      
      if (overlap >= 0.90) {
        console.log(
          `[SKU_MATCH] ✅ CONTAINS match: "${shopifyBase}" ↔ "${supplierSkuKey}" ` +
          `(overlap: ${(overlap * 100).toFixed(0)}%)`
        );
        return true;
      }
    }
  }
  
  // No strong match
  console.log(
    `[SKU_MATCH] ❌ No strong match: "${shopifyBase}" vs "${supplierSkuKey}" ` +
    `(not exact, overlap < 90%)`
  );
  return false;
}

function productNameMatch(name1: string, name2: string): { matches: boolean; similarity: number } {
  const n1 = normalizeProductName(name1);
  const n2 = normalizeProductName(name2);
  
  // Exact match after normalization
  if (n1 === n2) return { matches: true, similarity: 1.0 };
  
  // For LEGO: very strict match (contains same core name)
  if (n1.includes("lego") && n2.includes("lego")) {
    // Extract main part (remove "lego" prefix and compare rest)
    const legoName1 = n1.replace(/^lego\s*/i, "").trim();
    const legoName2 = n2.replace(/^lego\s*/i, "").trim();
    const matches = legoName1 === legoName2 || legoName1.includes(legoName2) || legoName2.includes(legoName1);
    return { matches, similarity: matches ? 1.0 : 0.0 };
  }
  
  // For regular products: very strict similarity (>95% word overlap)
  // Ignore pure numeric tokens (like "49.5") to avoid false negatives
  const words1 = new Set(
    n1.split(/\s+/).filter(w => w.length > 2 && !/^\d+(\.\d+)?$/.test(w))
  );
  const words2 = new Set(
    n2.split(/\s+/).filter(w => w.length > 2 && !/^\d+(\.\d+)?$/.test(w))
  );
  
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  const similarity = union.size > 0 ? intersection.size / union.size : 0;
  return { matches: similarity >= 0.95, similarity }; // 95% match required
}

function sizeMatch(size1: string | null, size2: string | null, context?: SizeMatchContext): boolean {
  // Normalize: convert empty/placeholder values to null
  const normalizeToNull = (size: string | null): string | null => {
    if (!size) return null;
    const trimmed = size.trim();
    // Treat "—", "N/A", "None", empty string as null
    if (trimmed === "—" || trimmed === "N/A" || trimmed === "None" || trimmed === "") {
      return null;
    }
    return trimmed;
  };
  
  const cleanSize1 = normalizeToNull(size1);
  const cleanSize2 = normalizeToNull(size2);
  
  // If both are null (no size) → match (accessories, one-size items)
  if (!cleanSize1 && !cleanSize2) {
    console.log(`[SIZE_MATCH] Both sizes are null/empty → ✅ MATCH (no size required)`);
    return true;
  }
  
  // If only one is null → check if other is "One Size" equivalent
  if (!cleanSize1 || !cleanSize2) {
    const existingSize = (cleanSize1 || cleanSize2)!.toUpperCase().replace(/\s/g, "");
    const isOneSize = existingSize === "ONESIZE" || existingSize === "OS" || existingSize === "O/S";
    if (isOneSize) {
      console.log(`[SIZE_MATCH] One null, other is One Size → ✅ MATCH`);
      return true;
    }
    console.log(`[SIZE_MATCH] One size is null, other is "${cleanSize1 || cleanSize2}" → ❌ NO MATCH`);
    return false;
  }
  
  // Both have sizes: normalize and compare
  const normalize = (size: string) => {
    let normalized = size.trim().toUpperCase();

    // Normalize "One Size" variants early
    normalized = normalized.replace(/ONE\s*SIZE/g, "OS").replace(/O\/S/g, "OS");

    // Collapse whitespace for predictable parsing
    normalized = normalized.replace(/\s+/g, " ");

    // Remove regional prefix only (keep size info that follows)
    // Examples:
    // - "US M" -> "M"
    // - "EU 42" -> "42"
    normalized = normalized.replace(/^(EU|US|UK|ASIA)\s+/i, "");

    // If gender marker precedes numeric size, drop it: "M 9" -> "9", "W10" -> "10"
    normalized = normalized.replace(/^(M|W)\s*(?=\d)/i, "");

    // Drop youth suffix: "5.5Y" -> "5.5", "6GS" -> "6"
    normalized = normalized.replace(/(Y|GS)$/i, "");

    // Remove spaces for final comparison
    normalized = normalized.replace(/\s/g, "");

    return normalized;
  };
  
  const s1 = normalize(cleanSize1);
  const s2 = normalize(cleanSize2);
  
  const matches = s1 === s2;
  console.log(`[SIZE_MATCH] Comparing: "${size1}" (normalized: "${s1}") vs "${size2}" (normalized: "${s2}") → ${matches ? "✅ MATCH" : "❌ NO MATCH"}`);
  
  if (matches) return true;

  const system1 = inferSizeSystem(cleanSize1);
  const system2 = inferSizeSystem(cleanSize2);
  if (system1 === "US" && system2 === "EU") {
    const converted = convertUsToEu(cleanSize1, context);
    if (converted) {
      const convertedNormalized = normalizeEuSize(converted);
      const targetNormalized = normalizeEuSize(cleanSize2);
      const convertedMatches = convertedNormalized === targetNormalized;
      console.log(
        `[SIZE_MATCH] US→EU conversion: "${cleanSize1}" → "${converted}" vs "${cleanSize2}" → ` +
          `${convertedMatches ? "✅ MATCH" : "❌ NO MATCH"}`
      );
      return convertedMatches;
    }
  }
  if (system1 === "EU" && system2 === "US") {
    const converted = convertUsToEu(cleanSize2, context);
    if (converted) {
      const convertedNormalized = normalizeEuSize(converted);
      const targetNormalized = normalizeEuSize(cleanSize1);
      const convertedMatches = convertedNormalized === targetNormalized;
      console.log(
        `[SIZE_MATCH] US→EU conversion: "${cleanSize2}" → "${converted}" vs "${cleanSize1}" → ` +
          `${convertedMatches ? "✅ MATCH" : "❌ NO MATCH"}`
      );
      return convertedMatches;
    }
  }

  return false;
}

function stringSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  
  if (s1 === s2) return 1.0;
  
  // Simple word overlap scoring
  const words1 = new Set(s1.split(/\s+/));
  const words2 = new Set(s2.split(/\s+/));
  
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  return union.size > 0 ? intersection.size / union.size : 0;
}

function parseDateMs(value: string): number | null {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  return time;
}

// Signed diff: supplier - shopify (hours). Returns null if invalid.
function calculateTimeDiff(shopifyDate: string, supplierDate: string): number | null {
  const shopifyMs = parseDateMs(shopifyDate);
  const supplierMs = parseDateMs(supplierDate);
  if (shopifyMs == null || supplierMs == null) return null;
  return (supplierMs - shopifyMs) / (1000 * 60 * 60);
}

function scoreTimeProximity(hours: number): number {
  if (hours <= 24) return 20;
  if (hours <= 48) return 15;
  if (hours <= 96) return 10;
  return 0;
}

/**
 * 🔐 CAUSAL HARD FILTER: Supplier order MUST be created AFTER Shopify order
 * 
 * Logic: In dropshipping model:
 * 1. Customer places Shopify order (sale)
 * 2. You buy from Supplier to fulfill it (purchase)
 * 
 * Therefore: supplierCreated MUST be >= shopifyCreated (with small tolerance for clock skew)
 * 
 * @param shopifyDate - Shopify order creation date (ISO)
 * @param supplierDate - Supplier order creation date (ISO)
 * @param toleranceMinutes - Allow small clock skew (default 5 minutes)
 * @returns true if causal order is valid (Supplier after Shopify)
 */
function isValidCausalOrder(
  shopifyDate: string, 
  supplierDate: string,
  toleranceMinutes: number = 5
): boolean {
  const shopifyTime = parseDateMs(shopifyDate);
  const supplierTime = parseDateMs(supplierDate);
  const toleranceMs = toleranceMinutes * 60 * 1000;
  
  if (shopifyTime == null || supplierTime == null) {
    console.log(
      `[CAUSAL] ❌ REJECTED: Invalid date(s) ` +
      `(shopify: "${shopifyDate}", supplier: "${supplierDate}")`
    );
    return false;
  }

  // Supplier must be created AFTER Shopify (with tolerance for clock skew)
  // If Supplier is more than 5 minutes BEFORE Shopify → INVALID
  const isValid = supplierTime >= (shopifyTime - toleranceMs);
  
  if (!isValid) {
    const diffMinutes = (shopifyTime - supplierTime) / (1000 * 60);
    console.log(
      `[CAUSAL] ❌ REJECTED: Supplier order created ${diffMinutes.toFixed(1)} minutes ` +
      `BEFORE Shopify order (violates dropship causality)`
    );
  }
  
  return isValid;
}

/**
 * Match a single Shopify line item to available supplier orders
 * 
 * @param shopifyItem - The Shopify line item to match
 * @param supplierOrders - All available supplier orders
 * @param usedSupplierNumbers - Set of supplier order numbers already matched (for 1:1 enforcement)
 * @returns Match result with best candidate
 */
export function matchShopifyToSupplier(
  shopifyItem: ShopifyLineItem,
  supplierOrders: NormalizedSupplierOrder[],
  usedSupplierNumbers: Set<string> = new Set()
): MatchResult {
  const inStockEssential = resolveInStockEssential(shopifyItem.sku, shopifyItem.title);
  const isLiquidation = isLiquidationShopifyTitle(shopifyItem.title);

  if (inStockEssential) {
    console.log(
      `[AUTO] ${inStockEssential.label} → auto ${inStockEssential.costChf} CHF (SKU ${shopifyItem.sku || "n/a"})`
    );
    const supplierOrderNumber = `ESS-${shopifyItem.orderName.replace("#", "")}`;
    const syntheticSupplier: NormalizedSupplierOrder = {
      chainId: "",
      orderId: supplierOrderNumber,
      supplierOrderNumber,
      purchaseDate: shopifyItem.createdAt,
      offerAmount: inStockEssential.costChf,
      totalTTC: inStockEssential.costChf,
      productTitle: shopifyItem.title,
      skuKey: shopifyItem.sku || "",
      sizeEU: shopifyItem.sizeEU || null,
      statusKey: "ESSENTIAL_STOCK",
      statusTitle: inStockEssential.label,
      currencyCode: shopifyItem.currencyCode || "CHF",
      estimatedDeliveryDate: null,
      productVariantId: undefined,
      awb: null,
      trackingUrl: null,
    };
    const syntheticMatch: MatchCandidate = {
      supplierOrder: syntheticSupplier,
      score: 999,
      confidence: "high",
      reasons: [inStockEssential.matchReason, "In-stock Essentials list"],
      timeDiffHours: 0,
      overThreshold: true,
    };
    return {
      shopifyItem,
      bestMatch: syntheticMatch,
      allCandidates: [syntheticMatch],
    };
  }

  // Liquidation products: never auto-match, return empty for manual only
  if (isLiquidation) {
    console.log(`[SKIP] Liquidation (manual only): ${shopifyItem.title}`);
    return {
      shopifyItem,
      bestMatch: null,
      allCandidates: [],
    };
  }

  // 🔒 GLOBAL 1:1 CONSTRAINT: Filter out already-used supplier orders
  const availableSuppliers = supplierOrders.filter(
    s => !usedSupplierNumbers.has(s.supplierOrderNumber)
  );
  
  if (availableSuppliers.length < supplierOrders.length) {
    console.log(
      `[1:1 FILTER] Filtered out ${supplierOrders.length - availableSuppliers.length} ` +
      `already-matched suppliers (${availableSuppliers.length} available)`
    );
  }

  const candidates: MatchCandidate[] = [];

  // Clean Shopify title (remove size suffix like " - 49.5")
  const shopifyTitleClean = cleanShopifyTitleForMatch(shopifyItem.title);
  if (shopifyTitleClean !== shopifyItem.title) {
    console.log(`[CLEAN] "${shopifyItem.title}" → "${shopifyTitleClean}"`);
  }

  for (const supplierOrder of availableSuppliers) {
    const reasons: string[] = [];

    // 🔍 DEBUG: Show what we're comparing
    const DEBUG = process.env.MATCH_DEBUG === "1";
    if (DEBUG) {
      console.log(`\n[MATCH_DEBUG] Comparing:`);
      console.log(`  Shopify: "${shopifyItem.title}"`);
      console.log(`  Shopify cleaned: "${shopifyTitleClean}"`);
      console.log(`  Supplier: "${supplierOrder.productTitle}"`);
      console.log(`  Shopify SKU: "${shopifyItem.sku}"`);
      console.log(`  Supplier skuKey: "${supplierOrder.skuKey}"`);
    }

    // HARD FILTER 1: Product name must match (>=95% strict)
    const nameMatchResult = productNameMatch(shopifyTitleClean, supplierOrder.productTitle);
    
    if (DEBUG) {
      console.log(`  Name similarity: ${(nameMatchResult.similarity * 100).toFixed(1)}%`);
    }
    
    // Store name match for later SKU override decision
    const nameMatchesStrictly = nameMatchResult.matches;
    
    if (!nameMatchesStrictly) {
      // Name doesn't match - we'll check SKU override later (after causal + time checks)
      console.log(
        `[MATCH] ⚠️ Name below threshold: "${shopifyTitleClean}" vs "${supplierOrder.productTitle}" ` +
        `(similarity: ${(nameMatchResult.similarity * 100).toFixed(1)}%) - checking SKU override...`
      );
    } else {
      reasons.push(`✅ Product name match (${(nameMatchResult.similarity * 100).toFixed(0)}%)`);
    }

    // HARD FILTER 2: Size must match 100% (if both have sizes)
    // EXCEPTION: LEGO products have no sizes, skip size validation entirely
    const isLEGO = shopifyItem.title.toLowerCase().includes("lego") || supplierOrder.productTitle.toLowerCase().includes("lego");
    
    if (isLEGO) {
      // LEGO products: No size validation at all
      reasons.push("🧱 LEGO (no size required)");
      console.log(`[MATCH] 🧱 LEGO product detected - skipping size validation`);
    } else {
      // Non-LEGO products: Strict size validation (now handles all cases intelligently)
      const shopifySize = shopifyItem.sizeEU || shopifyItem.variantTitle;
      const supplierSize = supplierOrder.sizeEU;
      const sizeContext = buildSizeMatchContext(
        shopifyItem,
        supplierOrder,
        shopifySize,
        supplierSize
      );
      
      console.log(`[MATCH] Size comparison: Shopify "${shopifySize}" (sizeEU: "${shopifyItem.sizeEU}", variantTitle: "${shopifyItem.variantTitle}") vs Supplier "${supplierSize}"`);
      
      // ✅ sizeMatch() now handles all cases: null, "—", "One Size", "ASIA L", etc.
      const sizeMatches = sizeMatch(shopifySize, supplierSize, sizeContext);
      
      if (!sizeMatches) {
        console.log(`[MATCH] ❌ Size mismatch: Shopify "${shopifySize}" vs Supplier "${supplierSize}" - SKIPPING`);
        continue; // Sizes don't match = skip candidate
      }
      
      // ✅ Size matched (could be exact match, both null, or One Size equivalence)
      reasons.push("✅ Size match");
    }

    // HARD FILTER 3: Causal order (StockX must be AFTER Shopify)
    // In dropshipping: Customer orders first (Shopify), then you buy to fulfill (StockX)
    // Prevents matching wrong orders based on time proximity alone
    const isValidCausal = isValidCausalOrder(
      shopifyItem.createdAt,
      supplierOrder.purchaseDate,
      5 // 5 minutes tolerance for clock skew
    );
    
    if (!isValidCausal) {
      console.log(
        `[MATCH] ❌ CAUSAL VIOLATION: Supplier order ${supplierOrder.supplierOrderNumber} ` +
        `created BEFORE Shopify order ${shopifyItem.orderName} - SKIPPING`
      );
      continue; // Skip candidates that violate causality
    }
    
    reasons.push("✅ Valid causal order");

    // 🔐 CONSERVATIVE SKU OVERRIDE CHECK
    // If name didn't match strictly, check if SKU can override
    // Only allow SKU override when:
    // 1. Causal order is valid (already checked above)
    // 2. Time diff <= 96 hours (checked below)
    // 3. SKU match is STRONG (exact or 90%+ conservative match)
    
    const timeDiffSigned = calculateTimeDiff(
      shopifyItem.createdAt,
      supplierOrder.purchaseDate
    );
    if (timeDiffSigned == null) {
      console.log(
        `[MATCH] ❌ Invalid time diff for ${supplierOrder.supplierOrderNumber} ` +
        `(shopify: "${shopifyItem.createdAt}", supplier: "${supplierOrder.purchaseDate}") - SKIPPING`
      );
      continue;
    }
    const timeDiffHours = Math.abs(timeDiffSigned);
    
    // Check if SKU override is possible
    let allowSkuOverride = false;
    if (!nameMatchesStrictly) {
      // Name didn't match - check if SKU can save it
      if (timeDiffHours <= 96) { // Within 4 days threshold
        const hasStrongSkuMatch = skuStrongMatch(shopifyItem.sku, supplierOrder.skuKey);
        
        if (hasStrongSkuMatch) {
          allowSkuOverride = true;
          reasons.push(`🔐 SKU override (name: ${(nameMatchResult.similarity * 100).toFixed(0)}%, time: ${timeDiffHours.toFixed(1)}h)`);
          console.log(
            `[MATCH] ✅ SKU OVERRIDE applied: Name ${(nameMatchResult.similarity * 100).toFixed(0)}% ` +
            `but strong SKU match within ${timeDiffHours.toFixed(1)}h`
          );
        } else {
          // SKU didn't match strongly enough
          console.log(
            `[MATCH] ❌ Name below threshold and no strong SKU match - SKIPPING`
          );
          continue;
        }
      } else {
        // Time diff > 96 hours - too risky even with SKU match
        console.log(
          `[MATCH] ❌ Name below threshold and time diff ${timeDiffHours.toFixed(1)}h > 96h - SKIPPING`
        );
        continue;
      }
    }

    // Now candidate passed ALL hard filters (including SKU override if needed)
    // Calculate score for ranking
    
    let score = 0;
    
    // Base score for passing filters
    score += 100;
    
    // Pre-compute SKU quality for time-threshold exception + score bonus.
    let skuExactMatch = false;
    let skuPartialMatch = false;
    if (shopifyItem.sku && supplierOrder.skuKey) {
      const shopifyBase = skuBaseFromShopifySKU(shopifyItem.sku);
      if (shopifyBase) {
        const s1 = shopifyBase.toUpperCase();
        const s2 = supplierOrder.skuKey.trim().toUpperCase();
        skuExactMatch = s1 === s2;
        skuPartialMatch = !skuExactMatch && (s1.includes(s2) || s2.includes(s1));
      }
    }

    const effectiveThresholdHours = skuExactMatch
      ? SKU_EXACT_AUTO_THRESHOLD_HOURS
      : THRESHOLD_HOURS;

    // Time score (0-50 points) - main way to differentiate duplicates
    if (timeDiffHours <= 1) {
      score += 50;
      reasons.push("⏱️ Within 1 hour");
    } else if (timeDiffHours <= 6) {
      score += 45;
      reasons.push("⏱️ Within 6 hours");
    } else if (timeDiffHours <= 24) {
      score += 40;
      reasons.push("⏱️ Within 24 hours");
    } else if (timeDiffHours <= 48) {
      score += 30;
      reasons.push("⏱️ Within 48 hours");
    } else if (timeDiffHours <= 96) {
      score += 20;
      reasons.push("⏱️ Within 4 days");
    } else if (skuExactMatch && timeDiffHours <= SKU_EXACT_AUTO_THRESHOLD_HOURS) {
      score += 15;
      reasons.push("⏱️ Within 7 days (exact SKU exception)");
    } else {
      score += 5;
      const timeDiffDays = (timeDiffHours / 24).toFixed(1);
      reasons.push(`⚠️ ${timeDiffDays} days apart (over threshold)`);
    }

    // Optional SKU validation (bonus points for scoring)
    // Use base SKU extraction for accurate comparison
    if (shopifyItem.sku && supplierOrder.skuKey) {
      if (skuExactMatch) {
        score += 10;
        reasons.push("🔐 SKU exact match (bonus)");
      } else if (skuPartialMatch) {
        score += 5;
        reasons.push("🔐 SKU partial match (bonus)");
      }
    }

    const overThreshold = timeDiffHours > effectiveThresholdHours;

    // Determine confidence
    let confidence: "high" | "medium" | "low";
    if (score >= 140 && !overThreshold) confidence = "high"; // name+size+time<24h+sku
    else if (score >= 120 && !overThreshold) confidence = "high"; // name+size+time<48h
    else if (score >= 100) confidence = "medium"; // name+size match but time>4d
    else confidence = "low";

    candidates.push({
      supplierOrder,
      score,
      confidence,
      reasons,
      timeDiffHours,
      overThreshold,
    });
  }

  // Sort by score descending (time proximity will be main differentiator)
  candidates.sort((a, b) => b.score - a.score);

  let bestMatch = candidates.length > 0 ? candidates[0] : null;
  
  // 🧱 FIFO TIE-BREAKER for identical products (LEGO, accessories, etc.)
  // When top candidates have identical scores (same product, no size diff),
  // prefer chronologically closest match to preserve FIFO matching
  if (bestMatch && candidates.length >= 2) {
    const topScore = candidates[0].score;
    
    // Find all candidates with same score as top (within 1 point tolerance)
    const tiedCandidates = candidates.filter(c => Math.abs(c.score - topScore) <= 1);
    
    if (tiedCandidates.length > 1) {
      console.log(
        `[FIFO] ${tiedCandidates.length} candidates tied at score ${topScore} - ` +
        `applying FIFO tie-breaker (prefer chronologically closest)`
      );
      
      // Sort tied candidates by time proximity (FIFO: closest purchase after sale)
      tiedCandidates.sort((a, b) => a.timeDiffHours - b.timeDiffHours);
      
      bestMatch = tiedCandidates[0];
      
      console.log(
        `[FIFO] Selected: ${bestMatch.supplierOrder.supplierOrderNumber} ` +
        `(${bestMatch.timeDiffHours.toFixed(2)}h after Shopify order)`
      );
    }
  }
  
  // 🔐 AMBIGUITY DETECTION: If top1 and top2 scores are too close, downgrade to MEDIUM
  // This prevents auto-matching when there's uncertainty between multiple candidates
  if (bestMatch && candidates.length >= 2) {
    const top1Score = candidates[0].score;
    const top2Score = candidates[1].score;
    const scoreDiff = top1Score - top2Score;
    
    // If scores are within 10 points of each other → ambiguous
    if (scoreDiff < 10 && bestMatch.confidence === "high") {
      console.log(
        `[MATCH] ⚠️ AMBIGUOUS: Top 2 candidates have close scores ` +
        `(${top1Score} vs ${top2Score}, diff: ${scoreDiff}) - downgrading to MEDIUM for manual review`
      );
      
      // Downgrade confidence to force manual review
      bestMatch = {
        ...bestMatch,
        confidence: "medium",
        reasons: [
          ...bestMatch.reasons,
          `⚠️ Ambiguous (top2 score diff: ${scoreDiff})`
        ]
      };
    }
  }

  return {
    shopifyItem,
    bestMatch,
    allCandidates: candidates,
  };
}

