import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeFinancialStatus(raw: string | null | undefined): string {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

/** Fully refunded / void — not actionable for COGS reconcile. */
function isFullyRefundedOrVoid(status: string): boolean {
  return status === "REFUNDED" || status === "VOIDED";
}

/**
 * GET /api/orders/unmatched?days=30
 * Shopify orders still needing purchase COGS (no OrderMatch).
 * Excludes: cancelled, fully refunded/void, net ≤ 0, already matched (by name or id).
 */
export async function GET(req: NextRequest) {
  try {
    const daysRaw = Number(req.nextUrl.searchParams.get("days") || 30);
    const days = Number.isFinite(daysRaw)
      ? Math.min(180, Math.max(1, Math.floor(daysRaw)))
      : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const orders = await prisma.shopifyOrder.findMany({
      where: {
        createdAt: { gte: since },
        cancelledAt: null,
      },
      select: {
        shopifyOrderId: true,
        orderName: true,
        createdAt: true,
        financialStatus: true,
        totalSalesChf: true,
        netSalesChf: true,
        refundedAmountChf: true,
        paymentGatewayNames: true,
      },
      orderBy: { createdAt: "desc" },
    });

    if (orders.length === 0) {
      return NextResponse.json({
        ok: true,
        days,
        since: since.toISOString(),
        count: 0,
        paidPositiveCount: 0,
        netTotalChf: 0,
        paidPositiveNetChf: 0,
        orders: [],
      });
    }

    const names = orders.map((o) => o.orderName);
    const ids = orders.map((o) => o.shopifyOrderId).filter(Boolean);
    const matched = await prisma.orderMatch.findMany({
      where: {
        OR: [
          { shopifyOrderName: { in: names } },
          { shopifyOrderId: { in: ids } },
        ],
      },
      select: { shopifyOrderName: true, shopifyOrderId: true },
    });
    const matchedNames = new Set(
      matched.map((m) => m.shopifyOrderName).filter(Boolean) as string[]
    );
    const matchedIds = new Set(
      matched.map((m) => m.shopifyOrderId).filter(Boolean) as string[]
    );

    const unmatched = orders
      .map((o) => {
        const gross = Number(o.totalSalesChf ?? 0);
        const refunded = Number(o.refundedAmountChf ?? 0);
        const net =
          o.netSalesChf != null ? Number(o.netSalesChf) : gross - refunded;
        const status = normalizeFinancialStatus(o.financialStatus);
        const fullyRefundedByMoney =
          gross > 0 && refunded >= gross - 0.01 && net <= 0.01;
        return {
          shopifyOrderId: o.shopifyOrderId,
          orderName: o.orderName,
          createdAt: o.createdAt.toISOString(),
          financialStatus: o.financialStatus,
          netSalesChf: Number(net.toFixed(2)),
          totalSalesChf: Number(gross.toFixed(2)),
          refundedAmountChf: Number(refunded.toFixed(2)),
          paymentGatewayNames: o.paymentGatewayNames,
          _status: status,
          _fullyRefundedByMoney: fullyRefundedByMoney,
          _matched:
            matchedNames.has(o.orderName) ||
            matchedIds.has(o.shopifyOrderId),
        };
      })
      .filter((o) => {
        if (o._matched) return false;
        if (isFullyRefundedOrVoid(o._status)) return false;
        if (o._fullyRefundedByMoney) return false;
        // Partial refund OK only if remaining net still needs COGS
        if (o.netSalesChf <= 0) return false;
        return true;
      })
      .map(({ _status, _fullyRefundedByMoney, _matched, ...row }) => row)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

    const netTotalChf = Number(
      unmatched.reduce((s, o) => s + o.netSalesChf, 0).toFixed(2)
    );

    return NextResponse.json({
      ok: true,
      days,
      since: since.toISOString(),
      count: unmatched.length,
      paidPositiveCount: unmatched.length,
      netTotalChf,
      paidPositiveNetChf: netTotalChf,
      note: "Shopify payé, net>0, aucune OrderMatch (nom ou id). Pas de refund/void complets.",
      orders: unmatched,
    });
  } catch (err: any) {
    console.error("[orders/unmatched]", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
