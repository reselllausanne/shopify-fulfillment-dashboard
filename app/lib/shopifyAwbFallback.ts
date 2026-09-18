/**
 * Match a StockX inbound package (AWB without pre-link) to open Shopify lines.
 * Exact SKU + size + dropship causality. Ambiguity → confirm; none → manual.
 *
 * Shopify line SKUs often embed size (`STYLE-42`, `STYLE-XL`). Inbound packages
 * store base style id + separate sizeEU (StockX US or clothing letter). Matching
 * therefore compares base SKUs and resolves sizes via direct equality, SKU
 * suffix, or US→EU footwear charts when needed.
 */

import { isValidStockxBuyAfterCustomerOrder } from "@/app/lib/stockxCausal";
import { resolveFootwearEuSize } from "@/app/lib/footwearSizeEu";
import { compactSearchKey, foldSearchText } from "@/lib/searchNormalize";

export type InboundPackageLike = {
  awb: string;
  sku: string | null;
  sizeEU: string | null;
  productName: string | null;
  purchaseDate: string | Date | null;
  stockxOrderNumber?: string | null;
  stockxAccountKey?: string | null;
  status?: string | null;
};

export type OpenShopifyLineCandidate = {
  shopifyOrderId: string;
  shopifyOrderName: string | null;
  shopifyLineItemId: string;
  shopifySku: string | null;
  shopifySizeEU: string | null;
  shopifyProductTitle: string | null;
  shopifyCreatedAt: string | Date;
  remainingQuantity: number;
};

export type ShopifyAwbFallbackMatch =
  | { status: "none" }
  | {
      status: "exact";
      candidate: OpenShopifyLineCandidate;
      reason: string;
    }
  | {
      status: "ambiguous";
      candidates: OpenShopifyLineCandidate[];
      reason: string;
    };

function normalizeSku(value: unknown): string {
  return compactSearchKey(value);
}

function normalizeSize(value: unknown): string {
  return foldSearchText(value)
    .replace(/eu/g, "")
    .replace(/[^a-z0-9.]/g, "")
    .trim();
}

/** Strip trailing size suffix from Shopify SKUs (`STYLE-42.5`, `STYLE-XL`). */
export function shopifySkuBase(value: unknown): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  const sizePattern =
    /-(?:[A-Z0-9]+(?:\/[A-Z0-9]+)+|XXXL|XXL|XL|XXS|XS|L|M|S|OS|O\/S|ONE\s*SIZE|EU\s*[1-9]\d?(?:[.,]\d+)?(?:\s+\d+\/\d+)?[NRMW]?|[1-9]\d?(?:[.,]\d+)?(?:\s+\d+\/\d+)?[NRMW]?)$/i;
  return trimmed.replace(sizePattern, "").trim();
}

export function sizeFromShopifySku(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const base = shopifySkuBase(trimmed);
  if (!base || base === trimmed) return null;
  const suffix = trimmed.slice(base.length).replace(/^-/, "").trim();
  return suffix || null;
}

export function skuEquals(a: unknown, b: unknown): boolean {
  const left = normalizeSku(a);
  const right = normalizeSku(b);
  if (left && right && left === right) return true;

  // Inbound base style vs Shopify `BASE-<size>` (do not strip `-1` color/style tokens).
  const aRaw = String(a ?? "").trim().toLowerCase();
  const bRaw = String(b ?? "").trim().toLowerCase();
  if (aRaw && bRaw && (bRaw.startsWith(`${aRaw}-`) || aRaw.startsWith(`${bRaw}-`))) {
    return true;
  }

  const leftBase = normalizeSku(shopifySkuBase(a) || a);
  const rightBase = normalizeSku(shopifySkuBase(b) || b);
  return Boolean(leftBase && rightBase && leftBase === rightBase);
}

export function sizeEquals(a: unknown, b: unknown): boolean {
  const left = normalizeSize(a);
  const right = normalizeSize(b);
  if (!left || !right) return false;
  return left === right;
}

