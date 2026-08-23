import { createLimiter } from "@/galaxus/jobs/bulkSql";
import { prisma } from "@/app/lib/prisma";
import { resolveStockxBuyByOrderNumberWithToken } from "@/decathlon/stx/manualStockxEnrich";
import { fetchStockxBuyOrderDetailsFull } from "@/galaxus/stx/stockxClient";
import { extractAwbFromTrackingUrl } from "@/app/lib/stockxTracking";

export type LinkedStxUnitRefreshStats = {
  eligible: number;
  attempted: number;
  refreshed: number;
  awbBackfilled: number;
  etaBackfilled: number;
  settledBackfilled: number;
  failed: number;
  skipped: number;
  failures: Array<{ unitId: string; stockxOrderId: string; reason: string }>;
};

type LinkedUnitRow = {
  id: string;
  stockxOrderId: string | null;
  stockxOrderNumber: string | null;
  awb: string | null;
  etaMin: Date | null;
  etaMax: Date | null;
  stockxSettledAmount: unknown;
  checkoutType: string | null;
};

function trimStr(v: unknown): string {
  return String(v ?? "").trim();
}

function resolveAwbFromDetails(
  details: Awaited<ReturnType<typeof fetchStockxBuyOrderDetailsFull>> | null
): string | null {
  const direct = trimStr(details?.awb);
  if (direct) return direct;
  const trackingUrl = details?.order?.shipping?.shipment?.trackingUrl ?? null;
  return extractAwbFromTrackingUrl(trackingUrl);
}

/** True when unit already has a StockX buy id/number we can re-query (any buying state). */
export function stxUnitEligibleForStoredRefRefresh(unit: {
  stockxOrderId?: string | null;
  stockxOrderNumber?: string | null;
}): boolean {
  const oid = trimStr(unit.stockxOrderId);
  if (oid) return true;
  const onum = trimStr(unit.stockxOrderNumber);
  if (!onum) return false;
  if (/^MANUAL-/i.test(onum)) return false;
  return true;
}

/** True when AWB / ETA / settled / checkout still missing on a linked unit. */
export function stxUnitNeedsStockxRefresh(unit: {
  awb?: string | null;
  etaMin?: Date | null;
  etaMax?: Date | null;
  stockxSettledAmount?: unknown;
  checkoutType?: string | null;
}): boolean {
  if (!trimStr(unit.awb)) return true;
  if (!unit.etaMin || !unit.etaMax) return true;
  if (unit.stockxSettledAmount == null || !Number.isFinite(Number(unit.stockxSettledAmount))) {
    return true;
  }
  if (!trimStr(unit.checkoutType)) return true;
  return false;
}

async function resolveChainAndDetails(
  token: string,
  unit: LinkedUnitRow,
  chainIdHint: string | null
): Promise<
  | {
      ok: true;
      chainId: string;
      stockxOrderId: string;
      details: Awaited<ReturnType<typeof fetchStockxBuyOrderDetailsFull>>;
    }
  | { ok: false; reason: string }
> {
  const stockxOrderId = trimStr(unit.stockxOrderId);
  const chainHint = trimStr(chainIdHint);

  if (chainHint && stockxOrderId) {
    try {
      const details = await fetchStockxBuyOrderDetailsFull(token, {
        chainId: chainHint,
        orderId: stockxOrderId,
      });
      if (details?.order) {
        return { ok: true, chainId: chainHint, stockxOrderId, details };
      }
    } catch {
      // fall through to order-number lookup (works for shipped / non-PENDING buys)
    }
  }

  const lookupKey =
    trimStr(unit.stockxOrderNumber) ||
    stockxOrderId;
  if (!lookupKey || /^MANUAL-/i.test(lookupKey)) {
    return { ok: false, reason: "no_stockx_ref" };
  }

  const resolved = await resolveStockxBuyByOrderNumberWithToken(token, lookupKey);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };

  const chainId = trimStr(resolved.listNode.chainId);
  const orderId = trimStr(resolved.listNode.orderId) || stockxOrderId;
  if (!chainId || !orderId) return { ok: false, reason: "order_not_found_in_buying_list" };

  return { ok: true, chainId, stockxOrderId: orderId, details: resolved.details };
}

