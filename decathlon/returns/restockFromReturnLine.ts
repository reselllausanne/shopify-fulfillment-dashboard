import { prisma } from "@/app/lib/prisma";
import { validateGtin } from "@/app/lib/normalize";
import { resolveAppOriginForPartnerJobs } from "@/app/lib/partnerJobOrigin";
import { pushMarketplaceStockForProviderKeys } from "@/inventory/marketplaceStockSync";
import { ONLINE_LOCATION } from "@/shopify/inventory/locationConfig";
import { applyScanRestock } from "@/shopify/restock/scanRestockOrchestrator";
import {
  adjustInventoryAtLocation,
  findShopifyVariantByGtin,
  getInventoryAvailableAtLocation,
} from "@/shopify/restock/shopifyRestockInventory";

/**
 * Marketplace return → restock.
 *
 * STX offer: the pair comes back to us physically, so it is restocked onto the STX
 * SupplierVariant itself (manualLock + manualStock, which the STX price/stock sync
 * skips) and relisted everywhere. Previously this cloned the row into a `the_`
 * catalog id; that catalog no longer exists, so the clone had no live target.
 *
 * NER offer: partner stock we never hold — refund only, no restock, no relist.
 */

export function extractGtinFromOfferSku(offerSku: string | null): string | null {
  if (!offerSku) return null;
  const parts = offerSku.split("_");
  if (parts.length < 2) return null;
  const candidate = parts.slice(1).join("_").trim();
  return validateGtin(candidate) ? candidate : null;
}

export function roundToCents(value: number | null): number | null {
  if (!Number.isFinite(value as number)) return null;
  return Math.round((value as number) * 100) / 100;
}

/** Restock: new sell price = return/restock source price × this factor (25% off). */
export const RESTOCK_PRICE_FROM_LAST = 0.75;

export type ReturnOfferKind = "STX" | "NER" | "OTHER";

export function classifyReturnOffer(offerSku: string | null | undefined): ReturnOfferKind {
  const value = String(offerSku ?? "").trim().toLowerCase();
  if (value.startsWith("stx_")) return "STX";
  if (value.startsWith("ner_") || value.startsWith("ner:")) return "NER";
  return "OTHER";
}

function resolveRestockSourcePrice(
  preferredPrice: number | null,
  fallbackPrice: number | null
): number | null {
  if (preferredPrice != null && Number.isFinite(preferredPrice) && preferredPrice > 0) {
    return preferredPrice;
  }
  if (fallbackPrice != null && Number.isFinite(fallbackPrice) && fallbackPrice > 0) {
    return fallbackPrice;
  }
  return null;
}

/** STX row behind this return (Mirakl offer SKU keys first, then GTIN). */
async function findStxSupplierVariantForOfferSku(offerSku: string) {
  const prismaAny = prisma as any;
  const raw = String(offerSku ?? "").trim();
  if (!raw) return null;

  const keys = Array.from(new Set([raw, raw.toUpperCase(), raw.toLowerCase()]));
  const byKey = await prismaAny.supplierVariant.findFirst({
    where: {
      AND: [
        {
          OR: keys.flatMap((k) => [
            { supplierVariantId: k },
            { supplierSku: k },
            { providerKey: k },
          ]),
        },
        { supplierVariantId: { startsWith: "stx_", mode: "insensitive" } },
      ],
    },
  });
  if (byKey) return byKey;

  const gtin = extractGtinFromOfferSku(raw);
  if (!gtin) return null;
  return prismaAny.supplierVariant.findFirst({
    where: { gtin, supplierVariantId: { startsWith: "stx_", mode: "insensitive" } },
    orderBy: { updatedAt: "desc" },
  });
}

export type ApplyReturnRestockResult = {
  applied: boolean;
  /** Why nothing was restocked (`ner_refund_only` is a normal outcome, not a failure). */
  reason?: "ner_refund_only" | "unsupported_offer" | "no_stx_variant" | "invalid_quantity";
  supplierVariantId?: string | null;
  providerKey?: string | null;
  gtin?: string | null;
  quantity?: number;
  /** Sell price written for the restocked pair (25% off the return price). */
  newPrice?: number | null;
};

