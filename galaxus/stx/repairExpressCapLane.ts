import { resolveStxDeliveryEligibility } from "@/galaxus/stx/deliveryEligibility";
import {
  selectStxActiveOffer,
  selectStxStandardOffer,
  type StxDeliveryType,
} from "@/galaxus/stx/offerSelection";
import {
  buildStxDualPriceFields,
  readStxExpressOverStandardMaxRatio,
  shouldPreferStandardOverExpress,
  type StxDualPriceFields,
} from "@/galaxus/stx/variantPriceLanes";

export type StxCapRepairBucket =
  | "repaired_standard_to_express"
  | "repaired_express_to_standard"
  | "repaired_stock_restored_standard"
  | "repaired_stock_restored_express"
  | "unchanged_ok"
  | "true_oos_source_asks_zero"
  | "missing_source"
  | "lane_error_unresolved";

export type StxCapRepairCurrent = {
  supplierVariantId: string;
  providerKey?: string | null;
  deliveryType: string | null;
  stock: number;
  price: number | null;
  expressBuyPrice: number | null;
  standardBuyPrice: number | null;
};

export type StxCapRepairDecision = {
  bucket: StxCapRepairBucket;
  current: StxCapRepairCurrent;
  next: StxDualPriceFields | null;
  detail: string;
  sourceExpressAsks: number | null;
  sourceStandardAsks: number | null;
};

function asksOf(prices: unknown, lane: "express" | "standard"): number | null {
  const offer =
    lane === "express" ? selectStxActiveOffer(prices) : selectStxStandardOffer(prices);
  if (!offer) return null;
  return Number.isFinite(offer.asks) ? offer.asks : null;
}

export function isStxHistoricalCapAffected(
  current: Pick<StxCapRepairCurrent, "expressBuyPrice" | "standardBuyPrice">,
  ratio: number = readStxExpressOverStandardMaxRatio()
): boolean {
  const exp = Number(current.expressBuyPrice);
  const std = Number(current.standardBuyPrice);
  if (!(exp > 0) || !(std > 0)) return false;
  return exp >= std * ratio;
}

export function repairStxCapLaneFromSource(input: {
  current: StxCapRepairCurrent;
  sourcePrices: unknown | null | undefined;
  productPayload?: unknown;
  productName?: string | null;
  ratio?: number;
}): StxCapRepairDecision {
  const { current } = input;
  const ratio = input.ratio ?? readStxExpressOverStandardMaxRatio();

  if (input.sourcePrices == null) {
    return {
      bucket: "missing_source",
      current,
      next: null,
      detail: "no KickDB/StockX prices — cannot classify OOS",
      sourceExpressAsks: null,
      sourceStandardAsks: null,
    };
  }

  const express = selectStxActiveOffer(input.sourcePrices);
  const standard = selectStxStandardOffer(input.sourcePrices);
  const sourceExpressAsks = asksOf(input.sourcePrices, "express");
  const sourceStandardAsks = asksOf(input.sourcePrices, "standard");

  const fields = buildStxDualPriceFields(
    { prices: input.sourcePrices },
    input.productPayload ?? null,
    input.productName ?? null
  );

  if (!fields) {
    const eligibility = resolveStxDeliveryEligibility({
      express,
      standard,
      preferStandardByPriceCap: shouldPreferStandardOverExpress(null, null, ratio),
    });
    if (!eligibility.catalogueEligible) {
      return {
        bucket: "true_oos_source_asks_zero",
        current,
        next: null,
        detail: `source asks express=${sourceExpressAsks ?? 0} standard=${sourceStandardAsks ?? 0}`,
        sourceExpressAsks,
        sourceStandardAsks,
      };
    }
    return {
      bucket: "lane_error_unresolved",
      current,
      next: null,
      detail: "eligibility catalogueEligible but buildStxDualPriceFields returned null",
      sourceExpressAsks,
      sourceStandardAsks,
    };
  }

  const prevType = String(current.deliveryType ?? "").trim();
  const prevStock = Number(current.stock) || 0;
  const nextType = fields.deliveryType;
  const nextStock = fields.stock;
  const stockRestored = prevStock <= 0 && nextStock > 0;

  let bucket: StxCapRepairBucket = "unchanged_ok";
  if (prevType === "standard" && nextType.startsWith("express")) {
    bucket = "repaired_standard_to_express";
  } else if (prevType.startsWith("express") && nextType === "standard") {
    bucket = "repaired_express_to_standard";
  } else if (stockRestored && nextType === "standard") {
    bucket = "repaired_stock_restored_standard";
  } else if (stockRestored && nextType.startsWith("express")) {
    bucket = "repaired_stock_restored_express";
  } else if (prevType === "standard" && nextType === "standard" && nextStock > prevStock) {
    bucket = "repaired_stock_restored_standard";
  }

  return {
    bucket,
    current,
    next: fields,
    detail: `${prevType}@${prevStock} → ${nextType}@${nextStock} (${fields.laneReason})`,
    sourceExpressAsks,
    sourceStandardAsks,
  };
}

export function isStxCapRepairActionable(bucket: StxCapRepairBucket): boolean {
  return (
    bucket === "repaired_standard_to_express" ||
    bucket === "repaired_express_to_standard" ||
    bucket === "repaired_stock_restored_standard" ||
    bucket === "repaired_stock_restored_express"
  );
}

export type StxCapRepairApplyFields = {
  price: number;
  stock: number;
  deliveryType: StxDeliveryType;
  suggestedRetailPriceInclVat: number | null;
  standardBuyPrice: number | null;
  expressBuyPrice: number | null;
  standardSuggestedRetailPriceInclVat: number | null;
};

export function toStxCapRepairApplyFields(fields: StxDualPriceFields): StxCapRepairApplyFields {
  return {
    price: fields.price,
    stock: fields.stock,
    deliveryType: fields.deliveryType,
    suggestedRetailPriceInclVat: fields.suggestedRetailPriceInclVat,
    standardBuyPrice: fields.standardBuyPrice,
    expressBuyPrice: fields.expressBuyPrice,
    standardSuggestedRetailPriceInclVat: fields.standardSuggestedRetailPriceInclVat,
  };
}
