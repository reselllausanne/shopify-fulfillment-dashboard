/**
 * Compare legacy vs slim Galaxus image gate — exact ID sets, not totals.
 *
 * Modes:
 *   (A) legacy — has-image via pickGalaxusProductImageList(images+urls)
 *   (B) slim   — hasImageSignal (URLs + boolean JSONB presence, no JSONB payload)
 *
 * Usage:
 *   npx tsx scripts/compare-galaxus-feed-image-gate.ts [--limit=50000] [--out=tmp/gate-compare.json]
 *
 * Exit 0 only when eligible providerKeys AND rejected (MISSING_IMAGE) sets match exactly.
 * Read-only. No feed writes.
 */
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

async function loadPage(params: {
  cursorId: string | null;
  take: number;
  withImages: boolean;
}) {
  const prismaAny = prismaDirect as any;
  const mappingsWhere = buildFeedMappingsWhere(null, true);
  const whereClause = {
    ...mappingsWhere,
    ...(params.cursorId ? { id: { lt: params.cursorId } } : {}),
  };
  const mappings = await prismaAny.variantMapping.findMany({
    where: whereClause,
    select: {
      id: true,
      gtin: true,
      updatedAt: true,
      supplierVariantId: true,
      supplierVariant: {
        select: params.withImages
          ? { ...FEED_VARIANT_SELECT_GATE_NO_IMAGES, images: true }
          : FEED_VARIANT_SELECT_GATE_NO_IMAGES,
      },
    },
    orderBy: [{ id: "desc" }],
    take: params.take,
  });
  return mappings as any[];
}

type GateSets = {
  mappingsScanned: number;
  /** GTIN winners that pass filterExportCandidates + isGalaxusCatalogReady */
  eligibleProviderKeys: string[];
  eligibleGtins: string[];
  eligibleSupplierVariantIds: string[];
  /** Excluded during accumulate with MISSING_IMAGE (supplierVariantId) */
  rejectedMissingImageSupplierVariantIds: string[];
  counts: {
    winnerGtins: number;
    exportValid: number;
    catalogReady: number;
    rejectedMissingImage: number;
  };
};

async function collectGateSets(opts: {
  mode: "legacy" | "slim";
  maxMappings: number | null;
}): Promise<GateSets> {
  const prismaAny = prismaDirect as any;
  const partners = await prismaAny.partner.findMany({ select: PARTNER_KEY_SELECT });
  const galaxusPartnerKeysLower = partnerKeysLowerSet(partners);
  const bestByGtin = new Map<string, any>();
  const rejectedMissingImage = new Set<string>();
  let cursorId: string | null = null;
  let mappingsScanned = 0;
  const pageSize = 5000;
  let lastBatch = 0;

  do {
    const take =
      opts.maxMappings == null
        ? pageSize
        : Math.min(pageSize, Math.max(0, opts.maxMappings - mappingsScanned));
    if (take <= 0) break;

    const mappings = await loadPage({
      cursorId,
      take,
      withImages: opts.mode === "legacy",
    });
    lastBatch = mappings.length;
    mappingsScanned += lastBatch;
    if (mappings.length > 0) cursorId = mappings[mappings.length - 1]?.id ?? null;

    if (opts.mode === "slim") {
      await attachHasImageSignalToMappings(mappings);
    } else {
      for (const m of mappings) {
        const v = m?.supplierVariant;
        if (!v) continue;
        v.hasImageSignal = pickGalaxusProductImageList(v).length > 0;
      }
    }

    accumulateBestCandidates(mappings, bestByGtin, {
      keyBy: "gtin",
      requireProductName: false,
      requireImage: true,
      preferInStock: true,
      galaxusPartnerKeysLower,
      onExclude: (payload) => {
        if (payload.reason !== "MISSING_IMAGE") return;
        const id = String(
          payload.variant?.supplierVariantId ?? payload.mapping?.supplierVariantId ?? ""
        ).trim();
        if (id) rejectedMissingImage.add(id);
      },
    });
  } while (lastBatch === pageSize && (opts.maxMappings == null || mappingsScanned < opts.maxMappings));

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

async function main() {
  const limit = argLimit();
  const outPath = argValue("out");
  const sampleN = 20;

  console.log(
    JSON.stringify(
      {
        startedAt: new Date().toISOString(),
        limit: limit ?? "all",
        requirement: "exact eligible + rejected ID sets must match",
      },
      null,
      2
    )
  );

  const legacy = await collectGateSets({ mode: "legacy", maxMappings: limit });
  const slim = await collectGateSets({ mode: "slim", maxMappings: limit });

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
