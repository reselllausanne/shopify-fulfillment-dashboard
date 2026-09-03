import { prisma } from "@/app/lib/prisma";
import { extractAwbFromTrackingUrl } from "@/app/lib/stockxTracking";
import { resolveStockxBuyByOrderNumberWithToken } from "@/decathlon/stx/manualStockxEnrich";
import {
  computeShipmentCoverageForOrders,
  loadDelrShipmentIdsForOrders,
  loadShipmentItemsForOrders,
} from "@/galaxus/warehouse/shipmentLineCoverage";
import {
  carrierFromTrackingUrl,
  fetchBuyOrder,
  isRealStockxBuyRef,
  type AwbBackfillItem,
  type AwbBackfillResult,
} from "@/lib/stockxAwbBackfill";

const DETAIL_DELAY_MS = 400;
const MAX_CONSECUTIVE_AUTH_FAILURES = 3;
const CANDIDATE_POOL_MULTIPLIER = 6;

const GALAXUS_DELIVERY_TYPES = ["direct_delivery", "warehouse_delivery"] as const;

export type GalaxusAwbBackfillItem = AwbBackfillItem & {
  channel: "galaxus";
  galaxusOrderRef: string | null;
  deliveryType?: string | null;
};

export type GalaxusAwbBackfillResult = Omit<AwbBackfillResult, "items" | "emailsSent"> & {
  emailsSent: number;
  items: GalaxusAwbBackfillItem[];
};

