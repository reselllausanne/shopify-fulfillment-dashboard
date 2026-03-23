import type { DecathlonExclusionSummary, DecathlonExportCandidate, DecathlonExportFilePayload } from "./types";
import { computeDecathlonSellPrice, parseDecimal, recordDecathlonExclusion } from "./mapping";
import { PRICES_HEADERS } from "./templates";

function createRow(): Record<string, string> {
  const row: Record<string, string> = {};
  for (const header of PRICES_HEADERS) {
    row[header] = "";
  }
  return row;
}

export function buildPriceCsv(
  candidates: DecathlonExportCandidate[],
  summary: DecathlonExclusionSummary
): DecathlonExportFilePayload {
  const rows = [];

  for (const candidate of candidates) {
    const variant = candidate.variant ?? {};
    const manualLock = Boolean(variant?.manualLock);
    const manualPrice = parseDecimal(variant?.manualPrice);
    const basePrice = parseDecimal(variant?.price);
    const buyPrice = manualLock && manualPrice && manualPrice > 0 ? manualPrice : basePrice;
    if (!buyPrice || buyPrice <= 0) {
      recordDecathlonExclusion(summary, {
        reason: "MISSING_PRICE",
        message: "Missing price",
        fileType: "prices",
        providerKey: candidate.providerKey,
        supplierVariantId: variant?.supplierVariantId ?? null,
        gtin: candidate.gtin,
      });
      continue;
    }
    const computed = computeDecathlonSellPrice({ buyPrice });
    if (!computed.withVat || computed.withVat <= 0) {
      recordDecathlonExclusion(summary, {
        reason: "MISSING_PRICE",
        message: "Computed price invalid",
        fileType: "prices",
        providerKey: candidate.providerKey,
        supplierVariantId: variant?.supplierVariantId ?? null,
        gtin: candidate.gtin,
      });
      continue;
    }

    const row = createRow();
    row["SKU Offre"] = candidate.providerKey;
    row["Prix offre"] = computed.withVat.toFixed(2);
    rows.push(row);
  }

  return { type: "prices", headers: PRICES_HEADERS, rows };
}
