/**
 * BWZ (baby-walz Scayle/Nuxt) publish qty proof.
 * - nuxtQty > 0 + inStock → halfCeil(N)
 * - Gutschein / gift card → 0, excluded=true
 * - !inStock / missing → 0
 */
import { halfCeil } from "./halfCeil";

export type BwzPublishInput = {
  nuxtQty: number | null | undefined;
  inStock: boolean;
  name?: string | null;
  productType?: string | null;
  url?: string | null;
  sku?: string | null;
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
  const proposed = halfCeil(q);
  return {
    sourceQty: q,
    proposedQty: proposed,
    reason: `halfCeil:${q}`,
    hasPositiveProof: proposed > 0,
    excluded: false,
  };
}
