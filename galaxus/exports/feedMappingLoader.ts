import { prismaDirect } from "@/app/lib/prisma";
import { buildFeedMappingsWhere } from "@/galaxus/exports/trmExport";
import { accumulateBestCandidates, filterExportCandidates } from "@/galaxus/exports/gtinSelection";
import { PARTNER_KEY_SELECT, partnerKeysLowerSet } from "@/galaxus/exports/partnerPricing";
import {
  createTrmFeedExclusionStats,
  recordTrmFeedExclusion,
  type TrmFeedExclusionStats,
} from "@/galaxus/exports/trmExport";

export const FEED_EXPORT_PAGE_SIZE = 2000;

export const FEED_MAPPING_INCLUDE = {
  supplierVariant: {
    select: {
      supplierVariantId: true,
      supplierSku: true,
      providerKey: true,
      gtin: true,
      price: true,
      stock: true,
      sizeRaw: true,
      sizeNormalized: true,
      supplierBrand: true,
      supplierProductName: true,
      supplierGender: true,
      supplierColorway: true,
      weightGrams: true,
      images: true,
      hostedImageUrl: true,
      sourceImageUrl: true,
      manualPrice: true,
      manualStock: true,
      manualLock: true,
      deliveryType: true,
    },
  },
  kickdbVariant: {
    select: {
      id: true,
      product: {
        select: {
          name: true,
          brand: true,
          description: true,
          styleId: true,
          traitsJson: true,
        },
      },
    },
  },
} as const;

export type FeedExportCandidate = {
  mapping: any;
  variant: any;
  product: any;
  providerKey: string;
  gtin: string | null;
  sellPriceExVat: number;
};

export type FeedExportLoadResult = {
  exportCandidates: FeedExportCandidate[];
  trmExclusionStats: TrmFeedExclusionStats;
  exclusionStats: Record<string, number>;
  invalidSupplierVariantIds: string[];
};

export type MasterSpecsFeedLoadResult = {
  masterExportCandidates: FeedExportCandidate[];
  specsExportCandidates: FeedExportCandidate[];
  trmExclusionStats: TrmFeedExclusionStats;
  exclusionStats: Record<string, number>;
  invalidSupplierVariantIds: string[];
};

