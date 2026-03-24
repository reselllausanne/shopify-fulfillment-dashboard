import type { DecathlonExclusionSummary, DecathlonExportCandidate, DecathlonExportFilePayload } from "./types";
import { parseDecimal, recordDecathlonExclusion } from "./mapping";
import { OFFERS_HEADERS } from "./templates";
import {
  computeDecathlonPriceFromBuyNow,
  DECATHLON_BUY_NOW_MULTIPLIER,
  DECATHLON_NER_BUY_NOW_MULTIPLIER,
  resolveDecathlonBuyNow,
} from "./pricing";

const DECATHLON_DEFAULT_OFFER_STATE = "11";

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
  const supplierVariantId = String(variant?.supplierVariantId ?? "");
  const isStx = supplierVariantId.startsWith("stx_") || candidate.providerKey.startsWith("STX_");
  const deliveryType = String(variant?.deliveryType ?? "");
  const stxEligible =
    isStx && deliveryType.startsWith("express_") && Number.isFinite(rawStock) && rawStock >= 2;
  return isStx ? (stxEligible ? 1 : 0) : rawStock;
}

function resolvePrice(candidate: DecathlonExportCandidate): string | null {
  const variant = candidate.variant ?? {};
  const manualLock = Boolean(variant?.manualLock);
  const manualPrice = parseDecimal(variant?.manualPrice);
  if (manualLock && manualPrice && manualPrice > 0) {
    return manualPrice.toFixed(2);
  }
  const buyNow = resolveDecathlonBuyNow({
    buyNowStockx: parseDecimal(variant?.price),
    manualOverride: manualPrice,
    manualLock,
  });
  if (!buyNow || buyNow <= 0) return null;
  const providerKey = String(candidate.providerKey ?? "");
  const supplierVariantId = String(variant?.supplierVariantId ?? "");
  const isNer =
    providerKey.toUpperCase().startsWith("NER_") ||
    supplierVariantId.toLowerCase().startsWith("ner_");
  const multiplier = isNer ? DECATHLON_NER_BUY_NOW_MULTIPLIER : DECATHLON_BUY_NOW_MULTIPLIER;
  const computed = computeDecathlonPriceFromBuyNow(buyNow, multiplier);
  if (!computed || computed <= 0) return null;
  return computed.toFixed(2);
}

export function buildOfferCsv(
  candidates: DecathlonExportCandidate[],
  summary: DecathlonExclusionSummary
): DecathlonExportFilePayload {
  const rows = [];

  for (const candidate of candidates) {
    const variant = candidate.variant ?? {};

    const price = resolvePrice(candidate);
    if (!price) {
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

    rows.push(row);
  }

  return { type: "offers", headers: OFFERS_HEADERS, rows };
}
