/**
 * Match a StockX inbound package (AWB without pre-link) to open Shopify lines.
 * Exact SKU + size + dropship causality. Ambiguity → confirm; none → manual.
 */

import { isValidStockxBuyAfterCustomerOrder } from "@/app/lib/stockxCausal";
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

export function skuEquals(a: unknown, b: unknown): boolean {
  const left = normalizeSku(a);
  const right = normalizeSku(b);
  return Boolean(left && right && left === right);
}

export function sizeEquals(a: unknown, b: unknown): boolean {
  const left = normalizeSize(a);
  const right = normalizeSize(b);
  if (!left || !right) return false;
  return left === right;
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
    if (!sizeEquals(pkg.sizeEU, line.shopifySizeEU)) return false;
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