async function refreshOneLinkedUnit(
  token: string,
  unit: LinkedUnitRow,
  chainIdHint: string | null
): Promise<
  | {
      ok: true;
      awbBackfilled: boolean;
      etaBackfilled: boolean;
      settledBackfilled: boolean;
    }
  | { ok: false; reason: string }
> {
  const resolved = await resolveChainAndDetails(token, unit, chainIdHint);
  if (!resolved.ok) return resolved;

  const { details, chainId, stockxOrderId } = resolved;
  const hadAwb = Boolean(trimStr(unit.awb));
  const hadEta = Boolean(unit.etaMin && unit.etaMax);
  const hadSettled =
    unit.stockxSettledAmount != null && Number.isFinite(Number(unit.stockxSettledAmount));

  const nextAwb = resolveAwbFromDetails(details);
  const etaMin = details.etaMin ?? details.etaMax ?? null;
  const etaMax = details.etaMax ?? details.etaMin ?? null;
  const checkoutType =
    typeof details.order?.checkoutType === "string" ? details.order.checkoutType : null;
  const settledRaw = details.order?.payment?.settledAmount;
  const stockxSettledAmount =
    settledRaw?.value != null && Number.isFinite(Number(settledRaw.value))
      ? Number(settledRaw.value)
      : null;
  const stockxSettledCurrency =
    typeof settledRaw?.currency === "string" ? trimStr(settledRaw.currency) || null : null;
  const stockxOrderNumber =
    trimStr(details.order?.orderNumber) || trimStr(unit.stockxOrderNumber) || null;

  const updateData: Record<string, unknown> = {};
  if (!hadAwb && nextAwb) updateData.awb = nextAwb;
  if (!unit.etaMin && etaMin) updateData.etaMin = etaMin;
  if (!unit.etaMax && etaMax) updateData.etaMax = etaMax;
  if (!trimStr(unit.checkoutType) && checkoutType) updateData.checkoutType = checkoutType;
  if (!hadSettled && stockxSettledAmount != null && stockxSettledAmount > 0) {
    updateData.stockxSettledAmount = stockxSettledAmount;
    if (stockxSettledCurrency) updateData.stockxSettledCurrency = stockxSettledCurrency;
  }
  if (stockxOrderNumber && stockxOrderNumber !== trimStr(unit.stockxOrderNumber)) {
    updateData.stockxOrderNumber = stockxOrderNumber;
  }

  if (Object.keys(updateData).length > 0) {
    await (prisma as any).stxPurchaseUnit.update({
      where: { id: unit.id },
      data: updateData,
    });
  }

  // Keep match row in sync when present (UI / DELR read AWB from match too).
  const matchPatch: Record<string, unknown> = {
    stockxChainId: chainId,
    stockxOrderId,
    updatedAt: new Date(),
  };
  if (stockxOrderNumber) matchPatch.stockxOrderNumber = stockxOrderNumber;
  if (nextAwb) {
    matchPatch.stockxAwb = nextAwb;
    const trackingUrl = details.order?.shipping?.shipment?.trackingUrl;
    if (trackingUrl) matchPatch.stockxTrackingUrl = trackingUrl;
  }
  if (etaMin) matchPatch.stockxEstimatedDelivery = etaMin;
  if (etaMax) matchPatch.stockxLatestEstimatedDelivery = etaMax;
  if (checkoutType) matchPatch.stockxCheckoutType = checkoutType;
  if (stockxSettledAmount != null && stockxSettledAmount > 0) {
    matchPatch.stockxAmount = stockxSettledAmount;
    if (stockxSettledCurrency) matchPatch.stockxCurrencyCode = stockxSettledCurrency;
  }

  await (prisma as any).galaxusStockxMatch
    .updateMany({
      where: { stockxOrderId },
      data: matchPatch,
    })
    .catch(() => null);

  return {
    ok: true,
    awbBackfilled: !hadAwb && Boolean(nextAwb),
    etaBackfilled: !hadEta && Boolean(etaMin || etaMax),
    settledBackfilled: !hadSettled && stockxSettledAmount != null && stockxSettledAmount > 0,
  };
}

