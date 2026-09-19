/**
 * WRK (Warenkontor — Shopify) publish qty proof.
 * WRK uses the Shopify path (scrapeShop). Public .js hides qty; UI shows
 * low-stock text + inventory_policy:continue. Only trust:
 *   - Tracked inventory qty > 0 → halfCeil(N)
 *   - Untracked (inventory_management null) + available:true → 1 (quantityUnknown)
 *   - Preorder / unavailable / late delivery / missing page → 0
 * Never invent hidden qty.
 */
import { halfCeil } from "./halfCeil";

export type WrkStockParse = {
  sourceQty: number | null;
  tracked: boolean;
  available: boolean;
  isPreorder: boolean;
  hasPositiveProof: boolean;
  quantityUnknown: boolean;
  reason: string;
};

export type WrkPublishDecision = {
  sourceQty: number | null;
  proposedQty: number;
  reason: string;
  hasPositiveProof: boolean;
  quantityUnknown: boolean;
};

export function parseWrkStock(input: {
  available?: boolean;
  trackedQty?: number | null;
  inventoryManagement?: string | null; // "shopify" | "" | null
  isPreorder?: boolean;
  lateDelivery?: boolean;
  pageMissing?: boolean;
}): WrkStockParse {
  if (input.pageMissing) {
    return {
      sourceQty: null,
      tracked: false,
      available: false,
      isPreorder: false,
      hasPositiveProof: false,
      quantityUnknown: false,
      reason: "page_missing",
    };
  }
  if (input.isPreorder) {
    return {
      sourceQty: null,
      tracked: false,
      available: false,
      isPreorder: true,
      hasPositiveProof: false,
      quantityUnknown: false,
      reason: "preorder",
    };
  }
  if (input.lateDelivery) {
    return {
      sourceQty: null,
      tracked: false,
      available: false,
      isPreorder: false,
      hasPositiveProof: false,
      quantityUnknown: false,
      reason: "late_delivery",
    };
  }
  if (!input.available) {
    return {
      sourceQty: 0,
      tracked: false,
      available: false,
      isPreorder: false,
      hasPositiveProof: false,
      quantityUnknown: false,
      reason: "not_available",
    };
  }

  const mgmt = String(input.inventoryManagement ?? "").trim();
  const tracked = Boolean(mgmt);
  const qty = input.trackedQty == null ? null : Math.max(0, Math.floor(input.trackedQty));

  if (tracked) {
    if (qty == null || qty <= 0) {
      return {
        sourceQty: qty,
        tracked: true,
        available: true,
        isPreorder: false,
        hasPositiveProof: false,
        quantityUnknown: false,
        reason: "tracked_zero_or_missing",
      };
    }
    return {
      sourceQty: qty,
      tracked: true,
      available: true,
      isPreorder: false,
      hasPositiveProof: true,
      quantityUnknown: false,
      reason: "shopify_tracked_qty",
    };
  }

  // Untracked but available:true → sellable at qty unknown → publish 1 (min).
  return {
    sourceQty: null,
    tracked: false,
    available: true,
    isPreorder: false,
    hasPositiveProof: true,
    quantityUnknown: true,
    reason: "untracked_available",
  };
}

export function decideWrkPublishedQty(parse: WrkStockParse): WrkPublishDecision {
  if (!parse.hasPositiveProof) {
    return {
      sourceQty: parse.sourceQty,
      proposedQty: 0,
      reason: parse.reason,
      hasPositiveProof: false,
      quantityUnknown: parse.quantityUnknown,
    };
  }
  if (parse.quantityUnknown || parse.sourceQty == null) {
    return {
      sourceQty: parse.sourceQty,
      proposedQty: 1,
      reason: parse.reason,
      hasPositiveProof: true,
      quantityUnknown: true,
    };
  }
  const proposed = halfCeil(parse.sourceQty);
  return {
    sourceQty: parse.sourceQty,
    proposedQty: proposed,
    reason: `halfCeil:${parse.sourceQty}`,
    hasPositiveProof: proposed > 0,
    quantityUnknown: false,
  };
}
