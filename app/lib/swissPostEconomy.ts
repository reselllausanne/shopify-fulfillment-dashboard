/**
 * Swiss Post PostPac Economy domestic list prices, incl. VAT, from 2026-01-01.
 * Source: https://www.post.ch/en/sending-parcels/domestic-parcels/postpac-economy
 *
 * Standard (fits 100×60×60 cm):
 *   ≤2 kg  CHF 9
 *   ≤10 kg CHF 12
 *   ≤30 kg CHF 21
 * Bulky (over those dims, still within Post bulky limits): CHF 31
 * Over 30 kg: not PostPac — caller must not invent a rate.
 */

export const POSTPAC_ECONOMY_UP_TO_2KG_CHF = 9;
export const POSTPAC_ECONOMY_UP_TO_10KG_CHF = 12;
export const POSTPAC_ECONOMY_UP_TO_30KG_CHF = 21;
export const POSTPAC_ECONOMY_BULKY_CHF = 31;
export const POSTPAC_ECONOMY_MAX_KG = 30;

export type PostPacEconomyQuote = {
  shippingChf: number | null;
  reason: string;
  shippable: boolean;
};

export function quotePostPacEconomy(input: {
  weightKg: number | null;
  bulky?: boolean;
}): PostPacEconomyQuote {
  const weight = input.weightKg;
  if (weight != null && (!Number.isFinite(weight) || weight <= 0)) {
    return { shippingChf: null, reason: "weight_invalid", shippable: false };
  }
  if (weight != null && weight > POSTPAC_ECONOMY_MAX_KG) {
    return { shippingChf: null, reason: "over_30kg_not_postpac", shippable: false };
  }
  if (input.bulky) {
    return {
      shippingChf: POSTPAC_ECONOMY_BULKY_CHF,
      reason: "postpac_economy_bulky_31",
      shippable: true,
    };
  }
  if (weight == null) {
    return {
      shippingChf: null,
      reason: "weight_unknown",
      shippable: false,
    };
  }
  if (weight <= 2) {
    return {
      shippingChf: POSTPAC_ECONOMY_UP_TO_2KG_CHF,
      reason: "postpac_economy_le_2kg",
      shippable: true,
    };
  }
  if (weight <= 10) {
    return {
      shippingChf: POSTPAC_ECONOMY_UP_TO_10KG_CHF,
      reason: "postpac_economy_le_10kg",
      shippable: true,
    };
  }
  return {
    shippingChf: POSTPAC_ECONOMY_UP_TO_30KG_CHF,
    reason: "postpac_economy_le_30kg",
    shippable: true,
  };
}