function brandHintFromText(...parts: Array<string | null | undefined>): string | null {
  const blob = parts.filter(Boolean).join(" ").toLowerCase();
  if (!blob) return null;
  if (blob.includes("jordan")) return "Air Jordan";
  if (blob.includes("adidas") || blob.includes("yeezy")) return "adidas";
  if (blob.includes("new balance") || /\bnb\b/.test(blob)) return "New Balance";
  if (blob.includes("nike") || blob.includes("dunk") || blob.includes("air force")) return "Nike";
  return null;
}

function genderHintFromSize(size: string | null | undefined): string | null {
  const raw = String(size ?? "");
  if (/\d+(\.\d+)?\s*W\b/i.test(raw) || /\bW\b/i.test(raw)) return "women";
  if (/\d+(\.\d+)?\s*Y\b/i.test(raw) || /\bGS\b/i.test(raw)) return "youth";
  return "men";
}

function euCandidatesFromPackageSize(
  pkgSize: string | null | undefined,
  productName?: string | null
): string[] {
  const raw = String(pkgSize ?? "").trim();
  if (!raw) return [];
  const out = new Set<string>();
  out.add(raw);
  const brand = brandHintFromText(productName);
  const gender = genderHintFromSize(raw);
  const brands = brand
    ? [brand]
    : ["Nike", "Air Jordan", "adidas", "New Balance"];
  for (const b of brands) {
    const resolved = resolveFootwearEuSize(raw, { brand: b, gender });
    if (resolved.euSize) out.add(resolved.euSize);
  }
  return [...out];
}

/** Package size vs Shopify size label and/or size embedded in Shopify SKU. */
export function sizesCompatible(
  pkgSize: unknown,
  shopifySize: unknown,
  shopifySku?: unknown,
  productName?: string | null
): boolean {
  const pkg = String(pkgSize ?? "").trim();
  if (!pkg) return false;
  const labels = [
    shopifySize,
    sizeFromShopifySku(shopifySku),
  ]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);
  if (labels.length === 0) return false;

  for (const label of labels) {
    if (sizeEquals(pkg, label)) return true;
  }

  const pkgEu = euCandidatesFromPackageSize(pkg, productName);
  for (const label of labels) {
    for (const eu of pkgEu) {
      if (sizeEquals(eu, label)) return true;
      const shopEu = resolveFootwearEuSize(label, {
        brand: brandHintFromText(productName) ?? "Nike",
        gender: genderHintFromSize(pkg),
      });
      if (shopEu.euSize && sizeEquals(eu, shopEu.euSize)) return true;
    }
  }
  return false;
}

/**
 * Filter open Shopify lines that exactly match package SKU+size and pass causality.
 */
export function filterShopifyAwbFallbackCandidates(
  pkg: InboundPackageLike,
  openLines: OpenShopifyLineCandidate[]
): OpenShopifyLineCandidate[] {
  if (!normalizeSku(pkg.sku)) return [];
  return (openLines ?? []).filter((line) => {
    if (line.remainingQuantity <= 0) return false;
    if (!skuEquals(pkg.sku, line.shopifySku)) return false;
    if (
      !sizesCompatible(
        pkg.sizeEU,
        line.shopifySizeEU,
        line.shopifySku,
        pkg.productName
      )
    ) {
      return false;
    }
    if (
      !isValidStockxBuyAfterCustomerOrder(line.shopifyCreatedAt, pkg.purchaseDate)
    ) {
      return false;
    }
    return true;
  });
}

export function resolveShopifyAwbFallbackMatch(
  pkg: InboundPackageLike,
  openLines: OpenShopifyLineCandidate[]
): ShopifyAwbFallbackMatch {
  const candidates = filterShopifyAwbFallbackCandidates(pkg, openLines);
  if (candidates.length === 0) return { status: "none" };
  if (candidates.length === 1) {
    return {
      status: "exact",
      candidate: candidates[0],
      reason: "exact_sku_size_causal",
    };
  }
  // Prefer oldest customer order (FIFO) when still ambiguous after filters —
  // but surface as ambiguous so UI confirms (operator must pick).
  const sorted = [...candidates].sort((a, b) => {
    const am = new Date(a.shopifyCreatedAt).getTime();
    const bm = new Date(b.shopifyCreatedAt).getTime();
    return am - bm;
  });
  return {
    status: "ambiguous",
    candidates: sorted,
    reason: "multiple_exact_sku_size_causal",
  };
}
