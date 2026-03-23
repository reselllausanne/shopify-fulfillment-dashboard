import type { DecathlonExclusionSummary, DecathlonExportCandidate, DecathlonExportFilePayload } from "./types";
import { computeDecathlonSellPrice, parseDecimal, recordDecathlonExclusion } from "./mapping";
import { OFFERS_HEADERS } from "./templates";

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
  const basePrice = parseDecimal(variant?.price);
  const buyPrice = manualLock && manualPrice && manualPrice > 0 ? manualPrice : basePrice;
  if (!buyPrice || buyPrice <= 0) return null;
  const computed = computeDecathlonSellPrice({ buyPrice });
  if (!computed.withVat || computed.withVat <= 0) return null;
  return computed.withVat.toFixed(2);
}

export function buildOfferCsv(
  candidates: DecathlonExportCandidate[],
  summary: DecathlonExclusionSummary
): DecathlonExportFilePayload {
  const rows = [];

  for (const candidate of candidates) {
    const variant = candidate.variant ?? {};
    const product = candidate.product ?? {};
    const supplierSku = String(variant?.supplierSku ?? "").trim();
    if (!supplierSku) {
      recordDecathlonExclusion(summary, {
        reason: "MISSING_OFFER_FIELDS",
        message: "Missing supplier SKU",
        fileType: "offers",
        providerKey: candidate.providerKey,
        supplierVariantId: variant?.supplierVariantId ?? null,
        gtin: candidate.gtin,
      });
      continue;
    }

    const price = resolvePrice(candidate);
    if (!price) {
      recordDecathlonExclusion(summary, {
        reason: "MISSING_PRICE",
        message: "Missing offer price",
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

    const productName = String(variant?.supplierProductName ?? product?.name ?? "").trim();
    const leadTimeDays = parseIntSafe(variant?.leadTimeDays);

    const row = createRow();
    row["SKU Offre"] = candidate.providerKey;
    row["ID Produit"] = candidate.providerKey;
    row["Description Offre"] = productName;
    row["Prix Offre"] = price;
    row["Quantité Offre"] = String(effectiveStock);
    row["Etat Offre"] = "ACTIVE";
    row["Délai d'expédition (en jours)"] = leadTimeDays !== null ? String(leadTimeDays) : "";
    row["Update/Delete"] = "UPDATE";

    rows.push(row);
  }

  return { type: "offers", headers: OFFERS_HEADERS, rows };
}
