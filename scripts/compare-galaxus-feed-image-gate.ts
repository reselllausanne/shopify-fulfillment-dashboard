/**
 * Dry-run: compare stock/offer publishable GTIN counts using
 * (A) legacy has-image via pickGalaxusProductImageList(images+urls)
 * (B) slim path hasImageSignal (URLs + boolean JSONB presence, no JSONB payload)
 *
 * Usage:
 *   npx tsx scripts/compare-galaxus-feed-image-gate.ts [--limit=50000]
 *
 * Does not write feeds. Safe read-only.
 */
import { prismaDirect } from "@/app/lib/prisma";
import { buildFeedMappingsWhere } from "@/galaxus/exports/trmExport";
import { accumulateBestCandidates, filterExportCandidates } from "@/galaxus/exports/gtinSelection";
import { PARTNER_KEY_SELECT, partnerKeysLowerSet } from "@/galaxus/exports/partnerPricing";
import { pickGalaxusProductImageList } from "@/galaxus/exports/productImages";
import {
  attachHasImageSignalToMappings,
  FEED_VARIANT_SELECT_GATE_NO_IMAGES,
  hasGalaxusPrimaryImage,
} from "@/galaxus/exports/variantImagePresence";
import { isGalaxusCatalogReady } from "@/galaxus/exports/feedEligibility";

function argLimit(): number | null {
  const raw = process.argv.find((a) => a.startsWith("--limit="));
  if (!raw) return null;
  const n = Number.parseInt(raw.slice("--limit=".length), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
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

async function collectPublishable(opts: {
  mode: "legacy" | "slim";
  maxMappings: number | null;
}) {
  const prismaAny = prismaDirect as any;
  const partners = await prismaAny.partner.findMany({ select: PARTNER_KEY_SELECT });
  const galaxusPartnerKeysLower = partnerKeysLowerSet(partners);
  const bestByGtin = new Map<string, any>();
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
    });
  } while (lastBatch === pageSize && (opts.maxMappings == null || mappingsScanned < opts.maxMappings));

  const candidates = Array.from(bestByGtin.values()).filter((c) => String(c?.providerKey ?? ""));
  const { valid } = filterExportCandidates(candidates);
  const catalogReady = valid.filter((c) => isGalaxusCatalogReady(c.variant));
  const withSignalTrue = valid.filter((c) => hasGalaxusPrimaryImage(c.variant)).length;

  return {
    mappingsScanned,
    winnerGtins: bestByGtin.size,
    exportValid: valid.length,
    catalogReady: catalogReady.length,
    hasImageAmongValid: withSignalTrue,
  };
}

async function main() {
  const limit = argLimit();
  console.log(
    JSON.stringify(
      {
        startedAt: new Date().toISOString(),
        limit: limit ?? "all",
      },
      null,
      2
    )
  );

  const legacy = await collectPublishable({ mode: "legacy", maxMappings: limit });
  const slim = await collectPublishable({ mode: "slim", maxMappings: limit });

  const delta = {
    winnerGtins: slim.winnerGtins - legacy.winnerGtins,
    exportValid: slim.exportValid - legacy.exportValid,
    catalogReady: slim.catalogReady - legacy.catalogReady,
  };

  console.log(
    JSON.stringify(
      {
        legacy,
        slim,
        delta,
        pass:
          delta.winnerGtins === 0 && delta.exportValid === 0 && delta.catalogReady === 0
            ? "exact_match"
            : Math.abs(delta.catalogReady) / Math.max(legacy.catalogReady, 1) < 0.001
              ? "within_0_1pct"
              : "review_delta",
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prismaDirect.$disconnect().catch(() => undefined);
  });
