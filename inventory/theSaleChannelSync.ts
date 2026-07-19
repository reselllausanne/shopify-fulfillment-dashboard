import { prisma } from "@/app/lib/prisma";
import { resolveAppOriginForPartnerJobs } from "@/app/lib/partnerJobOrigin";
import { runDecathlonStockSync } from "@/decathlon/mirakl/sync";
import { isTheWarehouseSupplierSku } from "@/galaxus/warehouse/lineInventorySource";
import { attachAvailableStock } from "@/inventory/availableStock";
import { delistShopifyByProviderKeys } from "@/shopify/restock/delistShopify";

function uniqueTheProviderKeys(keys: Array<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const raw of keys) {
    const key = String(raw ?? "").trim();
    if (!key || !isTheWarehouseSupplierSku(key)) continue;
    out.add(key);
  }
  return Array.from(out);
}

/** Full Galaxus StockData file (all rows) — platforms expect complete stock feed, not a single SKU. */
async function pushGalaxusFullStock(origin: string) {
  const url = `${origin}/api/galaxus/feeds/upload?type=stock&manual=1`;
  const routeModule = await import("@/app/api/galaxus/feeds/upload/route");
  const req = new Request(url, { method: "POST" });
  const res = await routeModule.POST(req);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error ?? `Galaxus stock upload failed (HTTP ${res.status})`);
  }
  return data;
}

async function markListingsAfterPush(providerKeys: string[]) {
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

  for (const variant of variants) {
    const providerKey = String(variant.providerKey ?? "").trim();
    const supplierVariantId = String(variant.supplierVariantId ?? "").trim();
    if (!providerKey || !supplierVariantId) continue;
    const available = stockById.get(supplierVariantId) ?? 0;
    const status = available <= 0 ? "SOLD_OUT" : "ACTIVE";

    for (const channel of ["GALAXUS", "DECATHLON"] as const) {
      await prismaAny.channelListingState.upsert({
        where: { channel_providerKey: { channel, providerKey } },
        create: {
          channel,
          providerKey,
          supplierVariantId,
          lastPushedStock: available,
          status,
          soldOutAt: available <= 0 ? now : null,
          lastSyncedAt: now,
          metadataJson: { source: "the-sale-channel-sync" },
        },
        update: {
          supplierVariantId,
          lastPushedStock: available,
          status,
          soldOutAt: available <= 0 ? now : null,
          lastSyncedAt: now,
          lastError: null,
          metadataJson: { source: "the-sale-channel-sync" },
        },
      });
    }
  }
}

/**
 * Full Decathlon STO01 + full Galaxus StockData push + local listing state mark.
 * Shared by both sale (delist) and restock (relist) flows. Does NOT touch Shopify.
 */
async function pushDecathlonAndGalaxus(
  providerKeys: string[],
  origin: string
): Promise<{ decathlon: unknown; galaxus: unknown; galaxusOk: boolean }> {
  const decathlon = await runDecathlonStockSync({ ensureProviderKeys: providerKeys });
  let galaxus: unknown = null;
  try {
    galaxus = await pushGalaxusFullStock(origin);
  } catch (err: any) {
    console.error("[INVENTORY][THE_CHANNEL_SYNC] Galaxus full stock push failed", {
      providerKeys,
      error: err?.message ?? err,
    });
    galaxus = { ok: false, error: err?.message ?? "Galaxus stock push failed" };
  }
  await markListingsAfterPush(providerKeys);
  const galaxusOk = !(galaxus && typeof galaxus === "object" && (galaxus as any).ok === false);
  return { decathlon, galaxus, galaxusOk };
}

/**
 * After a THE warehouse SALE: full Decathlon STO01 + full Galaxus StockData
 * + Shopify Bussigny stock zeroed (no product delete/archive).
 * Sold THE keys are ensured in the Decathlon delta (stock 0) even if offer sync row is missing.
 * Fire-and-forget from order ingest — failures are logged, not thrown to the caller.
 */
