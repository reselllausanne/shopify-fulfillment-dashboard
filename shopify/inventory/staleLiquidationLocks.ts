import { prisma } from "@/app/lib/prisma";
import { LIQUIDATION_LOCATION_IDS } from "@/shopify/inventory/locationConfig";

/**
 * Physical-stock liquidation locks (`restock:liquidation …` from the scan /
 * backfill path, `phase4:liquidation …` from convergence). They price an owned
 * pair below StockX buy, so they are only valid while that pair is still on a
 * liquidation-lane shelf. Operator Galaxus liquidation (`mq2-liquidation`,
 * `galaxus-liquidation`), JMoney and in-stock fixed-price locks are not matched.
 */
const PHYSICAL_LIQUIDATION_NOTE_RE = /^\s*(restock|phase4):liquidation/i;

export const STALE_LIQUIDATION_RELEASE_NOTE = "phase4:dropship (stale-liquidation-sweep)";

/** STX price/stock is frozen while locked (bulk sync skips manualLock rows). */
const FROZEN_MARKET_DATA_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export function isPhysicalLiquidationLockNote(note: string | null | undefined): boolean {
  return PHYSICAL_LIQUIDATION_NOTE_RE.test(String(note ?? ""));
}

/**
 * DB fields to clear a physical liquidation lock. When the row's STX data is
 * older than the sync window, stock goes to 0 so the frozen ask count / buy
 * price is never republished; the next STX refresh restores live values.
 */
