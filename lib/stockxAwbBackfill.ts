import { NextRequest } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { extractAwbFromTrackingUrl, hashStockXStates } from "@/app/lib/stockxTracking";
import {
  STOCKX_GET_BUY_ORDER_OPERATION_NAME,
  buildStockxGetBuyOrderVariables,
} from "@/app/lib/constants";
import { POST as stockxProxy } from "@/app/api/stockx/route";
import { sendMilestoneEmailForMatch } from "@/app/lib/notifications/stockxEmail";
import { enrichOrderMatchFromStockxOrderNumber } from "@/lib/stockxAutoCheckout/enrichAfterLink";
import {
  markOrderMatchMetafieldsSynced,
  setSupplierOrderMetafields,
} from "@/shopify/orders/setSupplierMetafields";

const DETAIL_DELAY_MS = 400;
const MAX_CONSECUTIVE_AUTH_FAILURES = 3;
const CANDIDATE_POOL_MULTIPLIER = 6;
/** Hourly cron: heal OrderMatches that have 03-… but never got chainId (pre-enrich buys). */
const ENRICH_MISSING_CHAIN_LIMIT = 40;

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

export type AwbEnrichHealItem = {
  shopifyOrderName: string | null;
  stockxOrderNumber: string;
  ok: boolean;
  reason: string;
};

export type AwbBackfillResult = {
  dryRun: boolean;
  scanned: number;
  candidates: number;
  updated: number;
  emailsSent: number;
  authFailures: number;
  abortedReason: string | null;
  /** Backfill chainId/orderId via order number (no customer email). */
  enrichHealed: number;
  enrichFailed: number;
  enrichItems: AwbEnrichHealItem[];
  items: AwbBackfillItem[];
};

export type AwbBackfillOptions = {
  token: string;
  days?: number;
  limit?: number;
  dryRun?: boolean;
  includeFulfilled?: boolean;
  /** Cap for missing-chainId enrich pass (default 40). */
  enrichLimit?: number;
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
 * Buys linked with order number only (auto-checkout before enrich, or enrich failed).
 * AWB fetch needs chainId+orderId — heal these first (no customer email).
 */
export async function selectMissingChainIdCandidates(args: {
  since: Date;
  limit: number;
}) {
  const pool = await prisma.orderMatch.findMany({
    where: {
      stockxOrderNumber: { startsWith: "0" },
      shopifyCreatedAt: { gte: args.since },
      OR: [{ stockxChainId: null }, { stockxOrderId: null }],
      NOT: { stockxStatus: { in: ["CANCELLED", "REFUNDED"] } },
    },
    select: {
      id: true,
      shopifyOrderName: true,
      stockxOrderNumber: true,
      stockxChainId: true,
      stockxOrderId: true,
    },
    orderBy: { shopifyCreatedAt: "desc" },
    take: Math.max(args.limit * 3, args.limit),
  });

  return pool
    .filter((row) => isRealStockxBuyRef(row.stockxOrderNumber))
    .slice(0, args.limit);
}

/**
 * Resolve missing stockxChainId/stockxOrderId from StockX buying list by order number.
 * Reuses enrichAfterLink — does NOT send customer email.
 */
export async function enrichMissingChainIdCandidates(args: {
  since: Date;
  limit?: number;
  dryRun?: boolean;
}): Promise<{
  attempted: number;
  enriched: number;
  failed: number;
  items: AwbEnrichHealItem[];
}> {
  const limit = Math.min(
    Math.max(Number(args.limit ?? ENRICH_MISSING_CHAIN_LIMIT) || ENRICH_MISSING_CHAIN_LIMIT, 1),
    80
  );
  const candidates = await selectMissingChainIdCandidates({ since: args.since, limit });
  const items: AwbEnrichHealItem[] = [];
  let enriched = 0;
  let failed = 0;

  for (const [index, row] of candidates.entries()) {
    const stockxOrderNumber = String(row.stockxOrderNumber || "").trim();
    const label = {
      shopifyOrderName: row.shopifyOrderName,
      stockxOrderNumber,
    };

    if (args.dryRun) {
      items.push({ ...label, ok: true, reason: "dry_run" });
      continue;
    }

    try {
      const result = await enrichOrderMatchFromStockxOrderNumber({
        orderMatchId: row.id,
        stockxOrderNumber,
      });
      items.push({ ...label, ok: result.ok, reason: result.reason });
      if (result.ok) enriched += 1;
      else failed += 1;
    } catch (error: any) {
      failed += 1;
      items.push({
        ...label,
        ok: false,
        reason: error?.message || "enrich_threw",
      });
    }

    if (index + 1 < candidates.length) {
      await sleep(DETAIL_DELAY_MS);
    }
  }

  return { attempted: candidates.length, enriched, failed, items };
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
      supplierCost: true,
      marginAmount: true,
      marginPercent: true,
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
  // Missing AWB first (incl. fulfilled/historical matches we previously skipped).
  // Then open rows that already have tracking (status / milestone refresh).
  const open = pool.filter((row) => !fulfilledIds.has(row.shopifyOrderId));
  const fulfilledMissingAwb = args.includeFulfilled
    ? []
    : pool.filter((row) => fulfilledIds.has(row.shopifyOrderId) && !row.stockxAwb);
  return [
    ...open.filter((row) => !row.stockxAwb),
    ...fulfilledMissingAwb,
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
  const enrichLimit = Math.min(
    Math.max(
      Number(options.enrichLimit ?? ENRICH_MISSING_CHAIN_LIMIT) || ENRICH_MISSING_CHAIN_LIMIT,
      1
    ),
    80
  );

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Heal backlog: orderNumber present but chainId/orderId missing (skipped by selectAwbCandidates).
  // Cap per run so hourly cron drains without blowing StockX rate limits. No customer email.
  const enrichHeal = await enrichMissingChainIdCandidates({
    since,
    limit: enrichLimit,
    dryRun,
  });
  if (enrichHeal.attempted > 0) {
    console.log(
      `[STOCKX-AWB] enrich missing chainId: attempted=${enrichHeal.attempted} ok=${enrichHeal.enriched} fail=${enrichHeal.failed}`
    );
  }

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

      // Keep Shopify supplier.* metafields (status / ETA / AWB) in sync with StockX.
      if (candidate.shopifyOrderId && candidate.stockxOrderNumber) {
        try {
          const meta = await setSupplierOrderMetafields({
            shopifyOrderId: candidate.shopifyOrderId,
            stockxOrderNumber: String(candidate.stockxOrderNumber),
            stockxStatus,
            estimatedDelivery,
            supplierCost: candidate.supplierCost,
            marginAmount: candidate.marginAmount,
            marginPercent: candidate.marginPercent,
            trackingNumber: awb,
            trackingUrl,
            skipDuplicateCheck: true,
          });
          if (meta.ok) {
            await markOrderMatchMetafieldsSynced(candidate.id);
          } else if (meta.error) {
            console.error(
              `[STOCKX-AWB] metafields ${candidate.shopifyOrderName}:`,
              meta.error
            );
          }
        } catch (metaErr: any) {
          console.error(
            `[STOCKX-AWB] metafields ${candidate.shopifyOrderName}:`,
            metaErr?.message || metaErr
          );
        }
      }

      // Status emails used to fire only on dashboard save-match; cron must advance them too.
      // emailedAt / lastMilestoneKey gates prevent reblast on rematch.
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
    enrichHealed: dryRun ? 0 : enrichHeal.enriched,
    enrichFailed: dryRun ? 0 : enrichHeal.failed,
    enrichItems: enrichHeal.items,
    items,
  };
}