export type GalaxusAwbBackfillOptions = {
  token: string;
  /**
   * Additional bearer tokens to try when the primary token can't see a buy
   * (e.g. multi-account setups where one warehouse label lives on account B
   * but cron only refreshed account A's token). Deduped with `token`.
   */
  extraTokens?: string[];
  days?: number;
  limit?: number;
  dryRun?: boolean;
  includeFulfilled?: boolean;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** @deprecated import from `@/lib/stockxAwbBackfill` */
export { isRealStockxBuyRef };

function normalizeStockxStatus(
  currentStatusKey: string | null | undefined,
  orderStatusRaw: string | null | undefined
): string | null {
  const key = String(currentStatusKey || "").trim().toUpperCase();
  if (key) return key;
  const raw = String(orderStatusRaw || "").trim().toUpperCase();
  if (!raw) return null;
  if (raw.includes("CANCEL")) return "CANCELLED";
  if (raw.includes("REFUND")) return "REFUNDED";
  return raw;
}

type BuySnapshot = {
  trackingUrl: string | null;
  awb: string | null;
  stockxStatus: string | null;
  checkoutType: string | null;
  states: unknown;
  estimatedDelivery: Date | null;
  latestEstimatedDelivery: Date | null;
  chainId: string | null;
  orderId: string | null;
};

async function loadBuySnapshot(
  token: string,
  candidate: {
    stockxChainId: string | null;
    stockxOrderId: string | null;
    stockxOrderNumber: string;
  }
): Promise<{ snapshot: BuySnapshot | null; httpStatus: number; error: string | null; authFailed: boolean }> {
  const chainId = String(candidate.stockxChainId ?? "").trim();
  const orderId = String(candidate.stockxOrderId ?? "").trim();

  if (chainId && orderId) {
    const { httpStatus, buyOrder, error } = await fetchBuyOrder(token, chainId, orderId);
    if (buyOrder) {
      const trackingUrl = buyOrder?.shipping?.shipment?.trackingUrl || null;
      const etaMin = buyOrder?.estimatedDeliveryDateRange?.estimatedDeliveryDate || null;
      const etaMax = buyOrder?.estimatedDeliveryDateRange?.latestEstimatedDeliveryDate || null;
      return {
        snapshot: {
          trackingUrl,
          awb: extractAwbFromTrackingUrl(trackingUrl),
          stockxStatus: normalizeStockxStatus(
            buyOrder?.currentStatus?.key || null,
            buyOrder?.status || null
          ),
          checkoutType: typeof buyOrder?.checkoutType === "string" ? buyOrder.checkoutType : null,
          states: buyOrder?.states ?? null,
          estimatedDelivery: etaMin ? new Date(etaMin) : null,
          latestEstimatedDelivery: etaMax ? new Date(etaMax) : null,
          chainId,
          orderId,
        },
        httpStatus,
        error,
        authFailed: httpStatus === 401 || httpStatus === 403,
      };
    }
    if (httpStatus === 401 || httpStatus === 403) {
      return { snapshot: null, httpStatus, error, authFailed: true };
    }
  }

  const resolved = await resolveStockxBuyByOrderNumberWithToken(token, candidate.stockxOrderNumber);
  if (!resolved.ok) {
    return {
      snapshot: null,
      httpStatus: 404,
      error: resolved.reason || "order_number_lookup_failed",
      authFailed: false,
    };
  }

  const order = resolved.details.order;
  const trackingUrl = order?.shipping?.shipment?.trackingUrl ?? null;
  return {
    snapshot: {
      trackingUrl,
      awb: resolved.details.awb ?? extractAwbFromTrackingUrl(trackingUrl),
      stockxStatus: normalizeStockxStatus(
        order?.currentStatus?.key || null,
        order?.status != null ? String(order.status) : null
      ),
      checkoutType: typeof order?.checkoutType === "string" ? order.checkoutType : null,
      states: order?.states ?? null,
      estimatedDelivery: resolved.details.etaMin ?? null,
      latestEstimatedDelivery: resolved.details.etaMax ?? null,
      chainId: String(resolved.listNode.chainId ?? order?.chainId ?? "").trim() || null,
      orderId: String(resolved.listNode.orderId ?? order?.id ?? "").trim() || null,
    },
    httpStatus: 200,
    error: null,
    authFailed: false,
  };
}

/** Galaxus StockX matches (direct + warehouse) for inbound AWB backfill. */
export async function selectGalaxusAwbCandidates(args: {
  since: Date;
  limit: number;
  includeFulfilled: boolean;
}) {
  const prismaAny = prisma as any;
  const pool = await prismaAny.galaxusStockxMatch.findMany({
    where: {
      galaxusOrderDate: { gte: args.since },
      NOT: { stockxStatus: { in: ["CANCELLED", "REFUNDED"] } },
      order: { deliveryType: { in: [...GALAXUS_DELIVERY_TYPES] } },
    },
    select: {
      id: true,
      galaxusOrderId: true,
      galaxusOrderRef: true,
      galaxusOrderDate: true,
      galaxusOrderLineId: true,
      stockxOrderNumber: true,
      stockxChainId: true,
      stockxOrderId: true,
      stockxAwb: true,
      order: { select: { deliveryType: true } },
    },
    orderBy: { galaxusOrderDate: "desc" },
    take: args.includeFulfilled ? args.limit * 3 : args.limit * CANDIDATE_POOL_MULTIPLIER,
  });

  const stockxRows = (pool as any[]).filter((row) => isRealStockxBuyRef(row.stockxOrderNumber));
  const orderIds = Array.from(new Set(stockxRows.map((row) => String(row.galaxusOrderId)).filter(Boolean)));

  // Line-level fulfilment gate: sibling line's DELR must not hide THIS line's missing AWB.
  // Match rows carry `galaxusOrderLineId`; only skip candidates whose specific line is fully shipped.
  const closedLineIds = new Set<string>();
  if (!args.includeFulfilled && orderIds.length > 0) {
    const orders = await prisma.galaxusOrder.findMany({
      where: { id: { in: orderIds } },
      select: {
        id: true,
        galaxusOrderId: true,
        lines: {
          select: {
            id: true,
            quantity: true,
            buyerPid: true,
            supplierPid: true,
            gtin: true,
            warehouseMarkedShippedAt: true,
          },
        },
      },
    });
    const orderRefs = Array.from(
      new Set(orders.map((o) => String(o.galaxusOrderId ?? "").trim()).filter(Boolean))
    );
    const [delrShipmentIds, existingItems] = await Promise.all([
      loadDelrShipmentIdsForOrders(orderIds, orderRefs),
      loadShipmentItemsForOrders(orderIds),
    ]);
    const coverage = computeShipmentCoverageForOrders(orders, existingItems, delrShipmentIds);
    for (const [lineId, cov] of Object.entries(coverage)) {
      if ((cov?.remaining ?? 0) <= 0) closedLineIds.add(lineId);
    }
  }

  const open = stockxRows
    .filter((row) => {
      const lineId = String(row.galaxusOrderLineId ?? "").trim();
      // Direct-delivery matches may lack ShipmentItem coverage data → keep them.
      const dt = String(row.order?.deliveryType ?? "").toLowerCase();
      if (dt === "direct_delivery") return true;
      return !lineId || !closedLineIds.has(lineId);
    })
    .map((row) => ({
      ...row,
      deliveryType: row.order?.deliveryType ?? null,
    }));

  return [
    ...open.filter((row) => !row.stockxAwb),
    ...open.filter((row) => Boolean(row.stockxAwb)),
  ].slice(0, args.limit);
}

export async function runGalaxusAwbBackfill(
  options: GalaxusAwbBackfillOptions
): Promise<GalaxusAwbBackfillResult> {
  const token = String(options.token || "").trim().replace(/^bearer\s+/i, "");
  if (!token) throw new Error("Missing StockX bearer token");
  const tokenPool: string[] = [];
  const pushToken = (raw: string | null | undefined) => {
    const cleaned = String(raw ?? "").trim().replace(/^bearer\s+/i, "");
    if (cleaned && !tokenPool.includes(cleaned)) tokenPool.push(cleaned);
  };
  pushToken(token);
  for (const extra of options.extraTokens ?? []) pushToken(extra);

  const days = Math.min(Math.max(Number(options.days ?? 45) || 45, 1), 180);
  const limit = Math.min(Math.max(Number(options.limit ?? 40) || 40, 1), 200);
  const dryRun = Boolean(options.dryRun ?? false);
  const includeFulfilled = Boolean(options.includeFulfilled ?? false);

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const candidates = await selectGalaxusAwbCandidates({ since, limit, includeFulfilled });
  const prismaAny = prisma as any;

  const items: GalaxusAwbBackfillItem[] = [];
  let updated = 0;
  let authFailures = 0;
  let consecutiveAuthFailures = 0;
  let abortedReason: string | null = null;

  for (const [index, candidate] of candidates.entries()) {
    const label = {
      channel: "galaxus" as const,
      galaxusOrderRef: candidate.galaxusOrderRef ?? null,
      shopifyOrderName: candidate.galaxusOrderRef,
      stockxOrderNumber: candidate.stockxOrderNumber,
      deliveryType: candidate.deliveryType ?? null,
    };

    try {
      let snapshot: BuySnapshot | null = null;
      let httpStatus = 0;
      let error: string | null = null;
      let authFailed = false;
      let lastAuthFailedFromMissing = false;
      for (const attemptToken of tokenPool) {
        const attempt = await loadBuySnapshot(attemptToken, candidate);
        snapshot = attempt.snapshot;
        httpStatus = attempt.httpStatus;
        error = attempt.error;
        authFailed = attempt.authFailed;
        if (snapshot) break;
        // 404 / "not found" on this token likely means the buy lives on the other
        // account — try the next token before giving up. Auth failures also fall
        // through so a stale account-A token doesn't mask account-B success.
        lastAuthFailedFromMissing = authFailed;
      }
      authFailed = lastAuthFailedFromMissing && !snapshot;

      if (!snapshot) {
        items.push({
          ...label,
          status: authFailed ? "AUTH_FAILED" : "ERROR",
          error: error || `HTTP ${httpStatus}`,
        });
        if (authFailed) {
          authFailures += 1;
          consecutiveAuthFailures += 1;
          if (consecutiveAuthFailures >= MAX_CONSECUTIVE_AUTH_FAILURES) {
            abortedReason =
              "StockX rejected the token three times in a row. Refresh the StockX session, then retry.";
            break;
          }
        }
        continue;
      }

      consecutiveAuthFailures = 0;
      const carrier = carrierFromTrackingUrl(snapshot.trackingUrl);

      if (dryRun) {
        items.push({
          ...label,
          status: snapshot.awb ? "DRY_RUN" : "NO_TRACKING",
          awb: snapshot.awb,
          carrier,
          stockxStatus: snapshot.stockxStatus,
        });
        continue;
      }

      const patch: Record<string, unknown> = {
        updatedAt: new Date(),
        ...(snapshot.awb ? { stockxAwb: snapshot.awb, stockxTrackingUrl: snapshot.trackingUrl } : {}),
        ...(snapshot.stockxStatus ? { stockxStatus: snapshot.stockxStatus } : {}),
        ...(snapshot.checkoutType ? { stockxCheckoutType: snapshot.checkoutType } : {}),
        ...(snapshot.states ? { stockxStates: snapshot.states } : {}),
        ...(snapshot.estimatedDelivery
          ? { stockxEstimatedDelivery: snapshot.estimatedDelivery }
          : {}),
        ...(snapshot.latestEstimatedDelivery
          ? { stockxLatestEstimatedDelivery: snapshot.latestEstimatedDelivery }
          : {}),
        ...(snapshot.chainId && !candidate.stockxChainId ? { stockxChainId: snapshot.chainId } : {}),
        ...(snapshot.orderId && !candidate.stockxOrderId ? { stockxOrderId: snapshot.orderId } : {}),
      };

      await prismaAny.galaxusStockxMatch.update({
        where: { id: candidate.id },
        data: patch,
      });

      if (snapshot.awb && (snapshot.orderId || candidate.stockxOrderId)) {
        await prismaAny.stxPurchaseUnit
          .updateMany({
            where: { stockxOrderId: String(snapshot.orderId || candidate.stockxOrderId) },
            data: {
              awb: snapshot.awb,
              ...(snapshot.estimatedDelivery ? { etaMin: snapshot.estimatedDelivery } : {}),
            },
          })
          .catch(() => null);
      }

      if (snapshot.awb) {
        updated += 1;
        items.push({
          ...label,
          status: "UPDATED",
          awb: snapshot.awb,
          carrier,
          stockxStatus: snapshot.stockxStatus,
        });
      } else {
        items.push({
          ...label,
          status: "NO_TRACKING",
          stockxStatus: snapshot.stockxStatus,
        });
      }
    } catch (err: any) {
      items.push({ ...label, status: "ERROR", error: err?.message || "Unknown error" });
    }

    if (index + 1 < candidates.length) {
      await sleep(DETAIL_DELAY_MS);
    }
  }

  return {
    dryRun,
    scanned: items.length,
    candidates: candidates.length,
    updated,
    emailsSent: 0,
    authFailures,
    abortedReason,
    items,
  };
}
