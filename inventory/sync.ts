import { runDecathlonPriceSync, runDecathlonStockSync } from "@/decathlon/mirakl/sync";
import { requestFeedPush } from "@/galaxus/ops/feedPipeline";
import { attachAvailableStock } from "@/inventory/availableStock";
import { prisma } from "@/app/lib/prisma";
import { runShopifyOrdersSync } from "@/shopify/orders/sync";
import { syncShopifyCatalog } from "@/shopify/catalog/sync";
import { refreshChannelListingSnapshots } from "./listingSnapshot";

type MultiChannelSyncOptions = {
  origin?: string;
  dryRun?: boolean;
  shopifyCatalogLimit?: number;
  runCatalog?: boolean;
};

type InventoryReconcileOptions = {
  limit?: number;
};

function resolveOrigin(input?: string): string {
  const explicit = String(input ?? "").trim();
  if (explicit) return explicit;
  const envOrigin =
    String(process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "").trim() ||
    "http://localhost:3000";
  return envOrigin.replace(/\/$/, "");
}

async function startInventoryRun(jobKey: string, dryRun: boolean) {
  const prismaAny = prisma as any;
  if (!prismaAny.inventorySyncRun?.create) return null;
  try {
    return await prismaAny.inventorySyncRun.create({
      data: {
        jobKey,
        dryRun,
        status: "RUNNING",
      },
    });
  } catch (error) {
    console.warn("[INVENTORY][SYNC] Failed creating run row", { jobKey, error });
    return null;
  }
}

async function finishInventoryRun(input: {
  runId: string | null | undefined;
  status: "SUCCESS" | "FAILED";
  summaryJson?: unknown;
  error?: string | null;
}) {
  if (!input.runId) return;
  const prismaAny = prisma as any;
  if (!prismaAny.inventorySyncRun?.update) return;
  try {
    await prismaAny.inventorySyncRun.update({
      where: { id: input.runId },
      data: {
        status: input.status,
        finishedAt: new Date(),
        summaryJson: input.summaryJson ?? null,
        error: input.error ?? null,
      },
    });
  } catch (error) {
    console.warn("[INVENTORY][SYNC] Failed updating run row", {
      runId: input.runId,
      error,
    });
  }
}

export async function runMultiChannelStockSync(options: MultiChannelSyncOptions = {}) {
  const dryRun = options.dryRun ?? String(process.env.MULTICHANNEL_SYNC_DRY_RUN ?? "0") === "1";
  const runCatalog =
    options.runCatalog ??
    String(process.env.MULTICHANNEL_ENABLE_CATALOG_SYNC ?? "0").trim() === "1";
  const origin = resolveOrigin(options.origin);
  const startedAt = new Date();
  const run = await startInventoryRun("multichannel-stock-sync", dryRun);

  try {
    const shopifyOrders = await runShopifyOrdersSync({
      pageSize: 100,
    });
    const shopifyCatalog = runCatalog
      ? await syncShopifyCatalog({
          limit: options.shopifyCatalogLimit ?? 1000,
          dryRun,
          missingOnly: true,
          inStockOnly: true,
        })
      : null;

    let decathlonStock: unknown = null;
    let decathlonPrice: unknown = null;
    let galaxusFeed: unknown = null;
    let listingSnapshots: unknown = null;

    if (!dryRun) {
      decathlonStock = await runDecathlonStockSync();
      decathlonPrice = await runDecathlonPriceSync();
      galaxusFeed = await requestFeedPush({
        origin,
        scope: "stock-price",
        triggerSource: "inventory-sync",
        runNow: true,
      });
      listingSnapshots = await refreshChannelListingSnapshots(["DECATHLON", "GALAXUS"]);
    }

    const payload = {
      ok: true,
      runId: run?.id ?? null,
      dryRun,
      runCatalog,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      shopifyOrders,
      shopifyCatalog,
      decathlonStock,
      decathlonPrice,
      galaxusFeed,
      listingSnapshots,
    };
    await finishInventoryRun({
      runId: run?.id,
      status: "SUCCESS",
      summaryJson: payload,
    });
    return payload;
  } catch (error: any) {
    const message = error?.message ?? "Multi-channel stock sync failed";
    await finishInventoryRun({
      runId: run?.id,
      status: "FAILED",
      error: message,
      summaryJson: { dryRun, origin },
    });
    throw error;
  }
}

