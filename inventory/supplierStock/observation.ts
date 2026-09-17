/**
 * Fresh-source observation contract.
 * Never treat SupplierVariant.stock / updatedAt as proof.
 */

import type {
  AvailabilityStatus,
  SourceAvailability,
  SupplierVariantObservation,
  VariantObservation,
} from "./types";
import { ZERO_REASON_NO_FRESH_SOURCE } from "./types";

export type FreshEvidenceCheck = {
  ok: boolean;
  reason: string | null;
  availabilityStatus: AvailabilityStatus;
};

function hasUrl(obs: SupplierVariantObservation): boolean {
  return Boolean(String(obs.productUrl ?? "").trim() || String(obs.variantUrl ?? "").trim());
}

function hasIdentity(obs: SupplierVariantObservation): boolean {
  return Boolean(
    String(obs.gtin ?? "").trim() ||
      String(obs.manufacturerRef ?? "").trim() ||
      String(obs.supplierSku ?? "").trim()
  );
}

function mapSourceAvailability(src: SourceAvailability): AvailabilityStatus {
  switch (src) {
    case "in_stock":
      return "confirmed_in_stock";
    case "out_of_stock":
      return "confirmed_out_of_stock";
    case "preorder":
      return "preorder";
    case "backorder":
      return "backorder_or_supplier_order";
    case "unavailable":
      return "page_unavailable";
    default:
      return "variant_uncertain";
  }
}

/**
 * Validate that an observation is real page-level proof from this scrape run.
 * Rejects defaultStock-only, missing identity/URL/price/signal, and unknown availability.
 */
export function validateFreshSourceEvidence(obs: SupplierVariantObservation): FreshEvidenceCheck {
  if (!obs || !String(obs.supplierVariantId ?? "").trim()) {
    return {
      ok: false,
      reason: ZERO_REASON_NO_FRESH_SOURCE,
      availabilityStatus: "manual_review_required",
    };
  }
  if (!Number.isFinite(Number(obs.scrapeRunId)) || Number(obs.scrapeRunId) <= 0) {
    return {
      ok: false,
      reason: ZERO_REASON_NO_FRESH_SOURCE,
      availabilityStatus: "scrape_error",
    };
  }
  if (!obs.observedAt) {
    return {
      ok: false,
      reason: ZERO_REASON_NO_FRESH_SOURCE,
      availabilityStatus: "manual_review_required",
    };
  }
  if (!hasUrl(obs)) {
    return {
      ok: false,
      reason: ZERO_REASON_NO_FRESH_SOURCE,
      availabilityStatus: "manual_review_required",
    };
  }
  if (!hasIdentity(obs)) {
    return {
      ok: false,
      reason: "variant_uncertain",
      availabilityStatus: "variant_uncertain",
    };
  }

  const price = obs.sourcePrice;
  if (price == null || !Number.isFinite(Number(price)) || Number(price) <= 0) {
    return {
      ok: false,
      reason: "price_missing",
      availabilityStatus: "price_missing",
    };
  }

  const avail = obs.sourceAvailability ?? "unknown";
  if (avail === "unknown") {
    return {
      ok: false,
      reason: ZERO_REASON_NO_FRESH_SOURCE,
      availabilityStatus: "variant_uncertain",
    };
  }

  if (avail === "preorder" || avail === "backorder" || avail === "unavailable" || avail === "out_of_stock") {
    return {
      ok: true,
      reason: null,
      availabilityStatus: mapSourceAvailability(avail),
    };
  }

  // in_stock requires an explicit purchase signal; defaultStock alone is never enough.
  const signal = String(obs.purchaseSignal ?? "").trim();
  if (!signal) {
    return {
      ok: false,
      reason: ZERO_REASON_NO_FRESH_SOURCE,
      availabilityStatus: "manual_review_required",
    };
  }
  if (obs.usedDefaultStock && !signal) {
    return {
      ok: false,
      reason: ZERO_REASON_NO_FRESH_SOURCE,
      availabilityStatus: "manual_review_required",
    };
  }
  // defaultStock with a weak/empty signal already caught; with signal still flag quantityUnknown path.
  if (obs.usedDefaultStock) {
    return {
      ok: false,
      reason: "default_stock_not_allowed_as_proof",
      availabilityStatus: "manual_review_required",
    };
  }

  return {
    ok: true,
    reason: null,
    availabilityStatus: "confirmed_in_stock",
  };
}

/** Convert scraper contract → internal VariantObservation used by reconcile. */
export function observationFromSourcePayload(
  obs: SupplierVariantObservation
): VariantObservation {
  const check = validateFreshSourceEvidence(obs);
  const qty =
    obs.quantityUnknown || obs.supplierStockQty == null
      ? null
      : Math.max(0, Math.floor(Number(obs.supplierStockQty) || 0));

  return {
    supplierKey: String(obs.supplierKey).trim().toLowerCase(),
    supplierVariantId: String(obs.supplierVariantId).trim(),
    gtin: obs.gtin,
    manufacturerRef: obs.manufacturerRef,
    supplierSku: obs.supplierSku,
    productName: obs.productName,
    productUrl: obs.productUrl,
    variantUrl: obs.variantUrl,
    sourcePrice: obs.sourcePrice,
    currency: obs.currency,
    shippingRule: obs.shippingRule,
    sourceLeadTimeDays: obs.sourceLeadTimeDays,
    supplierStockQty: qty,
    quantityUnknown: Boolean(obs.quantityUnknown) || qty == null,
    usedDefaultStock: Boolean(obs.usedDefaultStock),
    purchaseSignal: obs.purchaseSignal,
    sourceAvailability: obs.sourceAvailability,
    availabilityStatus: check.availabilityStatus,
    availabilitySignal: obs.purchaseSignal ?? null,
    quantitySource: check.ok
      ? obs.quantityUnknown
        ? "availability_only"
        : "numeric_stock"
      : "forced_zero",
    packCount: obs.packCount,
    rawParseJson: obs.rawParseJson,
    sourceScrapeRunId: obs.scrapeRunId,
    observedAt: obs.observedAt instanceof Date ? obs.observedAt : new Date(obs.observedAt),
    hasFreshSourceEvidence: check.ok,
    zeroReason: check.ok ? null : check.reason,
  };
}

/**
 * Historical DB row alone — never a fresh proof.
 * Used only for diagnostics / review queue context.
 */
export function historicalDbIsNotProof(): VariantObservation {
  return {
    supplierKey: "",
    supplierVariantId: "",
    availabilityStatus: "manual_review_required",
    hasFreshSourceEvidence: false,
    zeroReason: ZERO_REASON_NO_FRESH_SOURCE,
    quantitySource: "forced_zero",
  };
}

export function assertNeverUsesDbStockAsProof(quantitySource: string | null | undefined): boolean {
  const src = String(quantitySource ?? "");
  return src !== "supplier_variant_stock" && src !== "historical_db";
}