function dedupeCandidatesByProviderKey(candidates: any[]) {
  const seen = new Set<string>();
  const unique: any[] = [];
  for (const candidate of candidates) {
    const key = String(candidate?.providerKey ?? "");
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

export async function loadFeedExportCandidates(params: {
  supplier?: string | null;
  all?: boolean;
  limit?: number;
  offset?: number;
  providerKeys?: string[];
  requireImage?: boolean;
  includeTrmDiagnostics?: boolean;
}): Promise<FeedExportLoadResult> {
  const {
    supplier,
    all = true,
    limit = 100,
    offset = 0,
    providerKeys = [],
    requireImage = false,
    includeTrmDiagnostics = true,
  } = params;

  const mappingsWhere = buildFeedMappingsWhere(supplier, includeTrmDiagnostics);
  const providerKeyFilter = providerKeys.length > 0 ? { providerKey: { in: providerKeys } } : null;
  const pageSize = all ? FEED_EXPORT_PAGE_SIZE : Math.min(limit, 1000);
  let currentOffset = all ? 0 : offset;
  let lastBatch = 0;
  let cursorUpdatedAt: Date | null = null;
  let cursorId: string | null = null;
  const prismaAny = prismaDirect as any;
  const partners = await prismaAny.partner.findMany({ select: PARTNER_KEY_SELECT });
  const galaxusPartnerKeysLower = partnerKeysLowerSet(partners);
  const trmExclusionStats = createTrmFeedExclusionStats();
  const exclusionStats: Record<string, number> = {
    MISSING_GTIN: 0,
    INVALID_GTIN: 0,
    ENRICHMENT_PENDING: 0,
    KICKDB_NOT_FOUND: 0,
    MISSING_PRODUCT_NAME: 0,
    MISSING_IMAGE: 0,
    INVALID_PRICE: 0,
    INVALID_PROVIDER_KEY: 0,
  };

  const bestByGtin = new Map<string, any>();

  do {
    const baseWhere = {
      ...mappingsWhere,
      ...(providerKeyFilter ? providerKeyFilter : {}),
    };
    const whereClause =
      all && cursorUpdatedAt && cursorId
        ? {
            ...baseWhere,
            OR: [
              { updatedAt: { lt: cursorUpdatedAt } },
              { updatedAt: cursorUpdatedAt, id: { lt: cursorId } },
            ],
          }
        : baseWhere;

    const mappings = await prismaAny.variantMapping.findMany({
      where: whereClause,
      include: FEED_MAPPING_INCLUDE,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: pageSize,
      ...(all ? {} : { skip: currentOffset }),
    });

    lastBatch = mappings.length;
    if (all && mappings.length > 0) {
      const last: any = mappings[mappings.length - 1];
      cursorUpdatedAt = last.updatedAt ?? null;
      cursorId = last.id ?? null;
    }

    accumulateBestCandidates(mappings, bestByGtin, {
      keyBy: "gtin",
      requireProductName: false,
      requireImage,
      galaxusPartnerKeysLower,
      onExclude: (payload) => {
        const reason = String(payload?.reason ?? "UNKNOWN");
        if (reason in exclusionStats) {
          exclusionStats[reason] += 1;
        }
        if (payload.supplierKey === "trm") {
          recordTrmFeedExclusion(trmExclusionStats, payload.reason);
        }
      },
    });

    currentOffset += pageSize;
  } while (all && lastBatch === pageSize);

  const candidates = dedupeCandidatesByProviderKey(Array.from(bestByGtin.values()));
  const { valid: exportCandidates, invalidSupplierVariantIds } = filterExportCandidates(candidates);

  return {
    exportCandidates: exportCandidates as FeedExportCandidate[],
    trmExclusionStats,
    exclusionStats,
    invalidSupplierVariantIds,
  };
}

/**
 * One DB scan, two candidate sets — matches legacy separate master (requireImage)
 * and specs (no requireImage) exports without triple-scanning.
 */
export async function loadMasterAndSpecsExportCandidates(params: {
  supplier?: string | null;
  all?: boolean;
  limit?: number;
  offset?: number;
  providerKeys?: string[];
  includeTrmDiagnostics?: boolean;
}): Promise<MasterSpecsFeedLoadResult> {
  const {
    supplier,
    all = true,
    limit = 100,
    offset = 0,
    providerKeys = [],
    includeTrmDiagnostics = true,
  } = params;

  const mappingsWhere = buildFeedMappingsWhere(supplier, includeTrmDiagnostics);
  const providerKeyFilter = providerKeys.length > 0 ? { providerKey: { in: providerKeys } } : null;
  const pageSize = all ? FEED_EXPORT_PAGE_SIZE : Math.min(limit, 1000);
  let currentOffset = all ? 0 : offset;
  let lastBatch = 0;
  let cursorUpdatedAt: Date | null = null;
  let cursorId: string | null = null;
  const prismaAny = prismaDirect as any;
  const partners = await prismaAny.partner.findMany({ select: PARTNER_KEY_SELECT });
  const galaxusPartnerKeysLower = partnerKeysLowerSet(partners);
  const trmExclusionStats = createTrmFeedExclusionStats();
  const exclusionStats: Record<string, number> = {
    MISSING_GTIN: 0,
    INVALID_GTIN: 0,
    ENRICHMENT_PENDING: 0,
    KICKDB_NOT_FOUND: 0,
    MISSING_PRODUCT_NAME: 0,
    MISSING_IMAGE: 0,
    INVALID_PRICE: 0,
    INVALID_PROVIDER_KEY: 0,
  };

  const bestByGtinMaster = new Map<string, any>();
  const bestByGtinSpecs = new Map<string, any>();

  const recordExclude = (payload: { reason?: string; supplierKey?: string | null }) => {
    const reason = String(payload?.reason ?? "UNKNOWN");
    if (reason in exclusionStats) {
      exclusionStats[reason] += 1;
    }
    if (payload.supplierKey === "trm") {
      recordTrmFeedExclusion(trmExclusionStats, payload.reason);
    }
  };

  do {
    const baseWhere = {
      ...mappingsWhere,
      ...(providerKeyFilter ? providerKeyFilter : {}),
    };
    const whereClause =
      all && cursorUpdatedAt && cursorId
        ? {
            ...baseWhere,
            OR: [
              { updatedAt: { lt: cursorUpdatedAt } },
              { updatedAt: cursorUpdatedAt, id: { lt: cursorId } },
            ],
          }
        : baseWhere;

    const mappings = await prismaAny.variantMapping.findMany({
      where: whereClause,
      include: FEED_MAPPING_INCLUDE,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: pageSize,
      ...(all ? {} : { skip: currentOffset }),
    });

    lastBatch = mappings.length;
    if (all && mappings.length > 0) {
      const last: any = mappings[mappings.length - 1];
      cursorUpdatedAt = last.updatedAt ?? null;
      cursorId = last.id ?? null;
    }

    const accumulateOpts = {
      keyBy: "gtin" as const,
      requireProductName: false,
      galaxusPartnerKeysLower,
      onExclude: recordExclude,
    };

    accumulateBestCandidates(mappings, bestByGtinMaster, { ...accumulateOpts, requireImage: true });
    accumulateBestCandidates(mappings, bestByGtinSpecs, { ...accumulateOpts, requireImage: false });

    currentOffset += pageSize;
  } while (all && lastBatch === pageSize);

  const masterCandidates = dedupeCandidatesByProviderKey(Array.from(bestByGtinMaster.values()));
  const specsCandidates = dedupeCandidatesByProviderKey(Array.from(bestByGtinSpecs.values()));
  const masterFiltered = filterExportCandidates(masterCandidates);
  const specsFiltered = filterExportCandidates(specsCandidates);
  const invalidSupplierVariantIds = Array.from(
    new Set([...masterFiltered.invalidSupplierVariantIds, ...specsFiltered.invalidSupplierVariantIds])
  );

  return {
    masterExportCandidates: masterFiltered.valid as FeedExportCandidate[],
    specsExportCandidates: specsFiltered.valid as FeedExportCandidate[],
    trmExclusionStats,
    exclusionStats,
    invalidSupplierVariantIds,
  };
}
