/**
 * BWZ (baby-walz Scayle/Nuxt) publish qty proof.
 * - nuxtQty > 0 + inStock → halfCeil(N) capped at maxPublished (default 12)
 * - Gutschein / gift card → 0, excluded=true
 * - !inStock / missing qty → 0 (never invent defaultStock)
 */
import { halfCeilCapped } from "./halfCeil";

/** Align with decidePublishedQuantity maxPublished default. */
export const BWZ_MAX_PUBLISHED_QTY = 12;

export type BwzPublishInput = {
  nuxtQty: number | null | undefined;
  inStock: boolean;
  name?: string | null;
  productType?: string | null;
  url?: string | null;
  sku?: string | null;
  maxPublished?: number;
};

export type BwzPublishDecision = {
  sourceQty: number | null;
  proposedQty: number;
  reason: string;
  hasPositiveProof: boolean;
  excluded: boolean;
};

export function isBwzGiftCard(input: {
  name?: string | null;
  productType?: string | null;
  url?: string | null;
  sku?: string | null;
}): boolean {
  const blob = `${input.name ?? ""} ${input.productType ?? ""} ${input.url ?? ""} ${input.sku ?? ""}`.toLowerCase();
  return /gutschein|geschenkgutschein|giftcard|gift\s*card/.test(blob);
}

export function decideBwzPublishedQty(input: BwzPublishInput): BwzPublishDecision {
  if (isBwzGiftCard(input)) {
    return {
      sourceQty: input.nuxtQty ?? null,
      proposedQty: 0,
      reason: "gutschein",
      hasPositiveProof: false,
      excluded: true,
    };
  }
  if (!input.inStock) {
    return {
      sourceQty: 0,
      proposedQty: 0,
      reason: "not_in_stock",
      hasPositiveProof: false,
      excluded: false,
    };
  }
  const q =
    input.nuxtQty == null || !Number.isFinite(Number(input.nuxtQty))
      ? null
      : Math.max(0, Math.floor(Number(input.nuxtQty)));
  if (q == null) {
    return {
      sourceQty: null,
      proposedQty: 0,
      reason: "no_nuxt_qty",
      hasPositiveProof: false,
      excluded: false,
    };
  }
  if (q <= 0) {
    return {
      sourceQty: 0,
      proposedQty: 0,
      reason: "zero_qty",
      hasPositiveProof: false,
      excluded: false,
    };
  }
  const maxPublished = input.maxPublished ?? BWZ_MAX_PUBLISHED_QTY;
  const proposed = halfCeilCapped(q, maxPublished);
  return {
    sourceQty: q,
    proposedQty: proposed,
    reason: proposed < Math.ceil(q / 2) ? `halfCeilCapped:${q}->${proposed}` : `halfCeil:${q}`,
    hasPositiveProof: proposed > 0,
    excluded: false,
  };
}
