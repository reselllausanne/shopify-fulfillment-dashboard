import { prisma } from "@/app/lib/prisma";
import { isGalaxusCatalogReady } from "@/galaxus/exports/feedEligibility";
import { resolvePhysicalCatalogIdentity } from "@/galaxus/jobs/physicalCatalogHydrate";
import { expandGtinLookupCandidates } from "@/shopify/restock/gtinAliasLookup";

export type HydrateCatalogIdentityResult = {
  scanned: number;
  alreadyReady: number;
  hydrated: number;
  mappingLinked: number;
  unhydrated: string[];
};

type Row = {
  supplierVariantId: string;
  gtin: string | null;
  providerKey: string | null;
  images: unknown;
  sourceImageUrl: string | null;
  hostedImageUrl: string | null;
  supplierProductName: string | null;
  supplierBrand: string | null;
  supplierSku: string | null;
  kickdbVariantId: string | null;
};

/**
 * Backfill brand + images (+ KickDB mapping link) on supplier rows that fail
 * `isGalaxusCatalogReady` even though KickDB already has the product locally.
 *
 * Common on STX liquidation (`manualLock`) rows: mapping exists with GTIN but
 * `kickdbVariantId` was never set and `images` stayed empty → master drops the
 * row while stock/offer keys can still look orphaned on Galaxus.
 */
export async function hydrateSupplierVariantsMissingCatalog(options?: {
  dryRun?: boolean;
  limit?: number;
  /** Default `stx_` — pass `ner:` prefix for physical stand-ins. */
  supplierVariantIdPrefix?: string;
}): Promise<HydrateCatalogIdentityResult> {
  const dryRun = Boolean(options?.dryRun);
  const limit = Math.max(1, options?.limit ?? 500);
  const prefix = options?.supplierVariantIdPrefix ?? "stx_";

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      sv."supplierVariantId",
      sv."gtin",
      sv."providerKey",
      sv."images",
      sv."sourceImageUrl",
      sv."hostedImageUrl",
      sv."supplierProductName",
      sv."supplierBrand",
      sv."supplierSku",
      vm."kickdbVariantId"
    FROM "public"."SupplierVariant" sv
    LEFT JOIN "public"."VariantMapping" vm ON vm."supplierVariantId" = sv."supplierVariantId"
    WHERE sv."supplierVariantId" LIKE ${prefix + "%"}
      AND (
        COALESCE(sv."hostedImageUrl", '') = ''
        AND COALESCE(sv."sourceImageUrl", '') = ''
        AND (sv."images" IS NULL OR sv."images"::text IN ('null', '[]', '{}'))
        OR COALESCE(sv."supplierBrand", '') = ''
      )
    ORDER BY sv."manualLock" DESC, sv."updatedAt" DESC
    LIMIT ${limit}
  `;

  const unhydrated: string[] = [];
  let alreadyReady = 0;
  let hydrated = 0;
  let mappingLinked = 0;

  for (const row of rows) {
    if (isGalaxusCatalogReady(row)) {
      alreadyReady += 1;
      continue;
    }

    const gtin = String(row.gtin ?? "").trim();
    if (!gtin) {
      unhydrated.push(row.supplierVariantId);
      continue;
    }

    const identity = await resolvePhysicalCatalogIdentity(gtin, { allowApiFallback: true });
    if (!identity.brand || identity.images.length === 0) {
      unhydrated.push(gtin);
      continue;
    }

    if (dryRun) {
      hydrated += 1;
      if (!row.kickdbVariantId) mappingLinked += 1;
      continue;
    }

    await prisma.supplierVariant.update({
      where: { supplierVariantId: row.supplierVariantId },
      data: {
        supplierBrand: identity.brand,
        images: identity.images,
        sourceImageUrl: identity.images[0],
        imageSyncStatus: "PENDING",
        imageSyncError: null,
        ...(identity.name ? { supplierProductName: identity.name } : {}),
        updatedAt: new Date(),
      },
    });
    hydrated += 1;

    if (!row.kickdbVariantId) {
      const candidates = await expandGtinLookupCandidates(gtin);
      const kickdbVariant = await prisma.kickDBVariant.findFirst({
        where: {
          OR: [
            candidates.length > 0 ? { gtin: { in: candidates } } : undefined,
            candidates.length > 0 ? { ean: { in: candidates } } : undefined,
          ].filter(Boolean) as any[],
        },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
      });
      if (kickdbVariant?.id) {
        await prisma.variantMapping.updateMany({
          where: { supplierVariantId: row.supplierVariantId },
          data: { kickdbVariantId: kickdbVariant.id, updatedAt: new Date() },
        });
        mappingLinked += 1;
      }
    }
  }

  if (hydrated > 0) {
    console.info("[galaxus][hydrate-catalog] done", {
      prefix,
      dryRun,
      scanned: rows.length,
      alreadyReady,
      hydrated,
      mappingLinked,
      unhydrated: unhydrated.length,
    });
  }

  return {
    scanned: rows.length,
    alreadyReady,
    hydrated,
    mappingLinked,
    unhydrated,
  };
}
