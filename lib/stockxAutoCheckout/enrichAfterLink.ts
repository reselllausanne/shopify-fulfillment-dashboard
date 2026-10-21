import { prisma } from "@/app/lib/prisma";
import { hashStockXStates } from "@/app/lib/stockxTracking";
import {
  applyStockxDetailsToDecathlonMatchFields,
  resolveStockxBuyForManualGalaxus,
  type DecathlonManualStockxEnrichResult,
} from "@/decathlon/stx/manualStockxEnrich";
import type { StockxBuyingNode } from "@/galaxus/stx/stockxClient";
import { fetchStockxBuyOrderDetailsFull } from "@/galaxus/stx/stockxClient";

export type OrderMatchEnrichPatch = {
  stockxChainId: string | null;
  stockxOrderId: string | null;
  stockxOrderNumber: string | null;
  stockxProductName: string | null;
  stockxSkuKey: string | null;
  stockxSizeEU: string | null;
  stockxPurchaseDate: Date | null;
  stockxStatus: string | null;
  stockxEstimatedDelivery: Date | null;
  stockxLatestEstimatedDelivery: Date | null;
  stockxAwb: string | null;
  stockxTrackingUrl: string | null;
  stockxCheckoutType: string | null;
  stockxStates: unknown;
  stockxStatesHash: string | null;
  stockxStatesUpdatedAt: Date | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Map StockX list+details → OrderMatch tracking columns (same shape matching enrich uses).
 * Pure — safe to unit test without Prisma/network.
 */
export function buildOrderMatchEnrichPatchFromStockx(
  listNode: StockxBuyingNode | null | undefined,
  details: Awaited<ReturnType<typeof fetchStockxBuyOrderDetailsFull>>
): OrderMatchEnrichPatch | null {
  const fields = applyStockxDetailsToDecathlonMatchFields(listNode, details, {
    matchReasons: ["STOCKX_AUTO_CHECKOUT_ENRICH"],
  });
  const chainId = String(fields.stockxChainId ?? "").trim() || null;
  const orderId = String(fields.stockxOrderId ?? "").trim() || null;
  if (!chainId || !orderId) return null;

  const states = fields.stockxStates ?? null;
  const statesHash = hashStockXStates(states as any) || null;

  return {
    stockxChainId: chainId,
    stockxOrderId: orderId,
    stockxOrderNumber: fields.stockxOrderNumber,
    stockxProductName: fields.stockxProductName,
    stockxSkuKey: fields.stockxSkuKey,
    stockxSizeEU: fields.stockxSizeEU,
    stockxPurchaseDate: fields.stockxPurchaseDate,
    stockxStatus: fields.stockxStatus,
    stockxEstimatedDelivery: fields.stockxEstimatedDelivery,
    stockxLatestEstimatedDelivery: fields.stockxLatestEstimatedDelivery,
    stockxAwb: fields.stockxAwb,
    stockxTrackingUrl: fields.stockxTrackingUrl,
    stockxCheckoutType: fields.stockxCheckoutType,
    stockxStates: states,
    stockxStatesHash: statesHash,
    stockxStatesUpdatedAt: statesHash ? new Date() : null,
  };
}

export function buildOrderMatchEnrichPatchFromResolve(
  resolved: Extract<DecathlonManualStockxEnrichResult, { ok: true }>
): OrderMatchEnrichPatch | null {
  return buildOrderMatchEnrichPatchFromStockx(resolved.listNode, resolved.details);
}

/**
 * Resolve StockX buy by order number (03-…) across dashboard/Galaxus tokens.
 * Retries briefly — buy can lag the Pro buying list right after checkout.
 */
export async function resolveStockxBuyForShopifyEnrich(
  stockxOrderNumber: string,
  options?: { attempts?: number; delayMs?: number }
): Promise<DecathlonManualStockxEnrichResult> {
  const attempts = Math.min(Math.max(options?.attempts ?? 3, 1), 6);
  const delayMs = Math.min(Math.max(options?.delayMs ?? 2000, 0), 10_000);
  let last: DecathlonManualStockxEnrichResult = { ok: false, reason: "empty_order_number" };
  for (let i = 0; i < attempts; i++) {
    last = await resolveStockxBuyForManualGalaxus(stockxOrderNumber);
    if (last.ok) return last;
    if (i < attempts - 1 && delayMs > 0) await sleep(delayMs);
  }
  return last;
}

/**
 * After auto-checkout link: fill stockxChainId / stockxOrderId / stockxStates
 * so AWB cron can track + send milestone emails. Does NOT send customer email.
 */
export async function enrichOrderMatchFromStockxOrderNumber(opts: {
  orderMatchId: string;
  stockxOrderNumber: string;
}): Promise<{ ok: boolean; reason: string; patch: OrderMatchEnrichPatch | null }> {
  const orderMatchId = String(opts.orderMatchId || "").trim();
  const stockxOrderNumber = String(opts.stockxOrderNumber || "").trim();
  if (!orderMatchId || !stockxOrderNumber) {
    return { ok: false, reason: "missing_ids", patch: null };
  }

  const resolved = await resolveStockxBuyForShopifyEnrich(stockxOrderNumber);
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason, patch: null };
  }

  const patch = buildOrderMatchEnrichPatchFromResolve(resolved);
  if (!patch) {
    return { ok: false, reason: "missing_chain_or_order_id", patch: null };
  }

  await prisma.orderMatch.update({
    where: { id: orderMatchId },
    data: {
      stockxChainId: patch.stockxChainId,
      stockxOrderId: patch.stockxOrderId,
      ...(patch.stockxOrderNumber ? { stockxOrderNumber: patch.stockxOrderNumber } : {}),
      ...(patch.stockxProductName ? { stockxProductName: patch.stockxProductName } : {}),
      ...(patch.stockxSkuKey ? { stockxSkuKey: patch.stockxSkuKey } : {}),
      ...(patch.stockxSizeEU ? { stockxSizeEU: patch.stockxSizeEU } : {}),
      ...(patch.stockxPurchaseDate ? { stockxPurchaseDate: patch.stockxPurchaseDate } : {}),
      ...(patch.stockxStatus ? { stockxStatus: patch.stockxStatus } : {}),
      ...(patch.stockxEstimatedDelivery
        ? { stockxEstimatedDelivery: patch.stockxEstimatedDelivery }
        : {}),
      ...(patch.stockxLatestEstimatedDelivery
        ? { stockxLatestEstimatedDelivery: patch.stockxLatestEstimatedDelivery }
        : {}),
      ...(patch.stockxAwb ? { stockxAwb: patch.stockxAwb } : {}),
      ...(patch.stockxTrackingUrl ? { stockxTrackingUrl: patch.stockxTrackingUrl } : {}),
      ...(patch.stockxCheckoutType ? { stockxCheckoutType: patch.stockxCheckoutType } : {}),
      ...(patch.stockxStatesHash
        ? {
            stockxStates: patch.stockxStates as object,
            stockxStatesHash: patch.stockxStatesHash,
            stockxStatesUpdatedAt: patch.stockxStatesUpdatedAt,
          }
        : {}),
    },
  });

  return { ok: true, reason: "enriched", patch };
}
