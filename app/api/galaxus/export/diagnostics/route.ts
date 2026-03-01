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
    const supplier = searchParams.get("supplier")?.trim();

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

    // Approximate “not sendable” reasons you can act on.
    let skippedInvalidSellPrice = 0;
    let skippedMissingProviderKey = totalCandidatesByGtin - candidatesWithProviderKey.length;
    for (const c of uniqueCandidates) {
      const sellPrice = Number(c?.sellPriceExVat);
      if (!Number.isFinite(sellPrice) || sellPrice <= 0) skippedInvalidSellPrice += 1;
    }

    return NextResponse.json({
      ok: true,
      supplier: supplier ?? null,
      counts: {
        mappingsTotal: await prismaAny.variantMapping.count({ where: mappingsWhere }),
        mappingsWithGtin: await prismaAny.variantMapping.count({ where: { ...mappingsWhere, gtin: { not: null } } }),
        candidatesBestByGtin: totalCandidatesByGtin,
        candidatesMissingProviderKey: skippedMissingProviderKey,
        candidatesUniqueProviderKey: uniqueCandidates.length,
        exportRowsAfterInvariants: exportCandidates.length,
        invariantFailures: invalidSupplierVariantIds.length,
        skippedInvalidSellPriceApprox: skippedInvalidSellPrice,
      },
      invariantFailureSample: invalidSupplierVariantIds.slice(0, 50),
      note:
        "exportRowsAfterInvariants is the closest number to what ends up in master/offer/stock feeds (before format-specific filtering). Big drops are usually GTIN grouping + providerKey dedupe or invalid sellPrice.",
    });
  } catch (error: any) {
    console.error("[GALAXUS][EXPORT][DIAGNOSTICS] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Diagnostics failed" }, { status: 500 });
  }
}

