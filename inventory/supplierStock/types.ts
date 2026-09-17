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

export type IdentityMatchLevel = "gtin" | "mpn" | "sku" | "url" | "title" | "uncertain";

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
};

export type RunValidityResult = {
  valid: boolean;
  invalidReason?: string;
  completeSnapshot: boolean;
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

export type PublishGateInput = {
  supplierVariantId: string;
  manualLock?: boolean | null;
  baseStock: number;
  policyStatus?: SupplierStockPolicyStatus | null;
  evidencePublishedQty?: number | null;
  lastProofAt?: Date | null;
  now?: Date;
};

/** Heavy catalog suppliers — longer scrape interval. */
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

export const SCRAPE_INTERVAL_LIGHT_HOURS = 6;
export const SCRAPE_INTERVAL_HEAVY_HOURS = 24;
export const SCRAPE_INTERVAL_DEFAULT_HOURS = SCRAPE_INTERVAL_HEAVY_HOURS;

export function resolveScrapeIntervalHours(supplierKey: string, heavySource?: boolean): number {
  const key = String(supplierKey ?? "").trim().toLowerCase();
  if (heavySource || HEAVY_PLATFORMS.has(key)) return SCRAPE_INTERVAL_HEAVY_HOURS;
  return SCRAPE_INTERVAL_LIGHT_HOURS;
}
