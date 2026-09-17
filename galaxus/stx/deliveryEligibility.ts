import { STX_MIN_ASKS_FOR_LISTING } from "@/galaxus/stx/stockPublish";
import type { SelectedStxOffer, StxDeliveryType } from "@/galaxus/stx/offerSelection";

/**
 * Separates delivery-lane choice from catalogue presence.
 *
 * - expressEligible: sellable via StockX express asks
 * - standardEligible: sellable via StockX standard asks
 * - catalogueEligible: at least one sellable lane (physical stock merged upstream)
 *
 * Express→Standard is a *lane* change, never a catalogue exclusion.
 */
export type StxDeliveryEligibility = {
  expressEligible: boolean;
  standardEligible: boolean;
  catalogueEligible: boolean;
  activeDeliveryType: StxDeliveryType | null;
  laneReason:
    | "express_preferred"
    | "express_over_standard_cap"
    | "standard_only"
    | "express_only"
    | "none";
};

function offerSellable(offer: SelectedStxOffer | null | undefined): offer is SelectedStxOffer {
  return Boolean(
    offer &&
      Number.isFinite(offer.price) &&
      offer.price > 0 &&
      Number.isFinite(offer.asks) &&
      offer.asks >= STX_MIN_ASKS_FOR_LISTING
  );
}

export function resolveStxDeliveryEligibility(input: {
  express: SelectedStxOffer | null;
  standard: SelectedStxOffer | null;
  /** True when express buy ≥ ratio × standard buy (price-cap rule). */
  preferStandardByPriceCap: boolean;
}): StxDeliveryEligibility {
  const expressEligible = offerSellable(input.express);
  const standardEligible = offerSellable(input.standard);
  const catalogueEligible = expressEligible || standardEligible;

  if (!catalogueEligible) {
    return {
      expressEligible,
      standardEligible,
      catalogueEligible: false,
      activeDeliveryType: null,
      laneReason: "none",
    };
  }

  if (expressEligible && !standardEligible) {
    return {
      expressEligible,
      standardEligible,
      catalogueEligible: true,
      activeDeliveryType: input.express!.deliveryType,
      laneReason: "express_only",
    };
  }

  if (!expressEligible && standardEligible) {
    return {
      expressEligible,
      standardEligible,
      catalogueEligible: true,
      activeDeliveryType: "standard",
      laneReason: "standard_only",
    };
  }

  // Both sellable — demote to standard only when price cap fires AND standard
  // remains sellable (asks ≥ 1). Never demote into an unsellable lane.
  if (input.preferStandardByPriceCap && standardEligible) {
    return {
      expressEligible,
      standardEligible,
      catalogueEligible: true,
      activeDeliveryType: "standard",
      laneReason: "express_over_standard_cap",
    };
  }

  return {
    expressEligible,
    standardEligible,
    catalogueEligible: true,
    activeDeliveryType: input.express!.deliveryType,
    laneReason: "express_preferred",
  };
}
