import type { DecathlonExclusionSummary, DecathlonExportCandidate, DecathlonExportFilePayload } from "./types";
import { recordDecathlonExclusion } from "./mapping";
import { STOCK_HEADERS } from "./templates";

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

export function buildStockCsv(
  candidates: DecathlonExportCandidate[],
  summary: DecathlonExclusionSummary
): DecathlonExportFilePayload {
  const rows = [];

  for (const candidate of candidates) {
    const variant = candidate.variant ?? {};
    const effectiveStock = resolveEffectiveStock(candidate);
    if (effectiveStock === null || !Number.isFinite(effectiveStock) || effectiveStock <= 0) {
      recordDecathlonExclusion(summary, {
        reason: "MISSING_STOCK",
        message: "No exportable stock",
        fileType: "stock",
        providerKey: candidate.providerKey,
        supplierVariantId: variant?.supplierVariantId ?? null,
        gtin: candidate.gtin,
      });
      continue;
    }

    rows.push({
      "SKU offre": candidate.providerKey,
      "Quantité de l'offre": String(effectiveStock),
      "Code entrepôt": "",
      "Mettre à jour/Supprimer": "UPDATE",
    });
  }

  return { type: "stock", headers: STOCK_HEADERS, rows };
}
