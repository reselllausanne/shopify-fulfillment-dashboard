/**
 * WRK (Warenkontor via Shopify) publish qty proof.
 * - page present + available + inventoryTracked + trackedQty>0 → halfCeil(N)
 * - available + inventory not tracked / hidden qty → 0 (qty_hidden_not_invented)
 * - !available / preorder / page missing / late delivery → 0
 */
import { halfCeil } from "./halfCeil";

export type WrkPublishInput = {
  pagePresent?: boolean;
  available?: boolean;
  trackedQty?: number | null;
  inventoryTracked?: boolean;
  isPreorder?: boolean;
  lateDelivery?: boolean;
};

export type WrkPublishDecision = {
  sourceQty: number | null;
  proposedQty: number;
  reason: string;
  hasPositiveProof: boolean;
};

export function decideWrkPublishedQty(input: WrkPublishInput): WrkPublishDecision {
  if (input.pagePresent === false) {
    return {
      sourceQty: null,
      proposedQty: 0,
      reason: "page_missing",
      hasPositiveProof: false,
    };
  }
  if (input.isPreorder) {
    return { sourceQty: null, proposedQty: 0, reason: "preorder", hasPositiveProof: false };
  }
  if (input.lateDelivery) {
    return { sourceQty: null, proposedQty: 0, reason: "late_delivery", hasPositiveProof: false };
  }
  if (!input.available) {
    return { sourceQty: 0, proposedQty: 0, reason: "not_available", hasPositiveProof: false };
  }
  if (!input.inventoryTracked) {
    return {
      sourceQty: null,
      proposedQty: 0,
      reason: "qty_hidden_not_invented",
      hasPositiveProof: false,
    };
  }
  const q =
    input.trackedQty == null || !Number.isFinite(Number(input.trackedQty))
      ? null
      : Math.max(0, Math.floor(Number(input.trackedQty)));
  if (q == null || q <= 0) {
    return {
      sourceQty: q,
      proposedQty: 0,
      reason: "tracked_zero_or_missing",
      hasPositiveProof: false,
    };
  }
  const proposed = halfCeil(q);
  return {
    sourceQty: q,
    proposedQty: proposed,
    reason: `halfCeil:${q}`,
    hasPositiveProof: proposed > 0,
  };
}
