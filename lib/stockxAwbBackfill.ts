import { NextRequest } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { extractAwbFromTrackingUrl, hashStockXStates } from "@/app/lib/stockxTracking";
import {
  STOCKX_GET_BUY_ORDER_OPERATION_NAME,
  buildStockxGetBuyOrderVariables,
} from "@/app/lib/constants";
import { POST as stockxProxy } from "@/app/api/stockx/route";
import { sendMilestoneEmailForMatch } from "@/app/lib/notifications/stockxEmail";

const DETAIL_DELAY_MS = 400;
const MAX_CONSECUTIVE_AUTH_FAILURES = 3;
const CANDIDATE_POOL_MULTIPLIER = 6;

export type AwbBackfillItem = {
  shopifyOrderName: string | null;
  stockxOrderNumber: string;
  status: "UPDATED" | "NO_TRACKING" | "AUTH_FAILED" | "ERROR" | "DRY_RUN";
  awb?: string | null;
  carrier?: string | null;
  stockxStatus?: string | null;
  emailSent?: boolean;
  emailSkipped?: string | null;
  error?: string | null;
};

export type AwbBackfillResult = {
  dryRun: boolean;
  scanned: number;
  candidates: number;
  updated: number;
  emailsSent: number;
  authFailures: number;
  abortedReason: string | null;
  items: AwbBackfillItem[];
};

export type AwbBackfillOptions = {
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

/** Real StockX buy refs only — skip manual supplier / GOAT placeholders. */
export function isRealStockxBuyRef(value: unknown): boolean {
  const ref = String(value ?? "").trim();
  if (!ref) return false;
  if (/^(GOAT|BERGER|WEL|REI|CONRAD|SNL|LOCAL|MANUAL|PHYS|ESS)-/i.test(ref)) return false;
  return /^01-[A-Z0-9]+$/i.test(ref) || /^0\d/.test(ref);
}

export function carrierFromTrackingUrl(trackingUrl: string | null): string | null {
  if (!trackingUrl) return null;
  const lowered = trackingUrl.toLowerCase();
  if (lowered.includes("ups.com")) return "UPS";
  if (lowered.includes("dhl")) return "DHL";
  if (lowered.includes("fedex")) return "FedEx";
  if (lowered.includes("post.ch")) return "Swiss Post";
  try {
    return new URL(trackingUrl).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function fetchBuyOrder(token: string, chainId: string, orderId: string) {
  const proxyRequest = new NextRequest("http://internal/api/stockx", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token,
      operationName: STOCKX_GET_BUY_ORDER_OPERATION_NAME,
      query: "",
      variables: buildStockxGetBuyOrderVariables({ chainId, orderId }),
    }),
  });
  const response = await stockxProxy(proxyRequest);
  const json = await response.json().catch(() => ({}) as any);
  return {
    httpStatus: response.status,
    buyOrder: json?.data?.viewer?.order ?? null,
    error: json?.error ? `${json.error}: ${json.details ?? ""}`.trim() : null,
  };
}

/**
 * In-transit StockX buys: missing AWB first (warehouse scan), then rows that already have
 * tracking but still need status/milestone emails until the warehouse fulfills them.
 */
export async function selectAwbCandidates(args: {
  since: Date;
  limit: number;
  includeFulfilled: boolean;
}) {
  const pool = await prisma.orderMatch.findMany({
    where: {
      stockxChainId: { not: null },
      stockxOrderId: { not: null },
      stockxOrderNumber: { startsWith: "0" },
      shopifyCreatedAt: { gte: args.since },
      NOT: { stockxStatus: { in: ["CANCELLED", "REFUNDED"] } },
    },
    select: {
      id: true,
      shopifyOrderId: true,
      shopifyOrderName: true,
      stockxOrderNumber: true,
      stockxChainId: true,
      stockxOrderId: true,
      stockxAwb: true,
      stockxStatesHash: true,
    },
    orderBy: { shopifyCreatedAt: "desc" },
    take: args.includeFulfilled ? args.limit : args.limit * CANDIDATE_POOL_MULTIPLIER,
  });

  const orderIds = Array.from(new Set(pool.map((row) => row.shopifyOrderId).filter(Boolean)));
  const fulfilledIds = new Set(
    args.includeFulfilled
      ? []
      : (
          await prisma.shopifyFulfillmentRecord.findMany({
            where: { shopifyOrderId: { in: orderIds } },
            select: { shopifyOrderId: true },
          })
        ).map((row) => row.shopifyOrderId)
  );
  // Missing AWB first so warehouse scans stay unblocked; then status refresh for the rest.
  const open = pool.filter((row) => !fulfilledIds.has(row.shopifyOrderId));
  return [
    ...open.filter((row) => !row.stockxAwb),
    ...open.filter((row) => Boolean(row.stockxAwb)),
  ].slice(0, args.limit);
}

