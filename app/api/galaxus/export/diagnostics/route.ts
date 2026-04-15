import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { accumulateBestCandidates, filterExportCandidates } from "@/galaxus/exports/gtinSelection";
import { buildFeedMappingsWhere, createTrmFeedExclusionStats, recordTrmFeedExclusion } from "@/galaxus/exports/trmExport";
import { PARTNER_KEY_SELECT, partnerKeysLowerSet } from "@/galaxus/exports/partnerPricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIAGNOSTICS_CACHE_TTL_MS = 60 * 60 * 1000;
const diagnosticsCache = new Map<string, { createdAt: number; payload: any }>();

export async function GET(request: Request) {
  try {
    const prismaAny = prisma as any;
    const { searchParams } = new URL(request.url);
    const supplier = searchParams.get("supplier")?.trim() || null;
    const supplierPrefix = supplier ? `${supplier.toLowerCase()}:` : null;
    const cacheKey = supplier ?? "all";
    const cached = diagnosticsCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < DIAGNOSTICS_CACHE_TTL_MS) {
      return NextResponse.json(cached.payload);
    }

    const mappingsWhere = buildFeedMappingsWhere(supplier, true);
    const trmExclusionStats = createTrmFeedExclusionStats();

    const partners = await prismaAny.partner.findMany({ select: PARTNER_KEY_SELECT });
    const galaxusPartnerKeysLower = partnerKeysLowerSet(partners);

    // Build the same candidate set exports use: best-by-gtin, then providerKey dedupe.
    const bestByGtin = new Map<string, any>();
    const pageSize = 500;
    let lastBatch = 0;
    let cursorUpdatedAt: Date | null = null;
    let cursorId: string | null = null;
    do {
      const whereClause: Record<string, unknown> = {
        ...mappingsWhere,
        ...(cursorUpdatedAt && cursorId
          ? {
              OR: [
                { updatedAt: { lt: cursorUpdatedAt } },
                { updatedAt: cursorUpdatedAt, id: { lt: cursorId } },
              ],
            }
          : {}),
      };
      const mappings: any[] = await prismaAny.variantMapping.findMany({
        where: whereClause,
        select: {
          id: true,
          gtin: true,
          updatedAt: true,
          supplierVariantId: true,
          supplierVariant: {
            select: {
              supplierVariantId: true,
              price: true,
              stock: true,
              updatedAt: true,
              deliveryType: true,
            },
          },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: pageSize,
      });
      lastBatch = mappings.length;
      if (mappings.length > 0) {
        const last: any = mappings[mappings.length - 1];
        cursorUpdatedAt = last.updatedAt ?? null;
        cursorId = last.id ?? null;
      }
      accumulateBestCandidates(mappings, bestByGtin, {
        keyBy: "gtin",
        requireProductName: false,
        requireImage: false,
        galaxusPartnerKeysLower,
        onExclude: (payload) => {
          if (payload.supplierKey === "trm") recordTrmFeedExclusion(trmExclusionStats, payload.reason);
        },
      });
    } while (lastBatch === pageSize);

    const candidates = Array.from(bestByGtin.values());
    const totalCandidatesByGtin = candidates.length;

    const seenProviderKeys = new Set<string>();
    const candidatesWithProviderKey = candidates.filter((c: any) => Boolean(String(c?.providerKey ?? "")));
    const uniqueCandidates = candidatesWithProviderKey.filter((c: any) => {
      const key = String(c?.providerKey ?? "");
      if (!key) return false;
      if (seenProviderKeys.has(key)) return false;
      seenProviderKeys.add(key);
      return true;
    });

    const { valid: exportCandidates, invalidSupplierVariantIds } = filterExportCandidates(uniqueCandidates);

    // Full-scope stats (not only feed-eligible), for “where rows are lost” debugging.
    const mappingScopeWhere = supplierPrefix
      ? { supplierVariantId: { startsWith: supplierPrefix } }
      : {};
    const mappingsInScope = await prismaAny.variantMapping.findMany({
      where: mappingScopeWhere,
      select: {
        gtin: true,
        status: true,
        supplierVariantId: true,
        kickdbVariantId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const mappingsWithGtinScope = mappingsInScope.filter((m: any) => Boolean(m?.gtin));
    const uniqueGtinsScope = new Set(
      mappingsWithGtinScope.map((m: any) => String(m.gtin ?? "").trim()).filter(Boolean)
    );
    const duplicateGtinRowsCollapsed = mappingsWithGtinScope.length - uniqueGtinsScope.size;
    const eligibleStatuses = new Set(["MATCHED", "SUPPLIER_GTIN", "PARTNER_GTIN"]);
    const statusBreakdownWithGtin: Record<string, number> = {};
    for (const row of mappingsWithGtinScope) {
      const status = String(row?.status ?? "NULL");
      statusBreakdownWithGtin[status] = (statusBreakdownWithGtin[status] ?? 0) + 1;
    }
    const eligibleWithGtinCount = mappingsWithGtinScope.filter((m: any) =>
      eligibleStatuses.has(String(m?.status ?? ""))
    ).length;
    const statusBreakdownAll: Record<string, number> = {};
    for (const row of mappingsInScope) {
      const status = String(row?.status ?? "NULL");
      statusBreakdownAll[status] = (statusBreakdownAll[status] ?? 0) + 1;
    }
    const pendingCount = statusBreakdownAll.PENDING_GTIN ?? 0;
    const notFoundCount = statusBreakdownAll.NOT_FOUND ?? 0;

    const supplierVariantScopeWhere = supplierPrefix
      ? { supplierVariantId: { startsWith: supplierPrefix } }
      : {};
    const [supplierVariantsTotal, supplierVariantsStockPositive, supplierVariantsStockZeroOrLess] =
      await Promise.all([
        prismaAny.supplierVariant.count({ where: supplierVariantScopeWhere }),
        prismaAny.supplierVariant.count({
          where: {
            ...supplierVariantScopeWhere,
            stock: { gt: 0 },
          },
        }),
        prismaAny.supplierVariant.count({
          where: {
            ...supplierVariantScopeWhere,
            stock: { lte: 0 },
          },
        }),
      ]);

    // “Never ran” diagnostics for unresolved rows (no SQL needed by user).
    const unresolvedStatuses = new Set(["PENDING_GTIN", "AMBIGUOUS_GTIN", "NOT_FOUND"]);
    const unresolvedRows = mappingsInScope.filter((m: any) =>
      unresolvedStatuses.has(String(m?.status ?? ""))
    );
    const unresolvedWithKickdbVariant = unresolvedRows.filter((m: any) => Boolean(m?.kickdbVariantId));
    const unresolvedWithoutKickdbVariant = unresolvedRows.filter((m: any) => !m?.kickdbVariantId);
    // Best-effort proxy for “never ran”: unresolved + no linked kickdb variant + never updated since create.
    const unresolvedNeverRanApprox = unresolvedWithoutKickdbVariant.filter((m: any) => {
      const createdAt = m?.createdAt ? new Date(m.createdAt).getTime() : null;
      const updatedAt = m?.updatedAt ? new Date(m.updatedAt).getTime() : null;
      if (!createdAt || !updatedAt) return false;
      return createdAt === updatedAt;
    });

    // Approximate “not sendable” reasons you can act on.
    let skippedInvalidSellPrice = 0;
    let skippedMissingProviderKey = totalCandidatesByGtin - candidatesWithProviderKey.length;
    for (const c of uniqueCandidates) {
      const sellPrice = Number(c?.sellPriceExVat);
      if (!Number.isFinite(sellPrice) || sellPrice <= 0) skippedInvalidSellPrice += 1;
    }

    const lastEnrichPending = await prismaAny.galaxusJobRun.findFirst({
      where: { jobName: "kickdb-enrich-pending", success: true },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    });
    const lastEnrichNotFound = await prismaAny.galaxusJobRun.findFirst({
      where: { jobName: "kickdb-enrich-not-found", success: true },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    });

    const payload = {
      ok: true,
      supplier: supplier ?? null,
      counts: {
        mappingsTotal: await prismaAny.variantMapping.count({ where: mappingScopeWhere }),
        mappingsWithGtin: mappingsWithGtinScope.length,
        mappingsWithGtinEligibleStatus: eligibleWithGtinCount,
        mappingsWithGtinIneligibleStatus: mappingsWithGtinScope.length - eligibleWithGtinCount,
        uniqueGtinsFromMappings: uniqueGtinsScope.size,
        duplicateGtinRowsCollapsed,
        candidatesBestByGtin: totalCandidatesByGtin,
        candidatesMissingProviderKey: skippedMissingProviderKey,
        candidatesUniqueProviderKey: uniqueCandidates.length,
        exportRowsAfterInvariants: exportCandidates.length,
        invariantFailures: invalidSupplierVariantIds.length,
        skippedInvalidSellPriceApprox: skippedInvalidSellPrice,
        supplierVariantsTotal,
        supplierVariantsStockPositive,
        supplierVariantsStockZeroOrLess,
        unresolvedRows: unresolvedRows.length,
        unresolvedRowsWithKickdbVariant: unresolvedWithKickdbVariant.length,
        unresolvedRowsWithoutKickdbVariant: unresolvedWithoutKickdbVariant.length,
        neverRanApprox: unresolvedNeverRanApprox.length,
        pendingGtin: pendingCount,
        notFoundGtin: notFoundCount,
      },
      lastRuns: {
        enrichPendingAt: lastEnrichPending?.finishedAt ?? null,
        enrichNotFoundAt: lastEnrichNotFound?.finishedAt ?? null,
      },
      statusBreakdownWithGtin,
      trmExclusionStats,
      invariantFailureSample: invalidSupplierVariantIds.slice(0, 50),
      neverRanApproxSample: unresolvedNeverRanApprox
        .slice(0, 50)
        .map((row: any) => row.supplierVariantId),
      note:
        "neverRanApprox is a best-effort proxy: unresolved rows without kickdbVariantId and unchanged since creation. It highlights rows likely never processed by enrichment.",
    };

    diagnosticsCache.set(cacheKey, { createdAt: Date.now(), payload });

    return NextResponse.json(payload);
  } catch (error: any) {
    console.error("[GALAXUS][EXPORT][DIAGNOSTICS] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Diagnostics failed" }, { status: 500 });
  }
}

