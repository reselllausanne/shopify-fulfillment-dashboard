import type { AvailabilityStatus } from "./types";
import { ZERO_REASON_NO_FRESH_SOURCE } from "./types";

/** Half-ceiling stock display: 1→1, 2→1, 3→2, 4→2, 5→3 */
export function halfCeilStock(rawQty: number): number {
  const qty = Math.max(0, Math.floor(Number(rawQty) || 0));
  if (qty <= 0) return 0;
  return Math.ceil(qty / 2);
}

export function statusNeedsManualReview(status: AvailabilityStatus): boolean {
  return (
    status === "manual_review_required" ||
    status === "variant_uncertain" ||
    status === "price_missing" ||
    status === "scrape_error" ||
    status === "stale"
  );
}

export function notSeenInCompleteRunDecision(): { publishedQty: number; zeroReason: string } {
  return {
    publishedQty: 0,
    zeroReason: "not_seen_in_complete_snapshot",
  };
}

export function globalPauseZeroDecision(reason = "supplier_paused"): {
  publishedQty: number;
  zeroReason: string;
} {
  return { publishedQty: 0, zeroReason: reason };
}

export function reviewBlockedDecision(): { publishedQty: number; zeroReason: string } {
  return { publishedQty: 0, zeroReason: "review_required_not_approved" };
}

export function noFreshSourceDecision(): {
  publishedQty: number;
  zeroReason: string;
  needsReview: boolean;
} {
  return {
    publishedQty: 0,
    zeroReason: ZERO_REASON_NO_FRESH_SOURCE,
    needsReview: true,
  };
}

/**
 * Publish qty from validated fresh source proof only.
 * - exact qty → ceil(n/2)
 * - quantityUnknown (confirmed sellable, qty hidden) → 1 max
 * - preorder/backorder/missing/uncertain → 0 + review
 * - defaultStock never publishes without having already failed fresh-evidence validation
 */
export function decidePublishedQuantity(input: {
  availabilityStatus: AvailabilityStatus;
  supplierStockQty: number | null | undefined;
  quantityUnknown?: boolean;
  hasFreshSourceEvidence?: boolean;
  usedDefaultStock?: boolean;
  packCount?: number | null;
  packInflation?: boolean;
  excluded?: boolean;
  maxPublished?: number;
}): { publishedQty: number; zeroReason?: string; needsReview: boolean } {
  if (!input.hasFreshSourceEvidence) {
    return noFreshSourceDecision();
  }

  if (input.usedDefaultStock) {
    return {
      publishedQty: 0,
      zeroReason: "default_stock_not_allowed_as_proof",
      needsReview: true,
    };
  }

  const status = input.availabilityStatus;

  if (input.excluded) {
    return { publishedQty: 0, zeroReason: "excluded_by_rule", needsReview: false };
  }

  if (statusNeedsManualReview(status)) {
    return { publishedQty: 0, zeroReason: status, needsReview: true };
  }

  if (
    status === "confirmed_out_of_stock" ||
    status === "not_found" ||
    status === "page_unavailable"
  ) {
    return { publishedQty: 0, zeroReason: status, needsReview: false };
  }

  if (status === "preorder" || status === "backorder_or_supplier_order") {
    return { publishedQty: 0, zeroReason: status, needsReview: true };
  }

  if (status !== "confirmed_in_stock") {
    return { publishedQty: 0, zeroReason: status, needsReview: true };
  }

  // Confirmed sellable but qty hidden → publish at most 1.
  if (input.quantityUnknown || input.supplierStockQty == null) {
    return { publishedQty: 1, needsReview: false };
  }

  let rawQty = Math.max(0, Math.floor(Number(input.supplierStockQty) || 0));
  const packCount = input.packCount != null ? Math.max(1, Math.floor(input.packCount)) : 1;
  if (packCount > 1 && rawQty > 0) {
    rawQty = Math.max(1, Math.floor(rawQty / packCount));
  }

  if (rawQty <= 0) {
    return { publishedQty: 0, zeroReason: "supplier_qty_zero", needsReview: false };
  }

  if (input.packInflation && rawQty === 1) {
    return { publishedQty: 1, needsReview: true };
  }

  let published = halfCeilStock(rawQty);
  const maxPublished = input.maxPublished ?? 12;
  if (published > maxPublished) published = maxPublished;

  return { publishedQty: published, needsReview: false };
}
