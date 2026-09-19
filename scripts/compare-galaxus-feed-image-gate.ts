/**
 * Single-pass compare: legacy vs slim image gate on the **same** mapping rows.
 *
 * - legacy: hasImageSignal = pickGalaxusProductImageList(full row).length > 0
 * - slim:   attachHasImageSignalToMappings (URL short-circuit + pick-equivalent presence)
 *
 * One scan → no catalog drift between modes.
 *
 * Usage:
 *   npx tsx scripts/compare-galaxus-feed-image-gate.ts [--limit=50000] [--out=tmp/gate-compare.json]
 *
 * Exit 0 only for exact_id_match (exactEligible && exactRejected).
 * Read-only. Loads env via dotenv only — never `source .env`.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { prismaDirect } from "@/app/lib/prisma";
import { buildFeedMappingsWhere } from "@/galaxus/exports/trmExport";
import { accumulateBestCandidates, filterExportCandidates } from "@/galaxus/exports/gtinSelection";
import { PARTNER_KEY_SELECT, partnerKeysLowerSet } from "@/galaxus/exports/partnerPricing";
import { pickGalaxusProductImageList } from "@/galaxus/exports/productImages";
import {
  attachHasImageSignalToMappings,
  FEED_VARIANT_SELECT_GATE_NO_IMAGES,
} from "@/galaxus/exports/variantImagePresence";
import { isGalaxusCatalogReady } from "@/galaxus/exports/feedEligibility";

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const raw = process.argv.find((a) => a.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : null;
}

function argLimit(): number | null {
  const raw = argValue("limit");
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function sortedUnique(ids: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(ids).map((s) => String(s).trim()).filter(Boolean))).sort();
}

function setDiff(a: string[], b: string[]): { onlyA: string[]; onlyB: string[] } {
  const setB = new Set(b);
  const setA = new Set(a);
  return {
    onlyA: a.filter((x) => !setB.has(x)),
    onlyB: b.filter((x) => !setA.has(x)),
  };
}

function cloneMappingsForMode(mappings: any[], mode: "legacy" | "slim"): any[] {
  return mappings.map((m) => {
    const v = m?.supplierVariant;
    if (!v) return { ...m, supplierVariant: null };
    if (mode === "legacy") {
      const full = { ...v };
      const has = pickGalaxusProductImageList(full).length > 0;
      const { images: _drop, ...rest } = full;
      return {
        ...m,
        supplierVariant: { ...rest, hasImageSignal: has },
      };
    }
    // slim: strip images so attachHasImageSignal uses production path (URL or DB pick-load)
    const { images: _drop, ...rest } = v;
    return {
      ...m,
      supplierVariant: { ...rest },
    };
  });
}

type GateSets = {
  mappingsScanned: number;
  eligibleProviderKeys: string[];
  eligibleGtins: string[];
  eligibleSupplierVariantIds: string[];
  rejectedMissingImageSupplierVariantIds: string[];
  counts: {
    winnerGtins: number;
    exportValid: number;
    catalogReady: number;
    rejectedMissingImage: number;
  };
};

function finalizeGateSets(
  mappingsScanned: number,
  bestByGtin: Map<string, any>,
  rejectedMissingImage: Set<string>
): GateSets {
  const candidates = Array.from(bestByGtin.values()).filter((c) => String(c?.providerKey ?? ""));
  const { valid } = filterExportCandidates(candidates);
  const catalogReady = valid.filter((c) => isGalaxusCatalogReady(c.variant));
  return {
    mappingsScanned,
    eligibleProviderKeys: sortedUnique(catalogReady.map((c) => String(c.providerKey ?? ""))),
    eligibleGtins: sortedUnique(catalogReady.map((c) => String(c.gtin ?? ""))),
    eligibleSupplierVariantIds: sortedUnique(
      catalogReady.map((c) => String(c.variant?.supplierVariantId ?? ""))
    ),
    rejectedMissingImageSupplierVariantIds: sortedUnique(rejectedMissingImage),
    counts: {
      winnerGtins: bestByGtin.size,
      exportValid: valid.length,
      catalogReady: catalogReady.length,
      rejectedMissingImage: rejectedMissingImage.size,
    },
  };
}

async function collectBothGateSetsSinglePass(maxMappings: number | null): Promise<{
  legacy: GateSets;
  slim: GateSets;
}> {
  const prismaAny = prismaDirect as any;
  const partners = await prismaAny.partner.findMany({ select: PARTNER_KEY_SELECT });
  const galaxusPartnerKeysLower = partnerKeysLowerSet(partners);

  const bestLegacy = new Map<string, any>();
  const bestSlim = new Map<string, any>();
  const rejectedLegacy = new Set<string>();
  const rejectedSlim = new Set<string>();

  let cursorId: string | null = null;
  let mappingsScanned = 0;
  const pageSize = 5000;
  let lastBatch = 0;
  const mappingsWhere = buildFeedMappingsWhere(null, true);

  do {
    const take =
      maxMappings == null
        ? pageSize
        : Math.min(pageSize, Math.max(0, maxMappings - mappingsScanned));
    if (take <= 0) break;

    const whereClause = {
      ...mappingsWhere,
      ...(cursorId ? { id: { lt: cursorId } } : {}),
    };
    const mappings = (await prismaAny.variantMapping.findMany({
      where: whereClause,
      select: {
        id: true,
        gtin: true,
        updatedAt: true,
        supplierVariantId: true,
        supplierVariant: {
          select: { ...FEED_VARIANT_SELECT_GATE_NO_IMAGES, images: true },
        },
      },
      orderBy: [{ id: "desc" }],
      take,
    })) as any[];

    lastBatch = mappings.length;
    mappingsScanned += lastBatch;
    if (mappings.length > 0) cursorId = mappings[mappings.length - 1]?.id ?? null;

    const legacyMappings = cloneMappingsForMode(mappings, "legacy");
    const slimMappings = cloneMappingsForMode(mappings, "slim");
    await attachHasImageSignalToMappings(slimMappings);

    const accumulateOpts = {
      keyBy: "gtin" as const,
      requireProductName: false,
      requireImage: true,
      preferInStock: true,
      galaxusPartnerKeysLower,
    };

    accumulateBestCandidates(legacyMappings, bestLegacy, {
      ...accumulateOpts,
      onExclude: (payload) => {
        if (payload.reason !== "MISSING_IMAGE") return;
        const id = String(
          payload.variant?.supplierVariantId ?? payload.mapping?.supplierVariantId ?? ""
        ).trim();
        if (id) rejectedLegacy.add(id);
      },
    });
    accumulateBestCandidates(slimMappings, bestSlim, {
      ...accumulateOpts,
      onExclude: (payload) => {
        if (payload.reason !== "MISSING_IMAGE") return;
        const id = String(
          payload.variant?.supplierVariantId ?? payload.mapping?.supplierVariantId ?? ""
        ).trim();
        if (id) rejectedSlim.add(id);
      },
    });
  } while (lastBatch === pageSize && (maxMappings == null || mappingsScanned < maxMappings));

  return {
    legacy: finalizeGateSets(mappingsScanned, bestLegacy, rejectedLegacy),
    slim: finalizeGateSets(mappingsScanned, bestSlim, rejectedSlim),
  };
}

async function main() {
  const limit = argLimit();
  const outPath = argValue("out");
  const sampleN = 20;

  if (!process.env.DATABASE_URL && !process.env.DIRECT_URL) {
    console.error("DATABASE_URL/DIRECT_URL missing (load via dotenv — never source .env)");
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify(
      {
        startedAt: new Date().toISOString(),
        limit: limit ?? "all",
        mode: "single-pass",
        requirement: "exact eligible + rejected ID sets must match",
      },
      null,
      2
    )
  );

  const { legacy, slim } = await collectBothGateSetsSinglePass(limit);

  const eligiblePk = setDiff(legacy.eligibleProviderKeys, slim.eligibleProviderKeys);
  const eligibleGtin = setDiff(legacy.eligibleGtins, slim.eligibleGtins);
  const eligibleSv = setDiff(legacy.eligibleSupplierVariantIds, slim.eligibleSupplierVariantIds);
  const rejected = setDiff(
    legacy.rejectedMissingImageSupplierVariantIds,
    slim.rejectedMissingImageSupplierVariantIds
  );

  const exactEligible =
    eligiblePk.onlyA.length === 0 &&
    eligiblePk.onlyB.length === 0 &&
    eligibleGtin.onlyA.length === 0 &&
    eligibleGtin.onlyB.length === 0 &&
    eligibleSv.onlyA.length === 0 &&
    eligibleSv.onlyB.length === 0;
  const exactRejected = rejected.onlyA.length === 0 && rejected.onlyB.length === 0;
  const pass = exactEligible && exactRejected;

  const report = {
    legacy: {
      mappingsScanned: legacy.mappingsScanned,
      counts: legacy.counts,
    },
    slim: {
      mappingsScanned: slim.mappingsScanned,
      counts: slim.counts,
    },
    setDiffs: {
      eligibleProviderKeys: {
        onlyLegacy: eligiblePk.onlyA.length,
        onlySlim: eligiblePk.onlyB.length,
        sampleOnlyLegacy: eligiblePk.onlyA.slice(0, sampleN),
        sampleOnlySlim: eligiblePk.onlyB.slice(0, sampleN),
      },
      eligibleGtins: {
        onlyLegacy: eligibleGtin.onlyA.length,
        onlySlim: eligibleGtin.onlyB.length,
        sampleOnlyLegacy: eligibleGtin.onlyA.slice(0, sampleN),
        sampleOnlySlim: eligibleGtin.onlyB.slice(0, sampleN),
      },
      eligibleSupplierVariantIds: {
        onlyLegacy: eligibleSv.onlyA.length,
        onlySlim: eligibleSv.onlyB.length,
        sampleOnlyLegacy: eligibleSv.onlyA.slice(0, sampleN),
        sampleOnlySlim: eligibleSv.onlyB.slice(0, sampleN),
      },
      rejectedMissingImageSupplierVariantIds: {
        onlyLegacy: rejected.onlyA.length,
        onlySlim: rejected.onlyB.length,
        sampleOnlyLegacy: rejected.onlyA.slice(0, sampleN),
        sampleOnlySlim: rejected.onlyB.slice(0, sampleN),
      },
    },
    pass: pass ? "exact_id_match" : "id_set_mismatch",
    exactEligible,
    exactRejected,
  };

  console.log(JSON.stringify(report, null, 2));

  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          ...report,
          fullSets: {
            legacy: {
              eligibleProviderKeys: legacy.eligibleProviderKeys,
              eligibleGtins: legacy.eligibleGtins,
              eligibleSupplierVariantIds: legacy.eligibleSupplierVariantIds,
              rejectedMissingImageSupplierVariantIds: legacy.rejectedMissingImageSupplierVariantIds,
            },
            slim: {
              eligibleProviderKeys: slim.eligibleProviderKeys,
              eligibleGtins: slim.eligibleGtins,
              eligibleSupplierVariantIds: slim.eligibleSupplierVariantIds,
              rejectedMissingImageSupplierVariantIds: slim.rejectedMissingImageSupplierVariantIds,
            },
            diffs: {
              eligibleProviderKeys: eligiblePk,
              eligibleGtins: eligibleGtin,
              eligibleSupplierVariantIds: eligibleSv,
              rejectedMissingImageSupplierVariantIds: rejected,
            },
          },
        },
        null,
        2
      )
    );
    console.error(`wrote ${outPath}`);
  }

  if (!pass) process.exitCode = 2;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prismaDirect.$disconnect().catch(() => undefined);
  });
