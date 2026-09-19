/**
 * TUS (The Uncommon Shop / WooCommerce) per-variant publish qty proof.
 * - "Verfügbar: N" / "N vorrätig" / cart max<9000 → halfCeil(N)
 * - Nicht vorrätig / !is_purchasable / preorder / gift card → 0
 * - Missing qty → 0 (never invent)
 * ID scheme distinguishes parent vs variant (see buildTusObservationId).
 */
import { halfCeil } from "./halfCeil";

export type TusStockParse = {
  sourceQty: number | null;
  isPurchasable: boolean;
  isGiftCard: boolean;
  isPreorder: boolean;
  hasPositiveProof: boolean;
  reason: string;
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

export function parseTusStockText(text: string | null | undefined): {
  qty: number | null;
  source: string;
} {
  const t = String(text ?? "").trim();
  if (!t) return { qty: null, source: "empty" };
  if (/nicht\s+(auf\s+lager|vorrätig|verfuegbar|verfügbar)/i.test(t) || /out[- ]of[- ]stock/i.test(t)) {
    return { qty: 0, source: "oos_text" };
  }
  const mVerf = t.match(/verf(?:ü|ue)gbar\s*:\s*(\d+)/i);
  if (mVerf) return { qty: Number(mVerf[1]), source: "verfuegbar" };
  const mVorr = t.match(/(\d+)\s*vorrätig/i);
  if (mVorr) return { qty: Number(mVorr[1]), source: "vorraetig" };
  const mAvail = t.match(/available\s*:\s*(\d+)/i);
  if (mAvail) return { qty: Number(mAvail[1]), source: "available" };
  return { qty: null, source: "unknown" };
}

export function parseTusStock(input: {
  stockText?: string | null;
  cartMax?: number | null;
  isPurchasable?: boolean;
  isInStock?: boolean;
  isPreorder?: boolean;
  isGiftCard?: boolean;
}): TusStockParse {
  if (input.isGiftCard) {
    return {
      sourceQty: null,
      isPurchasable: false,
      isGiftCard: true,
      isPreorder: false,
      hasPositiveProof: false,
      reason: "gift_card",
    };
  }
  if (input.isPreorder) {
    return {
      sourceQty: null,
      isPurchasable: false,
      isGiftCard: false,
      isPreorder: true,
      hasPositiveProof: false,
      reason: "preorder",
    };
  }
  if (input.isPurchasable === false || input.isInStock === false) {
    return {
      sourceQty: 0,
      isPurchasable: false,
      isGiftCard: false,
      isPreorder: false,
      hasPositiveProof: false,
      reason: "not_purchasable",
    };
  }

  const parsed = parseTusStockText(input.stockText);
  if (parsed.qty == null) {
    const cart = Number(input.cartMax ?? NaN);
    if (Number.isFinite(cart) && cart > 0 && cart < 9000) {
      return {
        sourceQty: cart,
        isPurchasable: true,
        isGiftCard: false,
        isPreorder: false,
        hasPositiveProof: true,
        reason: "cart_max",
      };
    }
    return {
      sourceQty: null,
      isPurchasable: true,
      isGiftCard: false,
      isPreorder: false,
      hasPositiveProof: false,
      reason: "no_qty",
    };
  }
  if (parsed.qty <= 0) {
    return {
      sourceQty: 0,
      isPurchasable: false,
      isGiftCard: false,
      isPreorder: false,
      hasPositiveProof: false,
      reason: "zero_qty",
    };
  }
  return {
    sourceQty: parsed.qty,
    isPurchasable: true,
    isGiftCard: false,
    isPreorder: false,
    hasPositiveProof: true,
    reason: `stock_text_${parsed.source}`,
  };
}

export function decideTusPublishedQty(parse: TusStockParse): TusPublishDecision {
  if (!parse.hasPositiveProof || parse.sourceQty == null || parse.sourceQty <= 0) {
    return {
      sourceQty: parse.sourceQty,
      proposedQty: 0,
      reason: parse.reason,
      hasPositiveProof: false,
    };
  }
  const proposed = halfCeil(parse.sourceQty);
  return {
    sourceQty: parse.sourceQty,
    proposedQty: proposed,
    reason: `halfCeil:${parse.sourceQty}`,
    hasPositiveProof: proposed > 0,
  };
}
