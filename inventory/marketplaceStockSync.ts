import { prisma } from "@/app/lib/prisma";
import { resolveAppOriginForPartnerJobs } from "@/app/lib/partnerJobOrigin";
import { isDecathlonSalesPaused } from "@/decathlon/exports/catalogPolicy";
import { runDecathlonStockSync } from "@/decathlon/mirakl/sync";
import { startFeedPushAsync } from "@/galaxus/ops/feedPipelineCore";
import { patchFeedSnapshotsForProviderKeys } from "@/galaxus/exports/feedSnapshot";
import { attachAvailableStock } from "@/inventory/availableStock";

/**
 * Push marketplace stock for any supplier key after a physical stock change.
 *
 * Replaces the THE-only channel sync: that path filtered its input down to `THE_`
 * provider keys and returned early, so for STX/NER keys nothing was pushed and the
 * marketplaces only learned about a sell-out at the next scheduled feed.
 *
 * Galaxus goes through the feed queue (never inline SFTP on a request), Decathlon
 * STO01 runs directly with the changed keys force-included.
 */
export type MarketplaceStockSyncResult = {
  ok: boolean;
  providerKeys: string[];
  decathlon?: { ok: boolean; error?: string };
  galaxus?: { ok: boolean; queued?: boolean; accepted?: boolean; runId?: string; error?: string };
  listingsMarked: number;
};

function cleanKeys(keys: Array<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const raw of keys) {
    const key = String(raw ?? "").trim();
    // Hand-stock listings have no SupplierVariant / marketplace offer behind them.
    if (!key || key.startsWith("SHOPIFY_HAND_")) continue;
    out.add(key);
  }
  return Array.from(out);
}

/** Keep ChannelListingState in step with the stock we just pushed. */
async function markListings(providerKeys: string[]): Promise<number> {
  const prismaAny = prisma as any;
  const variants = await prismaAny.supplierVariant.findMany({
    where: { providerKey: { in: providerKeys } },
    select: {
      providerKey: true,
      supplierVariantId: true,
      stock: true,
      manualStock: true,
      manualLock: true,
    },
  });
  const stockById = await attachAvailableStock(variants);
  const now = new Date();
  let marked = 0;

  for (const variant of variants) {
    const providerKey = String(variant.providerKey ?? "").trim();
    const supplierVariantId = String(variant.supplierVariantId ?? "").trim();
    if (!providerKey || !supplierVariantId) continue;
    const available = stockById.get(supplierVariantId) ?? 0;

    for (const channel of ["GALAXUS", "DECATHLON"] as const) {
      // Decathlon sales halt: never mark DECATHLON listings live from inventory push.
      const decathlonPaused = channel === "DECATHLON" && isDecathlonSalesPaused();
      const pushedStock = decathlonPaused ? 0 : available;
      const listingStatus = decathlonPaused || available <= 0 ? "SOLD_OUT" : "ACTIVE";
      await prismaAny.channelListingState.upsert({
        where: { channel_providerKey: { channel, providerKey } },
        create: {
          channel,
          providerKey,
          supplierVariantId,
          lastPushedStock: pushedStock,
          status: listingStatus,
          soldOutAt: pushedStock <= 0 ? now : null,
          lastSyncedAt: now,
          metadataJson: { source: "marketplace-stock-sync" },
        },
        update: {
          supplierVariantId,
          lastPushedStock: pushedStock,
          status: listingStatus,
          soldOutAt: pushedStock <= 0 ? now : null,
          lastSyncedAt: now,
          lastError: null,
          metadataJson: { source: "marketplace-stock-sync" },
        },
      });
      marked += 1;
    }
  }

  return marked;
}

export function scheduleMarketplaceStockPush(params: {
  providerKeys: Array<string | null | undefined>;
  origin?: string | null;
}): void {
  if (cleanKeys(params.providerKeys).length === 0) return;
  void pushMarketplaceStockForProviderKeys(params).catch((err) => {
    console.error("[inventory][marketplace-stock-sync] unhandled", err);
  });
}

export async function pushMarketplaceStockForProviderKeys(params: {
  providerKeys: Array<string | null | undefined>;
  origin?: string | null;
}): Promise<MarketplaceStockSyncResult> {
  const providerKeys = cleanKeys(params.providerKeys);
  if (providerKeys.length === 0) {
    return { ok: true, providerKeys: [], listingsMarked: 0 };
  }

  const origin = resolveAppOriginForPartnerJobs(params.origin) ?? "http://127.0.0.1:3000";
  const out: MarketplaceStockSyncResult = { ok: true, providerKeys, listingsMarked: 0 };

  try {
    await patchFeedSnapshotsForProviderKeys({ origin, providerKeys });
  } catch (err: any) {
    console.warn("[inventory][marketplace-stock-sync] snapshot patch failed", {
      providerKeys,
      error: err?.message ?? err,
    });
  }

  try {
    if (isDecathlonSalesPaused()) {
      out.decathlon = { ok: true, error: "decathlon_sales_permanently_disabled" };
    } else {
      await runDecathlonStockSync({ ensureProviderKeys: providerKeys });
      out.decathlon = { ok: true };
    }
  } catch (err: any) {
    out.ok = false;
    out.decathlon = { ok: false, error: err?.message ?? String(err) };
    console.error("[inventory][marketplace-stock-sync] Decathlon STO01 failed", {
      providerKeys,
      error: err?.message ?? err,
    });
  }

  try {
    const started = await startFeedPushAsync({
      origin,
      scope: "stock",
      triggerSource: "inventory-sync",
    });
    out.galaxus = {
      ok: started.ok,
      queued: started.queued,
      accepted: started.accepted,
      runId: started.runId,
      error: started.error,
    };
    if (!started.ok) out.ok = false;
  } catch (err: any) {
    out.ok = false;
    out.galaxus = { ok: false, error: err?.message ?? String(err) };
    console.error("[inventory][marketplace-stock-sync] Galaxus stock push failed", {
      providerKeys,
      error: err?.message ?? err,
    });
  }

  try {
    out.listingsMarked = await markListings(providerKeys);
  } catch (err: any) {
    console.warn("[inventory][marketplace-stock-sync] listing mark failed", {
      providerKeys,
      error: err?.message ?? err,
    });
  }

  console.info("[inventory][marketplace-stock-sync] done", {
    providerKeys,
    decathlonOk: out.decathlon?.ok ?? null,
    galaxusOk: out.galaxus?.ok ?? null,
    listingsMarked: out.listingsMarked,
  });

  return out;
}
