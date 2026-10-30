import { prismaDirect } from "@/app/lib/prisma";
import { buildFeedMappingsWhere } from "@/galaxus/exports/trmExport";
import {
  accumulateBestCandidates,
  accumulateSlimGtinWinners,
  filterExportCandidates,
  type SlimGtinWinner,
} from "@/galaxus/exports/gtinSelection";
import { PARTNER_KEY_SELECT, partnerKeysLowerSet } from "@/galaxus/exports/partnerPricing";
import {
  createTrmFeedExclusionStats,
  recordTrmFeedExclusion,
  type TrmFeedExclusionStats,
} from "@/galaxus/exports/trmExport";

export const FEED_EXPORT_PAGE_SIZE = 5000;

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
      supplierProductType: true,
      supplierGender: true,
      supplierColorway: true,
      weightGrams: true,
      images: true,
      hostedImageUrl: true,
      sourceImageUrl: true,
      imageSyncStatus: true,
      manualPrice: true,
      manualStock: true,
      manualLock: true,
      manualNote: true,
      deliveryType: true,
    },
  },
  kickdbVariant: {
    select: {
      id: true,
      product: {
        select: {
          id: true,
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

/** Pass-1 slim scan: score fields only — no KickDB description/traits/rawJson. */
export const FEED_MAPPING_SLIM_SELECT = {
  id: true,
  gtin: true,
  providerKey: true,
  supplierKey: true,
  supplierVariantId: true,
  updatedAt: true,
  supplierVariant: {
    select: {
      supplierVariantId: true,
      providerKey: true,
      gtin: true,
      price: true,
      stock: true,
      sizeRaw: true,
      supplierBrand: true,
      supplierProductName: true,
      images: true,
      hostedImageUrl: true,
      sourceImageUrl: true,
      imageSyncStatus: true,
      manualNote: true,
      deliveryType: true,
      updatedAt: true,
    },
  },
  kickdbVariant: {
    select: {
      product: {
        select: {
          name: true,
          brand: true,
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
      all && cursorId
        ? {
            ...baseWhere,
            id: { lt: cursorId },
          }
        : baseWhere;

    const mappings = await prismaAny.variantMapping.findMany({
      where: whereClause,
      include: FEED_MAPPING_INCLUDE,
      orderBy: [{ id: "desc" }],
      take: pageSize,
      ...(all ? {} : { skip: currentOffset }),
    });

    lastBatch = mappings.length;
    if (all && mappings.length > 0) {
      const last: any = mappings[mappings.length - 1];
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

  const scanStarted = Date.now();
  let pages = 0;
  let mappingsScanned = 0;
  do {
    const baseWhere = {
      ...mappingsWhere,
      ...(providerKeyFilter ? providerKeyFilter : {}),
    };
    const whereClause =
      all && cursorId
        ? {
            ...baseWhere,
            id: { lt: cursorId },
          }
        : baseWhere;

    const mappings = await prismaAny.variantMapping.findMany({
      where: whereClause,
      include: FEED_MAPPING_INCLUDE,
      orderBy: [{ id: "desc" }],
      take: pageSize,
      ...(all ? {} : { skip: currentOffset }),
    });

    lastBatch = mappings.length;
    pages += 1;
    mappingsScanned += lastBatch;
    if (all && mappings.length > 0) {
      const last: any = mappings[mappings.length - 1];
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

    if (pages % 10 === 0 || lastBatch < pageSize) {
      console.info("[GALAXUS][MASTER] mapping scan progress", {
        pages,
        mappingsScanned,
        masterGtins: bestByGtinMaster.size,
        specsGtins: bestByGtinSpecs.size,
        ms: Date.now() - scanStarted,
      });
    }

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

export type SlimMasterSpecsWinners = {
  masterByGtin: Map<string, SlimGtinWinner>;
  specsByGtin: Map<string, SlimGtinWinner>;
  trmExclusionStats: TrmFeedExclusionStats;
  exclusionStats: Record<string, number>;
  pages: number;
  mappingsScanned: number;
  ms: number;
};

/**
 * Phase-2 pass 1: cursor scan with slim selects. Keeps only mappingId + score per GTIN
 * (master requireImage + specs without). Never holds full-catalog candidate graphs.
 */
export async function scanSlimMasterSpecsWinners(params: {
  supplier?: string | null;
  providerKeys?: string[];
  includeTrmDiagnostics?: boolean;
}): Promise<SlimMasterSpecsWinners> {
  const {
    supplier,
    providerKeys = [],
    includeTrmDiagnostics = false,
  } = params;

  const mappingsWhere = buildFeedMappingsWhere(supplier, includeTrmDiagnostics);
  const providerKeyFilter = providerKeys.length > 0 ? { providerKey: { in: providerKeys } } : null;
  const pageSize = FEED_EXPORT_PAGE_SIZE;
  let lastBatch = 0;
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

  const masterByGtin = new Map<string, SlimGtinWinner>();
  const specsByGtin = new Map<string, SlimGtinWinner>();

  const recordExclude = (payload: { reason?: string; supplierKey?: string | null }) => {
    const reason = String(payload?.reason ?? "UNKNOWN");
    if (reason in exclusionStats) {
      exclusionStats[reason] += 1;
    }
    if (payload.supplierKey === "trm") {
      recordTrmFeedExclusion(trmExclusionStats, payload.reason);
    }
  };

  const scanStarted = Date.now();
  let pages = 0;
  let mappingsScanned = 0;
  do {
    const baseWhere = {
      ...mappingsWhere,
      ...(providerKeyFilter ? providerKeyFilter : {}),
    };
    const whereClause =
      cursorId
        ? {
            ...baseWhere,
            id: { lt: cursorId },
          }
        : baseWhere;

    const mappings = await prismaAny.variantMapping.findMany({
      where: whereClause,
      select: FEED_MAPPING_SLIM_SELECT,
      orderBy: [{ id: "desc" }],
      take: pageSize,
    });

    lastBatch = mappings.length;
    pages += 1;
    mappingsScanned += lastBatch;
    if (mappings.length > 0) {
      const last: any = mappings[mappings.length - 1];
      cursorId = last.id ?? null;
    }

    const accumulateOpts = {
      keyBy: "gtin" as const,
      requireProductName: false,
      galaxusPartnerKeysLower,
      onExclude: recordExclude,
    };

    accumulateSlimGtinWinners(mappings, masterByGtin, { ...accumulateOpts, requireImage: true });
    accumulateSlimGtinWinners(mappings, specsByGtin, { ...accumulateOpts, requireImage: false });

    if (pages % 10 === 0 || lastBatch < pageSize) {
      const heap = process.memoryUsage();
      console.info("[GALAXUS][MASTER][SLIM] mapping scan progress", {
        pages,
        mappingsScanned,
        masterGtins: masterByGtin.size,
        specsGtins: specsByGtin.size,
        heapMb: Math.round(heap.heapUsed / 1024 / 1024),
        rssMb: Math.round(heap.rss / 1024 / 1024),
        ms: Date.now() - scanStarted,
      });
    }
  } while (lastBatch === pageSize);

  return {
    masterByGtin,
    specsByGtin,
    trmExclusionStats,
    exclusionStats,
    pages,
    mappingsScanned,
    ms: Date.now() - scanStarted,
  };
}

/** Pass-2: load full FEED_MAPPING_INCLUDE rows for a batch of winner mapping IDs. */
export async function loadMappingsByIdsForExport(mappingIds: string[]): Promise<any[]> {
  if (mappingIds.length === 0) return [];
  const prismaAny = prismaDirect as any;
  return prismaAny.variantMapping.findMany({
    where: { id: { in: mappingIds } },
    include: FEED_MAPPING_INCLUDE,
  });
}

const RAW_JSON_HYDRATE_CHUNK = 2000;

/**
 * Load KickDB rawJson only for final export rows — keeps full-catalog scans out of heap.
 * Pass every candidate set in one call (master∪specs): product IDs are deduped so we
 * never double-fetch the same blob (was ~2× Postgres IO before).
 */
export async function hydrateExportCandidateKickdbRawJson(
  ...candidateSets: FeedExportCandidate[][]
): Promise<{ productIds: number; chunks: number; ms: number }> {
  const started = Date.now();
  const candidates = candidateSets.flat();
  const productIds = Array.from(
    new Set(
      candidates
        .map((candidate) => String((candidate.product as { id?: string })?.id ?? "").trim())
        .filter(Boolean)
    )
  );
  if (productIds.length === 0) return { productIds: 0, chunks: 0, ms: 0 };

  const rawByProductId = new Map<string, unknown>();
  const prismaAny = prismaDirect as any;
  let chunks = 0;
  for (let offset = 0; offset < productIds.length; offset += RAW_JSON_HYDRATE_CHUNK) {
    const chunk = productIds.slice(offset, offset + RAW_JSON_HYDRATE_CHUNK);
    chunks += 1;
    const rows = await prismaAny.kickDBProduct.findMany({
      where: { id: { in: chunk } },
      select: { id: true, rawJson: true },
    });
    for (const row of rows ?? []) {
      const id = String(row?.id ?? "").trim();
      if (!id) continue;
      rawByProductId.set(id, row?.rawJson ?? null);
    }
    if (chunks % 10 === 0 || offset + RAW_JSON_HYDRATE_CHUNK >= productIds.length) {
      console.info("[GALAXUS][MASTER] hydrate rawJson progress", {
        loaded: Math.min(offset + chunk.length, productIds.length),
        total: productIds.length,
        ms: Date.now() - started,
      });
    }
  }

  for (const candidate of candidates) {
    const product = candidate.product as { id?: string; rawJson?: unknown } | null;
    const productId = String(product?.id ?? "").trim();
    if (!product || !productId || !rawByProductId.has(productId)) continue;
    product.rawJson = rawByProductId.get(productId);
  }

  return { productIds: productIds.length, chunks, ms: Date.now() - started };
}
