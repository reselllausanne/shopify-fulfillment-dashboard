import { GALAXUS_FEED_SUPPLIER_ALLOWLIST } from "@/galaxus/config";

const FEED_ELIGIBLE_MAPPING_STATUSES = ["MATCHED", "SUPPLIER_GTIN", "PARTNER_GTIN"] as const;

type TrmFeedExclusionReason =
  | "MISSING_GTIN"
  | "INVALID_GTIN"
  | "ENRICHMENT_PENDING"
  | "KICKDB_NOT_FOUND";

type TrmFeedExclusionStats = Record<TrmFeedExclusionReason, number>;

function normalizeSupplierKey(value: string): string {
  return value.trim().toLowerCase();
}

function buildSupplierIdFilter(keys: string[]) {
  const normalized = keys.map(normalizeSupplierKey).filter(Boolean);
  if (normalized.length === 0) return null;
  const or = normalized.flatMap((key) => [
    { supplierVariant: { supplierVariantId: { startsWith: `${key}:`, mode: "insensitive" } } },
    { supplierVariant: { supplierVariantId: { startsWith: `${key}_`, mode: "insensitive" } } },
  ]);
  return or.length > 0 ? { OR: or } : null;
}

export function buildFeedMappingsWhere(supplier?: string | null, includeTrmDiagnostics = true) {
  const normalizedSupplier = supplier ? normalizeSupplierKey(supplier) : "";
  const allowlistKeys = GALAXUS_FEED_SUPPLIER_ALLOWLIST.split(",")
    .map(normalizeSupplierKey)
    .filter(Boolean);
  const allowlistFilter = buildSupplierIdFilter(allowlistKeys);
  const supplierFilter = normalizedSupplier ? buildSupplierIdFilter([normalizedSupplier]) : null;
  const combinedSupplierFilter =
    allowlistFilter && supplierFilter
      ? { AND: [allowlistFilter, supplierFilter] }
      : allowlistFilter || supplierFilter;

  const eligibleWhere = {
    status: { in: FEED_ELIGIBLE_MAPPING_STATUSES as unknown as string[] },
    gtin: { not: null },
  };
  const statusFilter = includeTrmDiagnostics
    ? {
        OR: [
          eligibleWhere,
          { supplierVariant: { supplierVariantId: { startsWith: "trm:", mode: "insensitive" } } },
        ],
      }
    : eligibleWhere;

  if (combinedSupplierFilter) {
    return { AND: [combinedSupplierFilter, statusFilter] };
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

