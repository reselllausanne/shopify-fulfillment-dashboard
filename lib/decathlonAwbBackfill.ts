import { prisma } from "@/app/lib/prisma";
import { extractAwbFromTrackingUrl } from "@/app/lib/stockxTracking";
import { resolveStockxBuyByOrderNumberWithToken } from "@/decathlon/stx/manualStockxEnrich";
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

export type DecathlonAwbBackfillItem = AwbBackfillItem & {
  channel: "decathlon";
  decathlonOrderId: string | null;
};

export type DecathlonAwbBackfillResult = Omit<AwbBackfillResult, "items" | "emailsSent"> & {
  emailsSent: number;
  items: DecathlonAwbBackfillItem[];
};

export type DecathlonAwbBackfillOptions = {
  token: string;
  days?: number;
  limit?: number;
  dryRun?: boolean;
  includeFulfilled?: boolean;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** Decathlon StockX matches missing inbound AWB (warehouse scan). */
export async function selectDecathlonAwbCandidates(args: {
  since: Date;
  limit: number;
  includeFulfilled: boolean;
}) {
  const prismaAny = prisma as any;
  const pool = await prismaAny.decathlonStockxMatch.findMany({
    where: {
      decathlonOrderDate: { gte: args.since },
      NOT: { stockxStatus: { in: ["CANCELLED", "REFUNDED"] } },
    },
    select: {
      id: true,
      decathlonOrderId: true,
      decathlonOrderDate: true,
      stockxOrderNumber: true,
      stockxChainId: true,
      stockxOrderId: true,
      stockxAwb: true,
    },
    orderBy: { decathlonOrderDate: "desc" },
    take: args.includeFulfilled ? args.limit * 3 : args.limit * CANDIDATE_POOL_MULTIPLIER,
  });

  const stockxRows = (pool as any[]).filter((row) => isRealStockxBuyRef(row.stockxOrderNumber));
  const orderIds = Array.from(
    new Set(stockxRows.map((row) => String(row.decathlonOrderId)).filter(Boolean))
  );

  const fulfilledIds = new Set<string>();
  if (!args.includeFulfilled && orderIds.length > 0) {
    const shipped = await prismaAny.decathlonShipment.findMany({
      where: { orderId: { in: orderIds }, shippedAt: { not: null } },
      select: { orderId: true },
    });
    for (const row of shipped) fulfilledIds.add(String(row.orderId));
  }

  const open = stockxRows.filter((row) => !fulfilledIds.has(String(row.decathlonOrderId)));
  return [
    ...open.filter((row) => !row.stockxAwb),
    ...open.filter((row) => Boolean(row.stockxAwb)),
  ].slice(0, args.limit);
}

export async function runDecathlonAwbBackfill(
  options: DecathlonAwbBackfillOptions
): Promise<DecathlonAwbBackfillResult> {
  const token = String(options.token || "").trim().replace(/^bearer\s+/i, "");
  if (!token) throw new Error("Missing StockX bearer token");

  const days = Math.min(Math.max(Number(options.days ?? 45) || 45, 1), 180);
  const limit = Math.min(Math.max(Number(options.limit ?? 40) || 40, 1), 200);
  const dryRun = Boolean(options.dryRun ?? false);
  const includeFulfilled = Boolean(options.includeFulfilled ?? false);

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const candidates = await selectDecathlonAwbCandidates({ since, limit, includeFulfilled });
  const prismaAny = prisma as any;

  const items: DecathlonAwbBackfillItem[] = [];
  let updated = 0;
  let authFailures = 0;
  let consecutiveAuthFailures = 0;
  let abortedReason: string | null = null;

  for (const [index, candidate] of candidates.entries()) {
    const label = {
      channel: "decathlon" as const,
      decathlonOrderId: candidate.decathlonOrderId ?? null,
      shopifyOrderName: candidate.decathlonOrderId,
      stockxOrderNumber: candidate.stockxOrderNumber,
    };

    try {
      const { snapshot, httpStatus, error, authFailed } = await loadBuySnapshot(token, candidate);

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

      await prismaAny.decathlonStockxMatch.update({
        where: { id: candidate.id },
        data: patch,
      });

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
