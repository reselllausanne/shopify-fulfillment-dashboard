import { prisma } from "@/app/lib/prisma";
import { resolveShopifyStxListingProviderKey } from "@/galaxus/supplier/providerKey";
import {
  computeStxSellPrices,
  syncShopifyStxPricesForGtins,
  syncShopifyStxPricesForSupplierVariantIds,
} from "@/shopify/stx/syncShopifyStxPrices";

const MAPPING_FAILURE_REASONS = new Set([
  "no_shopify_variant",
  "no_shopify_variant_by_size",
  "ambiguous_shopify_variant",
  "no_kickdb_handle",
]);

export type PlannedShopifyStxSyncResult = {
  offered: number;
  needsPush: number;
  unchanged: number;
  gtinsSynced: string[];
  pendingSynced: string[];
  hadMappingFailures: boolean;
  shopify: {
    synced: number;
    skipped: number;
    failed: number;
  };
};

function priceNeedsPush(computed: number | null, lastPushed: number | null): boolean {
  if (computed == null || !(computed > 0)) return false;
  if (lastPushed == null || !Number.isFinite(lastPushed)) return true;
  return Math.abs(lastPushed - computed) >= 0.005;
}

async function readLastPushedForRow(input: {
  providerKey: string | null;
  gtin: string | null;
  supplierVariantId: string;
}): Promise<number | null> {
  const key = resolveShopifyStxListingProviderKey(input);
  if (!key) return null;
  const cls = (prisma as any).channelListingState;
  if (!cls?.findUnique) return null;
  try {
    const row = await cls.findUnique({
      where: { channel_providerKey: { channel: "SHOPIFY", providerKey: key } },
      select: { lastPushedPrice: true },
    });
    const v = row?.lastPushedPrice == null ? null : Number(row.lastPushedPrice);
    return Number.isFinite(v as number) ? (v as number) : null;
  } catch {
    return null;
  }
}

/**
 * SSE / ingest path: DB is always updated first; Shopify gets a write only when
 * the locked sell price moved vs last push (zero GraphQL when unchanged).
 */
export async function filterSupplierVariantsNeedingShopifyPricePush(
  supplierVariantIds: string[]
): Promise<{
  gtins: string[];
  pendingNoGtin: string[];
  unchanged: number;
}> {
  const ids = Array.from(
    new Set(
      supplierVariantIds.map((id) => String(id ?? "").trim()).filter((id) => id.startsWith("stx_"))
    )
  );
  const gtins: string[] = [];
  const pendingNoGtin: string[] = [];
  let unchanged = 0;

  for (const supplierVariantId of ids) {
    const row = await prisma.supplierVariant.findFirst({
      where: { supplierVariantId },
      select: {
        supplierVariantId: true,
        providerKey: true,
        gtin: true,
        manualLock: true,
        stock: true,
        deliveryType: true,
        price: true,
        standardBuyPrice: true,
        expressBuyPrice: true,
        supplierProductName: true,
        supplierBrand: true,
        mappings: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: { kickdbVariant: { select: { product: { select: { urlKey: true } } } } },
        },
      },
    });
    if (!row || row.manualLock || !(Number(row.stock) > 0)) continue;

    const handle = row.mappings?.[0]?.kickdbVariant?.product?.urlKey ?? null;
    const { normalSell } = computeStxSellPrices({
      stxRow: {
        deliveryType: row.deliveryType ?? null,
        price: row.price,
        standardBuyPrice: row.standardBuyPrice,
        expressBuyPrice: row.expressBuyPrice,
        supplierProductName: row.supplierProductName ?? null,
        supplierBrand: row.supplierBrand ?? null,
      },
      productHandle: handle,
    });

    const lastPushed = await readLastPushedForRow({
      providerKey: row.providerKey,
      gtin: row.gtin,
      supplierVariantId: row.supplierVariantId,
    });

    if (!priceNeedsPush(normalSell, lastPushed)) {
      unchanged += 1;
      continue;
    }

    if (row.gtin) gtins.push(String(row.gtin));
    else pendingNoGtin.push(row.supplierVariantId);
  }

  return { gtins, pendingNoGtin, unchanged };
}

export async function runPlannedShopifyStxPriceSyncForSupplierVariantIds(
  supplierVariantIds: string[]
): Promise<PlannedShopifyStxSyncResult> {
  const offered = supplierVariantIds.length;
  const { gtins, pendingNoGtin, unchanged } =
    await filterSupplierVariantsNeedingShopifyPricePush(supplierVariantIds);

  let synced = 0;
  let skipped = 0;
  let failed = 0;
  let hadMappingFailures = false;

  if (gtins.length > 0) {
    const r = await syncShopifyStxPricesForGtins(Array.from(new Set(gtins)));
    synced += r.synced;
    skipped += r.skipped;
    failed += r.failed;
    for (const row of r.results) {
      if (row.ok) continue;
      if (row.reason && MAPPING_FAILURE_REASONS.has(row.reason)) hadMappingFailures = true;
    }
  }
  if (pendingNoGtin.length > 0) {
    const r = await syncShopifyStxPricesForSupplierVariantIds(
      Array.from(new Set(pendingNoGtin))
    );
    synced += r.synced;
    skipped += r.skipped;
    failed += r.failed;
    for (const row of r.results) {
      if (row.ok) continue;
      if (row.reason && MAPPING_FAILURE_REASONS.has(row.reason)) hadMappingFailures = true;
    }
  }

  return {
    offered,
    needsPush: gtins.length + pendingNoGtin.length,
    unchanged,
    gtinsSynced: gtins,
    pendingSynced: pendingNoGtin,
    hadMappingFailures,
    shopify: { synced, skipped, failed },
  };
}

/** Python consumer fallback when TS cannot map a Shopify variant. */
export async function bumpKickdbRawFetchedAtForPythonRetry(
  kickdbProductId: string
): Promise<void> {
  const id = String(kickdbProductId ?? "").trim();
  if (!id) return;
  await prisma.kickDBProduct.updateMany({
    where: { kickdbProductId: id },
    data: { rawFetchedAt: new Date(), updatedAt: new Date() },
  });
}

export function isTcgPriorityProductName(name: string | null | undefined): boolean {
  const t = String(name ?? "").toLowerCase();
  return /\b(pokemon|pokémon|tcg|trading card|booster box|booster pack|elite trainer)\b/.test(t);
}
