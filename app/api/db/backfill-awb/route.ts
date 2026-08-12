import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { extractAwbFromTrackingUrl, hashStockXStates } from "@/app/lib/stockxTracking";
import {
  STOCKX_GET_BUY_ORDER_OPERATION_NAME,
  buildStockxGetBuyOrderVariables,
} from "@/app/lib/constants";
import { POST as stockxProxy } from "@/app/api/stockx/route";
import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

const DETAIL_DELAY_MS = 400;
const MAX_CONSECUTIVE_AUTH_FAILURES = 3;

type BackfillItem = {
  shopifyOrderName: string | null;
  stockxOrderNumber: string;
  status: "UPDATED" | "NO_TRACKING" | "AUTH_FAILED" | "ERROR" | "DRY_RUN";
  awb?: string | null;
  stockxStatus?: string | null;
  error?: string | null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchBuyOrder(token: string, chainId: string, orderId: string) {
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

export async function POST(req: NextRequest) {
  try {
    const role = await getStaffRoleFromRequest(req);
    if (role !== "admin") {
      return NextResponse.json(
        { ok: false, error: "Forbidden", details: "Admin role required." },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}) as Record<string, unknown>);
    const token = String((body as any)?.token ?? "").trim().replace(/^bearer\s+/i, "");
    const days = Math.min(Math.max(Number((body as any)?.days ?? 45) || 45, 1), 180);
    const limit = Math.min(Math.max(Number((body as any)?.limit ?? 40) || 40, 1), 200);
    const dryRun = Boolean((body as any)?.dryRun ?? false);

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Missing StockX bearer token" },
        { status: 400 }
      );
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const candidates = await prisma.orderMatch.findMany({
      where: {
        stockxAwb: null,
        stockxChainId: { not: null },
        stockxOrderId: { not: null },
        stockxOrderNumber: { startsWith: "0" },
        shopifyCreatedAt: { gte: since },
      },
      select: {
        id: true,
        shopifyOrderName: true,
        stockxOrderNumber: true,
        stockxChainId: true,
        stockxOrderId: true,
        stockxStatesHash: true,
      },
      orderBy: { shopifyCreatedAt: "desc" },
      take: limit,
    });

    const items: BackfillItem[] = [];
    let updated = 0;
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
            consecutiveAuthFailures += 1;
            if (consecutiveAuthFailures >= MAX_CONSECUTIVE_AUTH_FAILURES) {
              abortedReason =
                "StockX rejected the token three times in a row. Paste a fresh bearer token and retry.";
              break;
            }
          }
          continue;
        }

        consecutiveAuthFailures = 0;
        const trackingUrl = buyOrder?.shipping?.shipment?.trackingUrl || null;
        const awb = extractAwbFromTrackingUrl(trackingUrl);
        const stockxStatus = buyOrder?.currentStatus?.key || null;

        if (!awb) {
          items.push({ ...label, status: "NO_TRACKING", stockxStatus });
          continue;
        }

        if (dryRun) {
          items.push({ ...label, status: "DRY_RUN", awb, stockxStatus });
          continue;
        }

        const states = buyOrder?.states ?? null;
        const statesHash = hashStockXStates(states as any);
        const estimatedDelivery = buyOrder?.estimatedDeliveryDateRange?.estimatedDeliveryDate || null;
        const latestEstimatedDelivery =
          buyOrder?.estimatedDeliveryDateRange?.latestEstimatedDeliveryDate || null;

        await prisma.orderMatch.update({
          where: { id: candidate.id },
          data: {
            stockxAwb: awb,
            stockxTrackingUrl: trackingUrl,
            ...(stockxStatus ? { stockxStatus } : {}),
            ...(buyOrder?.checkoutType ? { stockxCheckoutType: buyOrder.checkoutType } : {}),
            ...(states && statesHash && statesHash !== candidate.stockxStatesHash
              ? { stockxStates: states, stockxStatesHash: statesHash }
              : {}),
            ...(estimatedDelivery ? { stockxEstimatedDelivery: new Date(estimatedDelivery) } : {}),
            ...(latestEstimatedDelivery
              ? { stockxLatestEstimatedDelivery: new Date(latestEstimatedDelivery) }
              : {}),
          },
        });

        updated += 1;
        items.push({ ...label, status: "UPDATED", awb, stockxStatus });
      } catch (error: any) {
        items.push({ ...label, status: "ERROR", error: error?.message || "Unknown error" });
      }

      if (index + 1 < candidates.length) {
        await sleep(DETAIL_DELAY_MS);
      }
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      scanned: items.length,
      candidates: candidates.length,
      updated,
      abortedReason,
      items,
    });
  } catch (error: any) {
    console.error("[BACKFILL-AWB] Error:", error?.message || error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Internal error" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const role = await getStaffRoleFromRequest(req);
  if (role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const days = Math.min(
    Math.max(Number(new URL(req.url).searchParams.get("days") ?? 45) || 45, 1),
    180
  );
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [missing, total] = await Promise.all([
    prisma.orderMatch.count({
      where: {
        stockxAwb: null,
        stockxChainId: { not: null },
        stockxOrderId: { not: null },
        stockxOrderNumber: { startsWith: "0" },
        shopifyCreatedAt: { gte: since },
      },
    }),
    prisma.orderMatch.count({
      where: {
        stockxOrderNumber: { startsWith: "0" },
        shopifyCreatedAt: { gte: since },
      },
    }),
  ]);

  return NextResponse.json({ ok: true, days, missingAwb: missing, stockxMatches: total });
}