export async function runAwbBackfill(options: AwbBackfillOptions): Promise<AwbBackfillResult> {
  const token = String(options.token || "").trim().replace(/^bearer\s+/i, "");
  if (!token) throw new Error("Missing StockX bearer token");

  const days = Math.min(Math.max(Number(options.days ?? 45) || 45, 1), 180);
  const limit = Math.min(Math.max(Number(options.limit ?? 40) || 40, 1), 200);
  const dryRun = Boolean(options.dryRun ?? false);
  const includeFulfilled = Boolean(options.includeFulfilled ?? false);

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const candidates = await selectAwbCandidates({ since, limit, includeFulfilled });

  const items: AwbBackfillItem[] = [];
  let updated = 0;
  let emailsSent = 0;
  let authFailures = 0;
  let consecutiveAuthFailures = 0;
  let abortedReason: string | null = null;

  for (const [index, candidate] of candidates.entries()) {
    const label = {
      shopifyOrderName: candidate.shopifyOrderName,
      stockxOrderNumber: candidate.stockxOrderNumber,
    };

    try {
      const { httpStatus, buyOrder, error } = await fetchBuyOrder(
        token,
        String(candidate.stockxChainId),
        String(candidate.stockxOrderId)
      );

      if (!buyOrder) {
        const authFailed = httpStatus === 401 || httpStatus === 403;
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
      const trackingUrl = buyOrder?.shipping?.shipment?.trackingUrl || null;
      const awb = extractAwbFromTrackingUrl(trackingUrl);
      const stockxStatus = normalizeStockxStatus(
        buyOrder?.currentStatus?.key || null,
        buyOrder?.status || null
      );
      const carrier = carrierFromTrackingUrl(trackingUrl);
      const states = buyOrder?.states ?? null;
      const statesHash = hashStockXStates(states as any);
      const estimatedDelivery = buyOrder?.estimatedDeliveryDateRange?.estimatedDeliveryDate || null;
      const latestEstimatedDelivery =
        buyOrder?.estimatedDeliveryDateRange?.latestEstimatedDeliveryDate || null;

      if (dryRun) {
        items.push({
          ...label,
          status: awb ? "DRY_RUN" : "NO_TRACKING",
          awb,
          carrier,
          stockxStatus,
        });
        continue;
      }

      await prisma.orderMatch.update({
        where: { id: candidate.id },
        data: {
          ...(awb ? { stockxAwb: awb, stockxTrackingUrl: trackingUrl } : {}),
          ...(stockxStatus ? { stockxStatus } : {}),
          ...(buyOrder?.checkoutType ? { stockxCheckoutType: buyOrder.checkoutType } : {}),
          ...(states && statesHash
            ? { stockxStates: states, stockxStatesHash: statesHash, stockxStatesUpdatedAt: new Date() }
            : {}),
          ...(estimatedDelivery ? { stockxEstimatedDelivery: new Date(estimatedDelivery) } : {}),
          ...(latestEstimatedDelivery
            ? { stockxLatestEstimatedDelivery: new Date(latestEstimatedDelivery) }
            : {}),
        },
      });

      // Status emails used to fire only on dashboard save-match; cron must advance them too.
      let emailSent = false;
      let emailSkipped: string | null = null;
      try {
        const emailResult = await sendMilestoneEmailForMatch({
          matchId: candidate.id,
          skipIfFulfilled: true,
          skipIfEtaPassed: true,
        });
        if (emailResult.sent) {
          emailSent = true;
          emailsSent += 1;
        } else if (emailResult.skipped) {
          emailSkipped = emailResult.reason || "skipped";
        } else if (emailResult.error) {
          emailSkipped = emailResult.error;
        }
      } catch (emailError: any) {
        emailSkipped = emailError?.message || "email_failed";
      }

      if (awb) {
        updated += 1;
        items.push({
          ...label,
          status: "UPDATED",
          awb,
          carrier,
          stockxStatus,
          emailSent,
          emailSkipped,
        });
      } else {
        items.push({
          ...label,
          status: "NO_TRACKING",
          stockxStatus,
          emailSent,
          emailSkipped,
        });
      }
    } catch (error: any) {
      items.push({ ...label, status: "ERROR", error: error?.message || "Unknown error" });
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
    emailsSent,
    authFailures,
    abortedReason,
    items,
  };
}