export function buildLiquidationReleaseData(input: {
  lastSyncAt: Date | null;
  note: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const lastSyncMs = input.lastSyncAt ? input.lastSyncAt.getTime() : 0;
  const marketDataStale = now.getTime() - lastSyncMs > FROZEN_MARKET_DATA_MAX_AGE_MS;
  return {
    manualLock: false,
    manualPrice: null,
    manualStock: null,
    manualUpdatedAt: now,
    manualNote: input.note,
    ...(marketDataStale ? { stock: 0 } : {}),
  };
}

/**
 * Release physical liquidation locks on any rows matching `where` (used before a
 * GTIN detach: a lock on a row that loses its GTIN can no longer be found by
 * convergence and would keep a below-buy price live on marketplaces forever).
 */
export async function releasePhysicalLiquidationLocksBeforeDetach(where: Record<string, unknown>) {
  const rows = await prisma.supplierVariant.findMany({
    where: { ...where, manualLock: true },
    select: { id: true, manualNote: true, lastSyncAt: true },
  });
  let released = 0;
  for (const row of rows) {
    if (!isPhysicalLiquidationLockNote(row.manualNote)) continue;
    await prisma.supplierVariant.update({
      where: { id: row.id },
      data: buildLiquidationReleaseData({
        lastSyncAt: row.lastSyncAt,
        note: "phase4:dropship (gtin detached)",
      }),
    });
    released += 1;
  }
  return released;
}

type LockedLiquidationRow = {
  id: string;
  supplierVariantId: string;
  supplierProductName: string | null;
  sizeRaw: string | null;
  manualNote: string | null;
  manualPrice: string | null;
  lastSyncAt: Date | null;
  svGtin: string | null;
  svProviderKey: string | null;
  mappingGtin: string | null;
  mappingProviderKey: string | null;
  physicalQty: number;
};

export type StaleLiquidationRelease = {
  supplierVariantId: string;
  name: string | null;
  size: string | null;
  gtin: string | null;
  manualPrice: number | null;
  restoredGtin: boolean;
  zeroedStaleStock: boolean;
};

export type StaleLiquidationSweepResult = {
  scanned: number;
  kept: number;
  released: StaleLiquidationRelease[];
  skippedReason?: string;
  dryRun: boolean;
};

/**
 * Release every physical liquidation lock whose pair is no longer on a
 * liquidation-lane shelf. GTIN comes from `SupplierVariant.gtin` or, when that
 * was detached, from `VariantMapping.gtin` (the identity the feeds publish).
 * Padding-tolerant physical match. DB only — Shopify side converges after via
 * the `phase4:dropship` note (picked up by convergeAll).
 */
export async function releaseStaleLiquidationLocks(
  options: { dryRun?: boolean } = {}
): Promise<StaleLiquidationSweepResult> {
  const dryRun = Boolean(options.dryRun);

  // Empty mirror (wipe / failed sync) would read as "everything sold" — never act on it.
  const mirrorRows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*)::bigint AS n
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s."sourceType" = 'physical'
      AND s."locationId" = ANY(${LIQUIDATION_LOCATION_IDS}::text[])
      AND s."available" > 0
  `;
  if (Number(mirrorRows[0]?.n ?? 0) === 0) {
    return { scanned: 0, kept: 0, released: [], dryRun, skippedReason: "physical_mirror_empty" };
  }

  const rows = await prisma.$queryRaw<LockedLiquidationRow[]>`
    SELECT
      sv."id",
      sv."supplierVariantId",
      sv."supplierProductName",
      sv."sizeRaw",
      sv."manualNote",
      sv."manualPrice"::text AS "manualPrice",
      sv."lastSyncAt",
      sv."gtin" AS "svGtin",
      sv."providerKey" AS "svProviderKey",
      vm."gtin" AS "mappingGtin",
      vm."providerKey" AS "mappingProviderKey",
      COALESCE((
        SELECT SUM(s."available")::int
        FROM "public"."ShopifyVariantLocationStock" s
        WHERE s."sourceType" = 'physical'
          AND s."locationId" = ANY(${LIQUIDATION_LOCATION_IDS}::text[])
          AND s."available" > 0
          AND NULLIF(LTRIM(s."gtin", '0'), '') IN (
            NULLIF(LTRIM(sv."gtin", '0'), ''),
            NULLIF(LTRIM(vm."gtin", '0'), '')
          )
      ), 0) AS "physicalQty"
    FROM "public"."SupplierVariant" sv
    LEFT JOIN "public"."VariantMapping" vm ON vm."supplierVariantId" = sv."supplierVariantId"
    WHERE sv."manualLock" = true
      AND sv."supplierVariantId" LIKE 'stx\\_%' ESCAPE '\\'
      AND (sv."manualNote" ILIKE 'restock:liquidation%' OR sv."manualNote" ILIKE 'phase4:liquidation%')
  `;

  const released: StaleLiquidationRelease[] = [];
  let kept = 0;
  const now = new Date();

  for (const row of rows) {
    if (!isPhysicalLiquidationLockNote(row.manualNote)) continue;
    if (Number(row.physicalQty) > 0) {
      kept += 1;
      continue;
    }

    const gtin = row.svGtin ?? row.mappingGtin ?? null;
    const restoreProviderKey = row.mappingProviderKey ?? (gtin ? `STX_${gtin}` : null);
    let restoredGtin = false;
    if (!row.svGtin && row.mappingGtin && restoreProviderKey) {
      const conflict = await prisma.supplierVariant.findFirst({
        where: {
          providerKey: restoreProviderKey,
          gtin: row.mappingGtin,
          NOT: { id: row.id },
        },
        select: { id: true },
      });
      restoredGtin = !conflict;
    }

    const data = buildLiquidationReleaseData({
      lastSyncAt: row.lastSyncAt,
      note: STALE_LIQUIDATION_RELEASE_NOTE,
      now,
    });
    if (!dryRun) {
      await prisma.supplierVariant.update({
        where: { id: row.id },
        data: {
          ...data,
          ...(restoredGtin ? { gtin: row.mappingGtin, providerKey: restoreProviderKey } : {}),
        },
      });
    }
    released.push({
      supplierVariantId: row.supplierVariantId,
      name: row.supplierProductName,
      size: row.sizeRaw,
      gtin,
      manualPrice: row.manualPrice != null ? Number(row.manualPrice) : null,
      restoredGtin,
      zeroedStaleStock: "stock" in data,
    });
  }

  if (released.length > 0) {
    console.warn("[LIQUIDATION][STALE-LOCK-SWEEP]", dryRun ? "dry-run" : "released", {
      count: released.length,
      released: released.map((r) => `${r.supplierVariantId} ${r.gtin ?? "no-gtin"} @${r.manualPrice}`),
    });
  }

  return { scanned: rows.length, kept, released, dryRun };
}