export async function applyReturnRestock(params: {
  returnLine: any;
  orderLine: any | null;
  offerSku: string | null;
  basePrice: number | null;
}): Promise<ApplyReturnRestockResult> {
  const offerSkuRaw = String(params.offerSku ?? "").trim();
  const kind = classifyReturnOffer(offerSkuRaw);

  // Partner pair never enters our stock: the customer is refunded, nothing to relist.
  if (kind === "NER") return { applied: false, reason: "ner_refund_only" };
  if (kind !== "STX") return { applied: false, reason: "unsupported_offer" };

  const quantity = Math.trunc(Number(params.returnLine?.quantity ?? 0));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { applied: false, reason: "invalid_quantity" };
  }

  const stxRow = await findStxSupplierVariantForOfferSku(offerSkuRaw);
  if (!stxRow?.supplierVariantId) return { applied: false, reason: "no_stx_variant" };

  const restockSourcePrice = resolveRestockSourcePrice(
    params.basePrice,
    Number(stxRow.price ?? 0)
  );
  const restockPrice =
    restockSourcePrice != null
      ? roundToCents(restockSourcePrice * RESTOCK_PRICE_FROM_LAST)
      : null;

  // manualStock (not stock) holds the physical count: the STX sync overwrites `stock`
  // with StockX availability but skips manualLock rows, and marketplace availability
  // reads manualStock when locked — so only the pair we hold is offered at this price.
  const currentManual = Number(stxRow.manualStock ?? 0);
  const nextManual = Math.max(0, (Number.isFinite(currentManual) ? currentManual : 0) + quantity);

  const data: Record<string, unknown> = {
    manualLock: true,
    manualStock: nextManual,
    manualUpdatedAt: new Date(),
    manualNote: `return-restock:stx qty=${nextManual}`,
    lastSyncAt: new Date(),
  };
  if (restockPrice != null && restockPrice > 0) data.manualPrice = restockPrice;

  await (prisma as any).supplierVariant.update({
    where: { supplierVariantId: stxRow.supplierVariantId },
    data,
  });

  return {
    applied: true,
    supplierVariantId: String(stxRow.supplierVariantId),
    providerKey: stxRow.providerKey ? String(stxRow.providerKey) : null,
    gtin: stxRow.gtin ? String(stxRow.gtin) : null,
    quantity,
    newPrice: restockPrice != null && restockPrice > 0 ? restockPrice : null,
  };
}

/**
 * While a returned pair is on sale at a discount, the StockX dropship copy at the
 * online location must not be buyable — one variant carries one price, so leaving it
 * would sell a pair we do not own at the restock discount.
 */
async function zeroDropshipCopyForGtin(gtin: string): Promise<string[]> {
  const warnings: string[] = [];
  const onlineId = ONLINE_LOCATION?.id;
  if (!onlineId) return warnings;

  try {
    const { match } = await findShopifyVariantByGtin(gtin);
    if (!match?.inventoryItemId) return warnings;
    const available =
      (await getInventoryAvailableAtLocation({
        inventoryItemId: match.inventoryItemId,
        locationId: onlineId,
      })) ?? 0;
    if (available <= 0) return warnings;

    await adjustInventoryAtLocation({
      inventoryItemId: match.inventoryItemId,
      locationId: onlineId,
      delta: -available,
      idempotencyKey: `return-restock-zero-online:${gtin}:${available}`,
      reason: "correction",
      referenceDocumentUri: `gid://resell-lausanne/ReturnRestock/${gtin}`,
    });
  } catch (err: any) {
    warnings.push(`online-copy zero failed: ${err?.message ?? err}`);
  }
  return warnings;
}

/**
 * Relist a restocked STX pair: Shopify sale at a physical location (product created
 * when missing), dropship copy zeroed, then marketplace stock pushed.
 */
export async function syncChannelsAfterStxReturnRestock(params: {
  providerKey?: string | null;
  gtin?: string | null;
  salePrice?: number | null;
  quantity?: number;
  origin?: string | null;
}): Promise<{ ok: boolean; warnings: string[] }> {
  const warnings: string[] = [];
  const gtin = String(params.gtin ?? "").trim();
  const origin = resolveAppOriginForPartnerJobs(params.origin);

  if (gtin) {
    try {
      const shopify = await applyScanRestock({
        gtin,
        quantity: Math.max(1, Math.trunc(Number(params.quantity ?? 1))),
        identifier: gtin,
        salePrice: params.salePrice ?? null,
        dryRun: false,
      });
      if (!shopify.ok) warnings.push(`Shopify restock failed: ${shopify.error ?? "unknown"}`);
    } catch (err: any) {
      warnings.push(`Shopify restock failed: ${err?.message ?? err}`);
    }
    warnings.push(...(await zeroDropshipCopyForGtin(gtin)));
  } else {
    warnings.push("no gtin — Shopify leg skipped");
  }

  const push = await pushMarketplaceStockForProviderKeys({
    providerKeys: [params.providerKey ?? null],
    origin,
  });
  if (!push.ok) {
    warnings.push(
      `marketplace stock push not fully ok: ${push.decathlon?.error ?? push.galaxus?.error ?? "see logs"}`
    );
  }

  console.info("[DECATHLON][RETURNS][RESTOCK] channels synced", {
    providerKey: params.providerKey ?? null,
    gtin: gtin || null,
    salePrice: params.salePrice ?? null,
    warnings,
  });

  return { ok: warnings.length === 0, warnings };
}

export function scheduleStxReturnRestockChannelSync(params: {
  providerKey?: string | null;
  gtin?: string | null;
  salePrice?: number | null;
  quantity?: number;
  origin?: string | null;
}): void {
  void syncChannelsAfterStxReturnRestock(params).catch((err) => {
    console.error("[DECATHLON][RETURNS][RESTOCK] unhandled", err);
  });
}
