/**
 * TUS (The Uncommon Shop / WooCommerce) publish qty proof.
 * - purchasable + inStock + verfuegbarQty>0 → halfCeil(N)
 * - "Nicht vorrätig" copy in html → 0
 * - !purchasable / preorder / gift card / missing qty → 0
 * Observation ids distinguish parent vs variant (see buildTusObservationId).
 */
import { halfCeil } from "./halfCeil";

export type TusPublishInput = {
  verfuegbarQty?: number | null;
  purchasable?: boolean;
  inStock?: boolean;
  htmlOrText?: string | null;
  isPreorder?: boolean;
  isGiftCard?: boolean;
  cartMax?: number | null;
};

export type TusPublishDecision = {
  sourceQty: number | null;
  proposedQty: number;
  reason: string;
  hasPositiveProof: boolean;
};

export function buildTusObservationId(input: {
  parentWooId: number | null;
  variantWooId: number;
  gtin: string;
}): string {
  const parent = input.parentWooId ? `p${input.parentWooId}` : "p0";
  return `tus_${parent}_v${input.variantWooId}_${input.gtin}`;
}

function pdpOos(html: string): boolean {
  return (
    /nicht\s+(auf\s+lager|vorrätig|verfuegbar|verfügbar)/i.test(html) ||
    /out[- ]of[- ]stock/i.test(html) ||
    /ausverkauft/i.test(html)
  );
}

export function decideTusPublishedQty(input: TusPublishInput): TusPublishDecision {
  const html = String(input.htmlOrText ?? "");
  if (input.isGiftCard) {
    return { sourceQty: null, proposedQty: 0, reason: "gift_card", hasPositiveProof: false };
  }
  if (input.isPreorder) {
    return { sourceQty: null, proposedQty: 0, reason: "preorder", hasPositiveProof: false };
  }
  if (html && pdpOos(html)) {
    return { sourceQty: 0, proposedQty: 0, reason: "pdp_oos_text", hasPositiveProof: false };
  }
  if (input.purchasable === false || input.inStock === false) {
    return { sourceQty: 0, proposedQty: 0, reason: "not_purchasable", hasPositiveProof: false };
  }

  const verf = input.verfuegbarQty;
  let q =
    verf == null || !Number.isFinite(Number(verf))
      ? null
      : Math.max(0, Math.floor(Number(verf)));
  if (q == null) {
    const cart = Number(input.cartMax ?? NaN);
    if (Number.isFinite(cart) && cart > 0 && cart < 9000) q = Math.floor(cart);
  }
  if (q == null) {
    return { sourceQty: null, proposedQty: 0, reason: "no_qty", hasPositiveProof: false };
  }
  if (q <= 0) {
    return { sourceQty: 0, proposedQty: 0, reason: "zero_qty", hasPositiveProof: false };
  }
  const proposed = halfCeil(q);
  return {
    sourceQty: q,
    proposedQty: proposed,
    reason: `halfCeil:${q}`,
    hasPositiveProof: proposed > 0,
  };
}
