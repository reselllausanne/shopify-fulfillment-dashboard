import { GALAXUS_FEED_SUPPLIER_ALLOWLIST, GALAXUS_FEED_SUPPLIER_BLOCKLIST } from "@/galaxus/config";

const FEED_ELIGIBLE_MAPPING_STATUSES = ["MATCHED", "SUPPLIER_GTIN", "PARTNER_GTIN"] as const;
const ENABLE_LEGACY_SUPPLIER_ID_FILTER = process.env.GALAXUS_FEED_LEGACY_SUPPLIER_ID_FILTER === "1";

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

/** Legacy join filter — kept for rows missing supplierKey backfill. */
function buildSupplierIdFilter(keys: string[]) {
  const normalized = keys.map(normalizeSupplierKey).filter(Boolean);
  if (normalized.length === 0) return null;
  const or = normalized.flatMap((key) => [
    { supplierVariant: { supplierVariantId: { startsWith: `${key}:`, mode: "insensitive" } } },
    { supplierVariant: { supplierVariantId: { startsWith: `${key}_`, mode: "insensitive" } } },
  ]);
  return or.length > 0 ? { OR: or } : null;
}

function buildSupplierScopeFilter(keys: string[]) {
  const byKey = buildSupplierKeyFilter(keys);
  if (!ENABLE_LEGACY_SUPPLIER_ID_FILTER) {
    return byKey;
  }
  const byId = buildSupplierIdFilter(keys);
  if (byKey && byId) {
    return { OR: [byKey, byId] };
  }
  return byKey || byId;
}

/** Excludes supplier id prefixes from Galaxus feed scope (NOT … OR …). */
function buildSupplierBlocklistFilter(keys: string[]) {
  const normalized = keys.map(normalizeSupplierKey).filter(Boolean);
  if (normalized.length === 0) return null;
  if (!ENABLE_LEGACY_SUPPLIER_ID_FILTER) {
    return { NOT: { supplierKey: { in: normalized } } };
  }
  const or = normalized.flatMap((key) => [
    { supplierKey: key },
    { supplierVariant: { supplierVariantId: { startsWith: `${key}:`, mode: "insensitive" } } },
    { supplierVariant: { supplierVariantId: { startsWith: `${key}_`, mode: "insensitive" } } },
  ]);
  return or.length > 0 ? { NOT: { OR: or } } : null;
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
        OR: [
          eligibleWhere,
          { supplierKey: "trm" },
          ...(ENABLE_LEGACY_SUPPLIER_ID_FILTER
            ? [{ supplierVariant: { supplierVariantId: { startsWith: "trm:", mode: "insensitive" } } }]
            : []),
        ],
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

