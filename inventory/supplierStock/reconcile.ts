import { evaluateSupplierExclusion } from "./exclusions";
import {
  applyIdentityToObservation,
  detectPackSizeInflation,
  inferPackCount,
  isPokemonBoosterDisplayConflict,
} from "./match";
import {
  decidePublishedQuantity,
  notSeenInCompleteRunDecision,
} from "./quantity";
import type { ReconcileResult, VariantObservation } from "./types";

export function enrichObservation(
  obs: VariantObservation,
  db?: {
    gtin?: string | null;
    manufacturerRef?: string | null;
    supplierSku?: string | null;
    productUrl?: string | null;
    productName?: string | null;
    mappedTitle?: string | null;
    productType?: string | null;
  }
): VariantObservation {
  let enriched = { ...obs };

  const exclusion = evaluateSupplierExclusion({
    supplierKey: obs.supplierKey,
    productName: obs.productName,
    brand: db?.productType ?? null,
    extraText: db?.mappedTitle ?? null,
  });
  if (exclusion.excluded) {
    enriched = {
      ...enriched,
      excluded: true,
      exclusionReason: exclusion.reason,
      availabilityStatus: "manual_review_required",
    };
  }

  if (
    isPokemonBoosterDisplayConflict({
      title: obs.productName,
      mappedTitle: db?.mappedTitle,
      productType: db?.productType,
    })
  ) {
    enriched = {
      ...enriched,
      availabilityStatus: "variant_uncertain",
      rawParseJson: {
        ...(enriched.rawParseJson ?? {}),
        pokemonBoosterDisplayConflict: true,
      },
    };
  }

  const packCount = inferPackCount(obs.productName);
  if (packCount != null) {
    enriched.packCount = packCount;
  }

  if (db) {
    enriched = applyIdentityToObservation(enriched, db);
  }

  return enriched;
}

export function reconcileObservation(obs: VariantObservation): ReconcileResult {
  const qtyDecision = decidePublishedQuantity({
    availabilityStatus: obs.availabilityStatus,
    supplierStockQty: obs.supplierStockQty,
    packCount: obs.packCount,
    packInflation: obs.packInflation,
    excluded: obs.excluded,
  });

  let publishedQty = qtyDecision.publishedQty;
  let needsReview = qtyDecision.needsReview;
  let zeroReason = qtyDecision.zeroReason ?? null;

  const inflation = detectPackSizeInflation({
    internalQty: obs.supplierStockQty ?? 0,
    publishedQty,
    title: obs.productName,
  });
  if (inflation.inflated) {
    publishedQty = obs.supplierStockQty === 1 ? 1 : publishedQty;
    needsReview = true;
    zeroReason = zeroReason ?? "pack_size_inflation";
  }

  if (obs.identityMatchLevel === "uncertain") {
    needsReview = true;
  }

  return {
    publishedQty,
    zeroReason,
    needsReview,
    reviewReason: needsReview ? obs.exclusionReason ?? obs.availabilityStatus : null,
    availabilityStatus: obs.availabilityStatus,
  };
}

export function zeroMissingFromCompleteSnapshot(input: {
  seenVariantIds: Set<string>;
  catalogVariantIds: string[];
}): Array<{ supplierVariantId: string; publishedQty: number; zeroReason: string }> {
  const out: Array<{ supplierVariantId: string; publishedQty: number; zeroReason: string }> = [];
  const decision = notSeenInCompleteRunDecision();

  for (const id of input.catalogVariantIds) {
    if (input.seenVariantIds.has(id)) continue;
    out.push({
      supplierVariantId: id,
      publishedQty: decision.publishedQty,
      zeroReason: decision.zeroReason,
    });
  }

  return out;
}