export async function runInventoryReconciliation(options: InventoryReconcileOptions = {}) {
  const run = await startInventoryRun("inventory-reconcile", false);
  try {
    const limitRaw = Number(options.limit ?? 2000);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.trunc(limitRaw), 1), 10000)
      : 2000;
    const prismaAny = prisma as any;
    const rows = await prismaAny.channelListingState.findMany({
      where: {},
      orderBy: [{ updatedAt: "desc" }],
      take: limit,
      select: {
        channel: true,
        providerKey: true,
        supplierVariantId: true,
        lastPushedStock: true,
        status: true,
        externalProductId: true,
        externalVariantId: true,
        updatedAt: true,
        supplierVariant: {
          select: {
            supplierVariantId: true,
            stock: true,
            manualStock: true,
            manualLock: true,
          },
        },
      },
    });

    const variants = rows
      .map((row: any) => row?.supplierVariant)
      .filter((variant: any) => Boolean(variant));
    const stockBySupplierVariantId = await attachAvailableStock(variants);
    const drifts: Array<{
      channel: string;
      providerKey: string;
      supplierVariantId: string | null;
      listingStock: number | null;
      dbAvailableStock: number | null;
      delta: number | null;
      status: string | null;
    }> = [];

    for (const row of rows) {
      const supplierVariantId = String(row?.supplierVariantId ?? "").trim() || null;
      const dbAvailable =
        supplierVariantId && stockBySupplierVariantId.has(supplierVariantId)
          ? stockBySupplierVariantId.get(supplierVariantId) ?? null
          : null;
      const listingStock =
        row?.lastPushedStock === null || row?.lastPushedStock === undefined
          ? null
          : Number(row.lastPushedStock);

      const isDrift =
        listingStock !== null &&
        dbAvailable !== null &&
        Number.isFinite(listingStock) &&
        Number.isFinite(dbAvailable) &&
        listingStock !== dbAvailable;
      if (!isDrift) continue;
      drifts.push({
        channel: String(row.channel),
        providerKey: String(row.providerKey),
        supplierVariantId,
        listingStock,
        dbAvailableStock: dbAvailable,
        delta: dbAvailable - listingStock,
        status: row?.status ?? null,
      });
    }

    const byChannel = drifts.reduce<Record<string, number>>((acc, row) => {
      acc[row.channel] = (acc[row.channel] ?? 0) + 1;
      return acc;
    }, {});

    if (run?.id) {
      const prismaAny = prisma as any;
      if (prismaAny.inventoryReconcileDrift?.createMany && drifts.length > 0) {
        await prismaAny.inventoryReconcileDrift.createMany({
          data: drifts.map((row) => ({
            runId: run.id,
            channel: row.channel,
            providerKey: row.providerKey,
            supplierVariantId: row.supplierVariantId,
            listingStock: row.listingStock,
            dbAvailableStock: row.dbAvailableStock,
            delta: row.delta,
            status: row.status,
          })),
        });
      }
    }

    const payload = {
      ok: true,
      runId: run?.id ?? null,
      scanned: rows.length,
      driftCount: drifts.length,
      byChannel,
      drifts,
    };
    await finishInventoryRun({
      runId: run?.id,
      status: "SUCCESS",
      summaryJson: {
        scanned: rows.length,
        driftCount: drifts.length,
        byChannel,
      },
    });
    return payload;
  } catch (error: any) {
    await finishInventoryRun({
      runId: run?.id,
      status: "FAILED",
      error: error?.message ?? "Inventory reconciliation failed",
    });
    throw error;
  }
}