export async function syncChannelsAfterTheSale(params: {
  providerKeys: Array<string | null | undefined>;
  origin?: string | null;
}): Promise<{
  ok: boolean;
  providerKeys: string[];
  decathlon?: unknown;
  galaxus?: unknown;
  shopify?: unknown;
  error?: string;
}> {
  const providerKeys = uniqueTheProviderKeys(params.providerKeys);
  if (providerKeys.length === 0) {
    return { ok: true, providerKeys: [] };
  }

  const origin = resolveAppOriginForPartnerJobs(params.origin) ?? "http://127.0.0.1:3000";

  try {
    const { decathlon, galaxus, galaxusOk } = await pushDecathlonAndGalaxus(providerKeys, origin);

    let shopify: unknown = null;
    try {
      shopify = await delistShopifyByProviderKeys(providerKeys);
    } catch (err: any) {
      console.error("[INVENTORY][THE_SALE_SYNC] Shopify delist failed", {
        providerKeys,
        error: err?.message ?? err,
      });
      shopify = { ok: false, error: err?.message ?? "Shopify delist failed" };
    }

    const shopifyOk = !(shopify && typeof shopify === "object" && (shopify as any).ok === false);
    console.info("[INVENTORY][THE_SALE_SYNC] Done", {
      providerKeys,
      mode: "full-stock",
      decathlonOk: Boolean((decathlon as any)?.ok ?? true),
      galaxusOk,
      shopifyOk,
    });

    return { ok: galaxusOk && shopifyOk, providerKeys, decathlon, galaxus, shopify };
  } catch (error: any) {
    const message = error?.message ?? "THE sale channel sync failed";
    console.error("[INVENTORY][THE_SALE_SYNC]", { providerKeys, error: message });
    return { ok: false, providerKeys, error: message };
  }
}

/**
 * After a RETURN restock into the THE catalog: full Decathlon + Galaxus push
 * (stock now > 0 → relisted ACTIVE) + Shopify variant put on SALE at Bussigny.
 * Shopify leg: find variant by GTIN; if missing, create the full product first.
 * Fire-and-forget — failures logged, not thrown.
 */
export async function syncChannelsAfterTheRestock(params: {
  providerKeys: Array<string | null | undefined>;
  gtin?: string | null;
  salePrice?: number | null;
  quantity?: number;
  origin?: string | null;
}): Promise<{
  ok: boolean;
  providerKeys: string[];
  decathlon?: unknown;
  galaxus?: unknown;
  shopify?: unknown;
  error?: string;
}> {
  const providerKeys = uniqueTheProviderKeys(params.providerKeys);
  if (providerKeys.length === 0) {
    return { ok: true, providerKeys: [] };
  }

  const origin = resolveAppOriginForPartnerJobs(params.origin) ?? "http://127.0.0.1:3000";

  try {
    const { decathlon, galaxus, galaxusOk } = await pushDecathlonAndGalaxus(providerKeys, origin);

    let shopify: unknown = null;
    const gtin = String(params.gtin ?? "").trim();
    if (gtin) {
      try {
        // Lazy import avoids pulling the Shopify restock graph into order-ingest paths.
        const { applyScanRestock } = await import("@/shopify/restock/scanRestockOrchestrator");
        shopify = await applyScanRestock({
          gtin,
          quantity: params.quantity ?? 1,
          identifier: gtin, // resolve → create if the GTIN is not yet on Shopify
          salePrice: params.salePrice ?? null,
          dryRun: false,
        });
      } catch (err: any) {
        console.error("[INVENTORY][THE_RESTOCK_SYNC] Shopify sale push failed", {
          gtin,
          error: err?.message ?? err,
        });
        shopify = { ok: false, error: err?.message ?? "Shopify sale push failed" };
      }
    } else {
      shopify = { ok: false, error: "no gtin for Shopify sale" };
    }

    const shopifyOk = !(shopify && typeof shopify === "object" && (shopify as any).ok === false);
    console.info("[INVENTORY][THE_RESTOCK_SYNC] Done", {
      providerKeys,
      gtin,
      decathlonOk: Boolean((decathlon as any)?.ok ?? true),
      galaxusOk,
      shopifyOk,
    });

    return { ok: galaxusOk, providerKeys, decathlon, galaxus, shopify };
  } catch (error: any) {
    const message = error?.message ?? "THE restock channel sync failed";
    console.error("[INVENTORY][THE_RESTOCK_SYNC]", { providerKeys, error: message });
    return { ok: false, providerKeys, error: message };
  }
}

export function scheduleTheSaleChannelSync(params: {
  providerKeys: Array<string | null | undefined>;
  origin?: string | null;
}) {
  const keys = uniqueTheProviderKeys(params.providerKeys);
  if (keys.length === 0) return;
  void syncChannelsAfterTheSale({ providerKeys: keys, origin: params.origin }).catch((err) => {
    console.error("[INVENTORY][THE_SALE_SYNC] Unhandled", err);
  });
}

export function scheduleTheRestockChannelSync(params: {
  providerKeys: Array<string | null | undefined>;
  gtin?: string | null;
  salePrice?: number | null;
  quantity?: number;
  origin?: string | null;
}) {
  const keys = uniqueTheProviderKeys(params.providerKeys);
  if (keys.length === 0) return;
  void syncChannelsAfterTheRestock({
    providerKeys: keys,
    gtin: params.gtin,
    salePrice: params.salePrice,
    quantity: params.quantity,
    origin: params.origin,
  }).catch((err) => {
    console.error("[INVENTORY][THE_RESTOCK_SYNC] Unhandled", err);
  });
}
