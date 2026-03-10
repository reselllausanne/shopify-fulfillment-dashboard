import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { accumulateBestCandidates, filterExportCandidates } from "@/galaxus/exports/gtinSelection";
import { buildFeedMappingsWhere, createTrmFeedExclusionStats, recordTrmFeedExclusion } from "@/galaxus/exports/trmExport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toNumber(value: any) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request: Request) {
  try {
    const prismaAny = prisma as any;
    const { searchParams } = new URL(request.url);
    const supplier = searchParams.get("supplier")?.trim() || null;
    const supplierPrefix = supplier ? `${supplier.toLowerCase()}:` : null;
    const cacheKey = `export-diagnostics:${supplier ?? "all"}`;
    const cacheTtlMs = 60 * 60 * 1000;

    const latestCache = await prismaAny.galaxusJobRun.findFirst({
      where: { jobName: cacheKey },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true, resultJson: true },
    });
    if (latestCache?.startedAt && latestCache?.resultJson) {
      const ageMs = Date.now() - new Date(latestCache.startedAt).getTime();
      if (ageMs >= 0 && ageMs < cacheTtlMs) {
        return NextResponse.json(latestCache.resultJson);
      }
    }

    const mappingsWhere = buildFeedMappingsWhere(supplier, true);
    const trmExclusionStats = createTrmFeedExclusionStats();

    const partners = await prismaAny.partner.findMany();
    const partnerByKey = new Map<string, any>(
      partners.map((p: any) => [String(p.key ?? "").toLowerCase(), p])
    );
    const resolvePartnerOverrides = (key: string | null) => {
      if (!key) return null;
      const partner = partnerByKey.get(key.toLowerCase());
      if (!partner) return null;
      return {
        targetMargin: toNumber(partner.targetMargin),
        shippingPerPair: toNumber(partner.shippingPerPair),
        bufferPerPair: toNumber(partner.bufferPerPair),
        roundTo: toNumber(partner.roundTo),
        vatRate: toNumber(partner.vatRate),
      };
    };

    // Build the same candidate set exports use: best-by-gtin, then providerKey dedupe.
    const bestByGtin = new Map<string, any>();
    const pageSize = 500;
    let offset = 0;
    let lastBatch = 0;
    do {
      const mappings = await prismaAny.variantMapping.findMany({
        where: mappingsWhere,
        include: {
          supplierVariant: true,
          kickdbVariant: { include: { product: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: pageSize,
        skip: offset,
      });
      lastBatch = mappings.length;
      accumulateBestCandidates(mappings, bestByGtin, resolvePartnerOverrides, {
        keyBy: "gtin",
        requireProductName: false,
        requireImage: false,
        onExclude: (payload) => {
          if (payload.supplierKey === "trm") recordTrmFeedExclusion(trmExclusionStats, payload.reason);
        },
      });
      offset += pageSize;
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

    await prismaAny.galaxusJobRun.create({
      data: {
        jobName: cacheKey,
        startedAt: new Date(),
        finishedAt: new Date(),
        success: true,
        resultJson: payload,
      },
    });

    return NextResponse.json(payload);
  } catch (error: any) {
    console.error("[GALAXUS][EXPORT][DIAGNOSTICS] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Diagnostics failed" }, { status: 500 });
  }
}