/**
 * Re-fetch StockX buy by order # / chain id already stored on linked `StxPurchaseUnit` rows.
 * Works for non-express buys that left the PENDING buying list before AWB appeared.
 */
export async function refreshLinkedStxUnitsByStoredRefs(
  token: string,
  galaxusOrderRef: string
): Promise<LinkedStxUnitRefreshStats> {
  let units: LinkedUnitRow[] = [];
  try {
    units = await (prisma as any).stxPurchaseUnit.findMany({
      where: {
        galaxusOrderId: galaxusOrderRef,
        stockxOrderId: { not: null },
        cancelledAt: null,
      },
      select: {
        id: true,
        stockxOrderId: true,
        stockxOrderNumber: true,
        awb: true,
        etaMin: true,
        etaMax: true,
        stockxSettledAmount: true,
        checkoutType: true,
      },
    });
  } catch (error: any) {
    if (!String(error?.message ?? "").includes("Unknown argument `cancelledAt`")) throw error;
    units = await (prisma as any).stxPurchaseUnit.findMany({
      where: {
        galaxusOrderId: galaxusOrderRef,
        stockxOrderId: { not: null },
      },
      select: {
        id: true,
        stockxOrderId: true,
        stockxOrderNumber: true,
        awb: true,
        etaMin: true,
        etaMax: true,
        stockxSettledAmount: true,
        checkoutType: true,
      },
    });
  }

  const eligibleList = units.filter(
    (u) => stxUnitEligibleForStoredRefRefresh(u) && stxUnitNeedsStockxRefresh(u)
  );
  const stats: LinkedStxUnitRefreshStats = {
    eligible: eligibleList.length,
    attempted: 0,
    refreshed: 0,
    awbBackfilled: 0,
    etaBackfilled: 0,
    settledBackfilled: 0,
    failed: 0,
    skipped: units.length - eligibleList.length,
    failures: [],
  };
  if (eligibleList.length === 0) return stats;

  const stockxOrderIds = eligibleList
    .map((u) => trimStr(u.stockxOrderId))
    .filter(Boolean);
  const matches = stockxOrderIds.length
    ? await (prisma as any).galaxusStockxMatch.findMany({
        where: { stockxOrderId: { in: stockxOrderIds } },
        select: { stockxOrderId: true, stockxChainId: true },
      })
    : [];
  const chainByOrderId = new Map<string, string>();
  for (const m of matches) {
    const oid = trimStr(m.stockxOrderId);
    const chain = trimStr(m.stockxChainId);
    if (oid && chain) chainByOrderId.set(oid, chain);
  }

  const limiter = createLimiter(2);
  await Promise.all(
    eligibleList.map((unit) =>
      limiter(async () => {
        stats.attempted += 1;
        const oid = trimStr(unit.stockxOrderId);
        const result = await refreshOneLinkedUnit(token, unit, chainByOrderId.get(oid) ?? null);
        if (result.ok) {
          stats.refreshed += 1;
          if (result.awbBackfilled) stats.awbBackfilled += 1;
          if (result.etaBackfilled) stats.etaBackfilled += 1;
          if (result.settledBackfilled) stats.settledBackfilled += 1;
        } else {
          stats.failed += 1;
          if (stats.failures.length < 20) {
            stats.failures.push({
              unitId: unit.id,
              stockxOrderId: oid,
              reason: result.reason,
            });
          }
        }
      })
    )
  );

  return stats;
}
