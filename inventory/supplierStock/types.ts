/** Supplier stock reconciliation — shared types and scrape cadence constants. */

export type SupplierStockPolicyStatus =
  | "monitoring_only"
  | "review_required"
  | "approved"
  | "paused_due_to_scrape_failure"
  | "manually_paused";

export type AvailabilityStatus =
  | "confirmed_in_stock"
  | "confirmed_out_of_stock"
  | "preorder"
  | "backorder_or_supplier_order"
  | "not_found"
  | "page_unavailable"
  | "price_missing"
  | "variant_uncertain"
  | "scrape_error"
  | "stale"
  | "manual_review_required";

/** Explicit purchase/availability signal from the live supplier page (this scrape run). */
export type SourceAvailability =
  | "in_stock"
  | "out_of_stock"
  | "preorder"
  | "backorder"
  | "unavailable"
  | "unknown";

export type SnapshotCompleteness = "full" | "partial" | "unknown";

export type IdentityMatchLevel = "gtin" | "mpn" | "sku" | "url" | "title" | "uncertain";

/**
 * Structured proof payload emitted by a scraper for ONE variant during THIS run.
 * Historical `SupplierVariant.stock` must never be used as a substitute.
 */
export type SupplierVariantObservation = {
  supplierKey: string;
  supplierVariantId: string;
  /** Product page URL and/or exact variant URL — at least one required for fresh proof. */
  productUrl?: string | null;
  variantUrl?: string | null;
  /** Reliable source identity — at least one of gtin / manufacturerRef / supplierSku. */
  gtin?: string | null;
  manufacturerRef?: string | null;
  supplierSku?: string | null;
  productName?: string | null;
  /** Current source price from the page (not DB). */
  sourcePrice?: number | null;
  currency?: string | null;
  /**
   * Explicit buyability on the current page.
   * Examples: "add_to_cart", "schema_InStock", "stueck_an_lager", "sofort_verfuegbar".
   */
  purchaseSignal?: string | null;
  sourceAvailability: SourceAvailability;
  /** Exact numeric qty when known. */
  supplierStockQty?: number | null;
  /** True when page confirms sellable but hides qty → publish at most 1. */
  quantityUnknown?: boolean;
  sourceLeadTimeDays?: number | null;
  scrapeRunId: number;
  observedAt: Date | string;
  /** Reject invented defaultStock unless purchaseSignal is explicit. */
  usedDefaultStock?: boolean;
  shippingRule?: string | null;
  packCount?: number | null;
  rawParseJson?: Record<string, unknown> | null;
};

/** @deprecated Prefer SupplierVariantObservation — kept for internal enrich/reconcile. */
export type VariantObservation = {
  supplierKey: string;
  supplierVariantId: string;
  gtin?: string | null;
  supplierSku?: string | null;
  manufacturerRef?: string | null;
  productName?: string | null;
  productUrl?: string | null;
  variantUrl?: string | null;
  sourcePrice?: number | null;
  currency?: string | null;
  shippingRule?: string | null;
  sourceLeadTimeDays?: number | null;
  supplierStockQty?: number | null;
  quantityUnknown?: boolean;
  usedDefaultStock?: boolean;
  purchaseSignal?: string | null;
  sourceAvailability?: SourceAvailability | null;
  availabilityStatus: AvailabilityStatus;
  availabilitySignal?: string | null;
  quantitySource?: string | null;
  identityMatchLevel?: IdentityMatchLevel;
  confidenceScore?: number;
  excluded?: boolean;
  exclusionReason?: string | null;
  packCount?: number | null;
  packInflation?: boolean;
  rawParseJson?: Record<string, unknown> | null;
  sourceScrapeRunId?: number | null;
  observedAt?: Date | null;
  /** True only when observation came from live page payload this run. */
  hasFreshSourceEvidence?: boolean;
  zeroReason?: string | null;
};

export type ScrapeRunMetrics = {
  supplierKey: string;
  scrapeRunId: number;
  status: string;
  message?: string | null;
  productsListed: number;
  variantsUpserted: number;
  withGtin: number;
  errors: number;
  priorActiveCatalog: number;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  /**
   * Scraper-declared completeness. Only `"full"` may zero missing variants,
   * and only when other guards pass (success status, not partial, coverage ≥ threshold).
   */
  snapshotCompleteness?: SnapshotCompleteness;
  /** Why the run is not exhaustive (max limit, pagination stop, Cloudflare, …). */
  incompletenessReason?: string | null;
  /** Prior reliable full-snapshot product/variant count for coverage (not GTIN-only writes). */
  previousReliableSnapshotCount?: number | null;
  partialRun?: boolean;
};

export type RunValidityResult = {
  valid: boolean;
  invalidReason?: string;
  completeSnapshot: boolean;
  snapshotCompleteness: SnapshotCompleteness;
  incompletenessReason?: string | null;
  errorRate: number;
  coverageVsPrevious: number;
  flags: string[];
};

export type ReconcileResult = {
  publishedQty: number;
  zeroReason?: string | null;
  needsReview: boolean;
  reviewReason?: string | null;
  availabilityStatus: AvailabilityStatus;
};

/** Success statuses actually written by scrapers today. */
export const SCRAPE_SUCCESS_STATUSES = new Set(["ok", "completed"]);

/** Non-success / unfinished — must never reset consecutiveInvalidRuns. */
export const SCRAPE_NON_SUCCESS_STATUSES = new Set([
  "error",
  "failed",
  "running",
  "cancelled",
  "interrupted",
  "timeout",
]);

/** First invalid grace window for approved suppliers (keep last proof publishable). */
export const FIRST_INVALID_GRACE_MS = 24 * 60 * 60 * 1000;

/** Fresh proof max age for approved publish. */
export const PROOF_MAX_AGE_MS = 48 * 60 * 60 * 1000;

/** Default min coverage vs last reliable full snapshot to allow completeSnapshot. */
export const DEFAULT_FULL_SNAPSHOT_COVERAGE = 0.8;

export const ZERO_REASON_NO_FRESH_SOURCE = "NO_FRESH_SOURCE_EVIDENCE";
export const TEMPORARY_MONITORING_EXCEPTION = "TEMPORARY_MONITORING_EXCEPTION";

export const HEAVY_PLATFORMS = new Set([
  "exl",
  "rei",
  "wel",
  "wrk",
  "hhv",
  "snl",
  "bae",
  "fan",
  "haw",
  "bwz",
  "tus",
  "alt",
  "ven",
  "nso",
]);

export const SCRAPER_SUPPLIER_KEYS = new Set([
  "wel",
  "rei",
  "bae",
  "fan",
  "exl",
  "haw",
  "wrk",
  "bwz",
  "tus",
  "alt",
  "ven",
  "hhv",
  "snl",
  "nso",
]);

export const SCRAPE_INTERVAL_LIGHT_HOURS = 6;
export const SCRAPE_INTERVAL_HEAVY_HOURS = 24;

export function resolveScrapeIntervalHours(supplierKey: string, heavySource?: boolean): number {
  const key = String(supplierKey ?? "")
    .trim()
    .toLowerCase();
  if (heavySource || HEAVY_PLATFORMS.has(key)) return SCRAPE_INTERVAL_HEAVY_HOURS;
  return SCRAPE_INTERVAL_LIGHT_HOURS;
}

export function isScrapeSuccessStatus(status: string | null | undefined): boolean {
  return SCRAPE_SUCCESS_STATUSES.has(String(status ?? "")
    .trim()
    .toLowerCase());
}
