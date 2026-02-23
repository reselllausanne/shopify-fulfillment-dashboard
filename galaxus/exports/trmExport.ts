const FEED_ELIGIBLE_MAPPING_STATUSES = ["MATCHED", "SUPPLIER_GTIN", "PARTNER_GTIN"] as const;

type TrmFeedExclusionReason =
  | "MISSING_GTIN"
  | "INVALID_GTIN"
  | "ENRICHMENT_PENDING"
  | "KICKDB_NOT_FOUND";

type TrmFeedExclusionStats = Record<TrmFeedExclusionReason, number>;

export function buildFeedMappingsWhere(supplier?: string | null, includeTrmDiagnostics = true) {
  let normalizedSupplier = supplier ? supplier.trim().toLowerCase() : "";
  if (normalizedSupplier === "trm") {
    normalizedSupplier = "";
  }
  const whereSupplier = normalizedSupplier
    ? { supplierVariant: { supplierVariantId: { startsWith: `${normalizedSupplier}:` } } }
    : {};
  const eligibleWhere = {
    status: { in: FEED_ELIGIBLE_MAPPING_STATUSES as unknown as string[] },
    gtin: { not: null },
  };
  if (!includeTrmDiagnostics) {
    return {
      ...whereSupplier,
      ...eligibleWhere,
    };
  }
  return {
    ...whereSupplier,
    OR: [eligibleWhere, { supplierVariant: { supplierVariantId: { startsWith: "trm:" } } }],
  };
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

