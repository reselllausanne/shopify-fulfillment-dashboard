import type { DecathlonExclusionSummary, DecathlonExportCandidate, DecathlonExportFilePayload } from "./types";
import { parseDecimal, recordDecathlonExclusion } from "./mapping";
import { OFFERS_HEADERS } from "./templates";
import {
  computeDecathlonOfferListPriceFromBuyNowForSupplier,
  decathlonOfferListPriceFromManualLockedPrice,
  isDecathlonStxListableBuy,
  readDecathlonStxMaxListPriceChf,
  resolveDecathlonBuyNow,
} from "./pricing";
import { classifyProductPricingKind, computeChannelVariantPrice } from "@/inventory/pricingPolicy";

const DECATHLON_DEFAULT_OFFER_STATE = "11";
const DECATHLON_MAX_OFFER_PRICE = 10000;

function createRow(): Record<string, string> {
  const row: Record<string, string> = {};
  for (const header of OFFERS_HEADERS) {
    row[header] = "";
  }
  return row;
}

function parseIntSafe(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveEffectiveStock(candidate: DecathlonExportCandidate): number | null {
  const variant = candidate.variant ?? {};
  const manualLock = Boolean(variant?.manualLock);
  const manualStock = parseIntSafe(variant?.manualStock);
  const baseStock = parseIntSafe(variant?.stock) ?? 0;
  const rawStock = manualLock && manualStock !== null ? manualStock : baseStock;
  const supplierKey = extractSupplierKey(candidate);
  if (supplierKey === "gld" || supplierKey === "trm") return 0;
  const supplierVariantId = String(variant?.supplierVariantId ?? "");
  const isStx = supplierVariantId.startsWith("stx_") || candidate.providerKey.startsWith("STX_");
  const deliveryType = String(variant?.deliveryType ?? "");
  const stxEligible =
    isStx && deliveryType.startsWith("express_") && Number.isFinite(rawStock) && rawStock >= 2;
  return isStx ? (stxEligible ? 1 : 0) : rawStock;
}

function resolvePrice(
  candidate: DecathlonExportCandidate,
  partnerKeysLower: Set<string>
): string | null {
  const applyPricingPolicy = (basePrice: number) => {
    const classification = classifyProductPricingKind({
      title: candidate?.product?.name ?? candidate?.variant?.supplierProductName ?? null,
      sizeRaw: candidate?.variant?.sizeRaw ?? null,
      sizeNormalized: candidate?.variant?.sizeNormalized ?? null,
      sizeEu: candidate?.kickdbVariant?.sizeEu ?? null,
      sizeUs: candidate?.kickdbVariant?.sizeUs ?? null,
    });
    const adjusted =
      computeChannelVariantPrice({
        channel: "DECATHLON",
        basePrice,
        classification,
      }) ?? basePrice;
    return adjusted.toFixed(2);
  };
  const variant = candidate.variant ?? {};
  const manualLock = Boolean(variant?.manualLock);
  const manualPrice = parseDecimal(variant?.manualPrice);
  const supplierKey = extractSupplierKey(candidate);
  const buyNow = resolveDecathlonBuyNow({
    buyNowStockx: parseDecimal(variant?.price),
    manualOverride: manualPrice,
    manualLock,
  });
  if (manualLock && manualPrice && manualPrice > 0) {
    return applyPricingPolicy(decathlonOfferListPriceFromManualLockedPrice(manualPrice));
  }
  if (!buyNow || buyNow <= 0) return null;
  if (supplierKey === "stx" && !isDecathlonStxListableBuy(buyNow)) return null;
  const base = computeDecathlonOfferListPriceFromBuyNowForSupplier(buyNow, supplierKey);
  if (!base || base <= 0) return null;
  return applyPricingPolicy(base);
}

function extractSupplierKey(candidate: DecathlonExportCandidate): string | null {
  const supplierVariantId = String(candidate?.variant?.supplierVariantId ?? "").trim();
  const providerKey = String(candidate?.providerKey ?? "").trim();
  const raw = supplierVariantId || providerKey;
  if (!raw) return null;
  const rawKey = raw.includes(":") ? raw.split(":")[0] : raw.includes("_") ? raw.split("_")[0] : raw;
  return rawKey ? rawKey.toLowerCase() : null;
}

export function resolveOfferLogisticClass(candidate: DecathlonExportCandidate): string {
  const variant = candidate.variant ?? {};
  const raw =
    variant?.logisticClass ??
    variant?.logistic_class ??
    variant?.logisticClassCode ??
    variant?.logistic_class_code ??
    variant?.logisticClassName ??
    variant?.logistic_class_name ??
    "";
  return String(raw ?? "").trim();
}

export function resolveOfferLeadTimeToShip(candidate: DecathlonExportCandidate): string {
  const supplierKey = extractSupplierKey(candidate);
  if (supplierKey === "the") return "2";
  const deliveryType = String(candidate?.variant?.deliveryType ?? "").toLowerCase();
  if (deliveryType.includes("expedited")) return "1";
  if (deliveryType.includes("express")) return "2";
  return "";
}

export function resolveOfferMinOrderQuantity(): "" {
  return "";
}

export function resolveOfferMaxOrderQuantity(): "" {
  return "";
}

export function resolveOfferDiscountPrice(): "" {
  return "";
}

export function resolveOfferDiscountStartDate(): "" {
  return "";
}

export function resolveOfferDiscountEndDate(): "" {
  return "";
}

export function resolveOfferDescription(): "" {
  return "";
}

export function buildOfferCsv(
  candidates: DecathlonExportCandidate[],
  summary: DecathlonExclusionSummary,
  partnerKeysLower: Set<string> = new Set()
): DecathlonExportFilePayload {
  const rows = [];

  for (const candidate of candidates) {
    const variant = candidate.variant ?? {};

    const price = resolvePrice(candidate, partnerKeysLower);
    if (!price) {
      const supplierKey = extractSupplierKey(candidate);
      const buyNow = resolveDecathlonBuyNow({
        buyNowStockx: parseDecimal(variant?.price),
        manualOverride: parseDecimal(variant?.manualPrice),
        manualLock: Boolean(variant?.manualLock),
      });
      if (supplierKey === "stx" && buyNow && buyNow > 0 && !isDecathlonStxListableBuy(buyNow)) {
        const maxSell = readDecathlonStxMaxListPriceChf();
        recordDecathlonExclusion(summary, {
          reason: "PRICE_TOO_HIGH",
          message: `STX complete buy ${buyNow.toFixed(2)} CHF exceeds safe max at ${maxSell} CHF sell tier`,
          fileType: "offers",
          providerKey: candidate.providerKey,
          supplierVariantId: variant?.supplierVariantId ?? null,
          gtin: candidate.gtin,
        });
        continue;
      }
      recordDecathlonExclusion(summary, {
        reason: "MISSING_PRICE",
        message: "Missing buy now price",
        fileType: "offers",
        providerKey: candidate.providerKey,
        supplierVariantId: variant?.supplierVariantId ?? null,
        gtin: candidate.gtin,
      });
      continue;
    }
    const priceValue = Number(price);
    if (Number.isFinite(priceValue) && priceValue > DECATHLON_MAX_OFFER_PRICE) {
      recordDecathlonExclusion(summary, {
        reason: "MISSING_PRICE",
        message: `Price exceeds ${DECATHLON_MAX_OFFER_PRICE}`,
        fileType: "offers",
        providerKey: candidate.providerKey,
        supplierVariantId: variant?.supplierVariantId ?? null,
        gtin: candidate.gtin,
      });
      continue;
    }
    const supplierKey = extractSupplierKey(candidate);
    const isStxOffer = supplierKey === "stx";
    if (isStxOffer && Number.isFinite(priceValue)) {
      const maxListPrice = readDecathlonStxMaxListPriceChf();
      if (priceValue > maxListPrice) {
        recordDecathlonExclusion(summary, {
          reason: "PRICE_TOO_HIGH",
          message: `STX list price ${priceValue.toFixed(2)} CHF exceeds max ${maxListPrice} CHF`,
          fileType: "offers",
          providerKey: candidate.providerKey,
          supplierVariantId: variant?.supplierVariantId ?? null,
          gtin: candidate.gtin,
        });
        continue;
      }
    }

    const effectiveStock = resolveEffectiveStock(candidate);
    if (effectiveStock === null || !Number.isFinite(effectiveStock) || effectiveStock <= 0) {
      recordDecathlonExclusion(summary, {
        reason: "MISSING_STOCK",
        message: "No exportable stock",
        fileType: "offers",
        providerKey: candidate.providerKey,
        supplierVariantId: variant?.supplierVariantId ?? null,
        gtin: candidate.gtin,
      });
      continue;
    }

    const row = createRow();
    row["sku"] = candidate.providerKey;
    row["product-id"] = candidate.gtin;
    row["product-id-type"] = "EAN";
    row["price"] = price;
    row["quantity"] = String(effectiveStock);
    row["state"] = DECATHLON_DEFAULT_OFFER_STATE;
    row["logistic-class"] = resolveOfferLogisticClass(candidate);
    row["leadtime-to-ship"] = resolveOfferLeadTimeToShip(candidate);
    row["min-order-quantity"] = resolveOfferMinOrderQuantity();
    row["max-order-quantity"] = resolveOfferMaxOrderQuantity();
    row["discount-price"] = resolveOfferDiscountPrice();
    row["discount-start-date"] = resolveOfferDiscountStartDate();
    row["discount-end-date"] = resolveOfferDiscountEndDate();
    row["description"] = resolveOfferDescription();

    rows.push(row);
  }

  return { type: "offers", headers: OFFERS_HEADERS, rows };
}
