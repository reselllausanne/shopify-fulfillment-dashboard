/**
 * BWZ (baby-walz Scayle/Nuxt) publish qty proof.
 * - NUXT variant.stock.quantity N → halfCeil(N)
 * - Gutscheine / gift cards → 0 (reason gutschein)
 * - isSoldOut / !isProductBuyable / qty 0 → 0
 * - No numeric qty resolved → 0 (never invent)
 */
import { halfCeil } from "./halfCeil";

export type BwzStockParse = {
  sourceQty: number | null;
  isSoldOut: boolean;
  isBuyable: boolean;
  isGiftCard: boolean;
  hasPositiveProof: boolean;
  reason: string;
};

export type BwzPublishDecision = {
  sourceQty: number | null;
  proposedQty: number;
  reason: string;
  hasPositiveProof: boolean;
};

export function isBwzGiftCard(input: {
  productName?: string | null;
  productType?: string | null;
  slug?: string | null;
}): boolean {
  const blob = `${input.productName ?? ""} ${input.productType ?? ""} ${input.slug ?? ""}`.toLowerCase();
  return /gutschein|geschenkgutschein|giftcard|gift\s*card/.test(blob);
}

export function parseBwzStock(input: {
  quantity: number | null | undefined;
  isSoldOut?: boolean;
  isBuyable?: boolean;
  productName?: string | null;
  productType?: string | null;
  slug?: string | null;
}): BwzStockParse {
  const giftCard = isBwzGiftCard(input);
  if (giftCard) {
    return {
      sourceQty: null,
      isSoldOut: false,
      isBuyable: false,
      isGiftCard: true,
      hasPositiveProof: false,
      reason: "gutschein",
    };
  }
  if (input.isSoldOut === true) {
    return {
      sourceQty: 0,
      isSoldOut: true,
      isBuyable: false,
      isGiftCard: false,
      hasPositiveProof: false,
      reason: "isSoldOut",
    };
  }
  if (input.isBuyable === false) {
    return {
      sourceQty: input.quantity ?? null,
      isSoldOut: false,
      isBuyable: false,
      isGiftCard: false,
      hasPositiveProof: false,
      reason: "not_buyable",
    };
  }
  const q = input.quantity == null ? null : Math.max(0, Math.floor(Number(input.quantity)));
  if (q == null) {
    return {
      sourceQty: null,
      isSoldOut: false,
      isBuyable: true,
      isGiftCard: false,
      hasPositiveProof: false,
      reason: "no_nuxt_qty",
    };
  }
  if (q <= 0) {
    return {
      sourceQty: 0,
      isSoldOut: false,
      isBuyable: true,
      isGiftCard: false,
      hasPositiveProof: false,
      reason: "zero_qty",
    };
  }
  return {
    sourceQty: q,
    isSoldOut: false,
    isBuyable: true,
    isGiftCard: false,
    hasPositiveProof: true,
    reason: "nuxt_variant_stock_quantity",
  };
}

export function decideBwzPublishedQty(parse: BwzStockParse): BwzPublishDecision {
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
