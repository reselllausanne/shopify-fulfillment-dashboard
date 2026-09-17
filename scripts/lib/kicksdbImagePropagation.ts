/**
 * Aggregate per-offer Merchant image checks into a product-level status.
 * CORRECT only when every active offer is correct.
 */

export type OfferCheckStatus = "correct" | "pending" | "mismatch" | "lookup_failed";

export type ProductPropagationStatus =
  | "SHOPIFY_CORRECT_GOOGLE_CORRECT"
  | "SHOPIFY_CORRECT_GOOGLE_PARTIAL"
  | "SHOPIFY_CORRECT_GOOGLE_PENDING"
  | "SHOPIFY_CORRECT_GOOGLE_MISMATCH"
  | "SHOPIFY_INVALID"
  | "GOOGLE_LOOKUP_FAILED";

export type OfferAggregate = {
  status: ProductPropagationStatus;
  offerCount: number;
  correctCount: number;
  pendingCount: number;
  mismatchCount: number;
  lookupFailedCount: number;
};

export function aggregateOfferStatuses(statuses: OfferCheckStatus[]): OfferAggregate {
  const offerCount = statuses.length;
  if (offerCount === 0) {
    return {
      status: "GOOGLE_LOOKUP_FAILED",
      offerCount: 0,
      correctCount: 0,
      pendingCount: 0,
      mismatchCount: 0,
      lookupFailedCount: 0,
    };
  }
  const correctCount = statuses.filter((s) => s === "correct").length;
  const pendingCount = statuses.filter((s) => s === "pending").length;
  const mismatchCount = statuses.filter((s) => s === "mismatch").length;
  const lookupFailedCount = statuses.filter((s) => s === "lookup_failed").length;

  let status: ProductPropagationStatus;
  if (correctCount === offerCount) {
    status = "SHOPIFY_CORRECT_GOOGLE_CORRECT";
  } else if (correctCount > 0) {
    status = "SHOPIFY_CORRECT_GOOGLE_PARTIAL";
  } else if (pendingCount === offerCount) {
    status = "SHOPIFY_CORRECT_GOOGLE_PENDING";
  } else if (mismatchCount === offerCount) {
    status = "SHOPIFY_CORRECT_GOOGLE_MISMATCH";
  } else if (lookupFailedCount === offerCount) {
    status = "GOOGLE_LOOKUP_FAILED";
  } else {
    // Mix of pending/mismatch/failed with zero correct → partial (not all correct).
    status = "SHOPIFY_CORRECT_GOOGLE_PARTIAL";
  }

  return {
    status,
    offerCount,
    correctCount,
    pendingCount,
    mismatchCount,
    lookupFailedCount,
  };
}
