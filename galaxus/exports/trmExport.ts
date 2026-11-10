import { GALAXUS_FEED_SUPPLIER_ALLOWLIST, GALAXUS_FEED_SUPPLIER_BLOCKLIST } from "@/galaxus/config";

const FEED_ELIGIBLE_MAPPING_STATUSES = ["MATCHED", "SUPPLIER_GTIN", "PARTNER_GTIN"] as const;

type TrmFeedExclusionReason =
  | "MISSING_GTIN"
  | "INVALID_GTIN"
  | "ENRICHMENT_PENDING"
  | "KICKDB_NOT_FOUND";

export type TrmFeedExclusionStats = Record<TrmFeedExclusionReason, number>;

function normalizeSupplierKey(value: string): string {
  return value.trim().toLowerCase();
}

function buildSupplierKeyFilter(keys: string[]) {
  const normalized = keys.map(normalizeSupplierKey).filter(Boolean);
  if (normalized.length === 0) return null;
  return { supplierKey: { in: normalized } };
}

/**
 * Scope by `VariantMapping.supplierKey` only (indexed column, kept in sync by the
 * `trg_variant_mapping_supplier_key` trigger + Prisma extension).
 *
 * The old `GALAXUS_FEED_LEGACY_SUPPLIER_ID_FILTER=1` mode OR-ed in
 * `supplierVariant.supplierVariantId ILIKE 'key:%'` relation filters. Prisma compiles each
 * relation filter into its own LEFT JOIN, so every feed page became a 41-way self-join on
 * SupplierVariant (3.7 s/page mean, ~190 h cumulative). supplierKey is fully backfilled
 * (0 NULL / 0 mismatch in prod, Nov 2026), so the legacy path is removed for good.
 */
function buildSupplierScopeFilter(keys: string[]) {
  return buildSupplierKeyFilter(keys);
}

/** Excludes supplier keys from Galaxus feed scope. */
function buildSupplierBlocklistFilter(keys: string[]) {
  const normalized = keys.map(normalizeSupplierKey).filter(Boolean);
  if (normalized.length === 0) return null;
  return { NOT: { supplierKey: { in: normalized } } };
}

export function buildFeedMappingsWhere(supplier?: string | null, includeTrmDiagnostics = true) {
  const normalizedSupplier = supplier ? normalizeSupplierKey(supplier) : "";
  const allowlistKeys = GALAXUS_FEED_SUPPLIER_ALLOWLIST.split(",")
    .map(normalizeSupplierKey)
    .filter(Boolean);
  const allowlistFilter = buildSupplierScopeFilter(allowlistKeys);
  const supplierFilter = normalizedSupplier ? buildSupplierScopeFilter([normalizedSupplier]) : null;
  const combinedSupplierFilter =
    allowlistFilter && supplierFilter
      ? { AND: [allowlistFilter, supplierFilter] }
      : allowlistFilter || supplierFilter;

  const blocklistKeys = GALAXUS_FEED_SUPPLIER_BLOCKLIST.split(",")
    .map(normalizeSupplierKey)
    .filter(Boolean);
  const blocklistFilter = buildSupplierBlocklistFilter(blocklistKeys);
  const supplierScope =
    combinedSupplierFilter && blocklistFilter
      ? { AND: [combinedSupplierFilter, blocklistFilter] }
      : combinedSupplierFilter
        ? combinedSupplierFilter
        : blocklistFilter;

  const eligibleWhere = {
    status: { in: FEED_ELIGIBLE_MAPPING_STATUSES as unknown as string[] },
    gtin: { not: null },
  };
  const statusFilter = includeTrmDiagnostics
    ? {
        OR: [eligibleWhere, { supplierKey: "trm" }],
      }
    : eligibleWhere;

  if (supplierScope) {
    return { AND: [supplierScope, statusFilter] };
  }
  return statusFilter;
}

export function createTrmFeedExclusionStats(): TrmFeedExclusionStats {
  return {
    MISSING_GTIN: 0,
    INVALID_GTIN: 0,
    ENRICHMENT_PENDING: 0,
    KICKDB_NOT_FOUND: 0,
  };
}

export function recordTrmFeedExclusion(
  stats: TrmFeedExclusionStats,
  reason: string | null | undefined
) {
  if (!reason) return;
  if (reason === "MISSING_GTIN" || reason === "INVALID_GTIN" || reason === "ENRICHMENT_PENDING" || reason === "KICKDB_NOT_FOUND") {
    stats[reason] += 1;
  }
}

export function totalTrmFeedExclusions(stats: TrmFeedExclusionStats): number {
  return stats.MISSING_GTIN + stats.INVALID_GTIN + stats.ENRICHMENT_PENDING + stats.KICKDB_NOT_FOUND;
}

export function trmFeedExclusionsHeaderValue(stats: TrmFeedExclusionStats): string {
  return [
    `MISSING_GTIN=${stats.MISSING_GTIN}`,
    `INVALID_GTIN=${stats.INVALID_GTIN}`,
    `ENRICHMENT_PENDING=${stats.ENRICHMENT_PENDING}`,
    `KICKDB_NOT_FOUND=${stats.KICKDB_NOT_FOUND}`,
  ].join(";");
}

