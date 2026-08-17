import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/orders/unmatched?days=30
 * Shopify orders with zero OrderMatch rows (no purchase cost recorded).
 * Galaxus not included — ShopifyOrder table only.
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
        netTotalChf: 0,
        orders: [],
      });
    }

    const names = orders.map((o) => o.orderName);
    const matched = await prisma.orderMatch.findMany({
      where: { shopifyOrderName: { in: names } },
      select: { shopifyOrderName: true },
      distinct: ["shopifyOrderName"],
    });
    const matchedSet = new Set(matched.map((m) => m.shopifyOrderName));

    const unmatched = orders
      .filter((o) => !matchedSet.has(o.orderName))
      .map((o) => {
        const gross = Number(o.totalSalesChf ?? 0);
        const refunded = Number(o.refundedAmountChf ?? 0);
        const net =
          o.netSalesChf != null ? Number(o.netSalesChf) : gross - refunded;
        return {
          shopifyOrderId: o.shopifyOrderId,
          orderName: o.orderName,
          createdAt: o.createdAt.toISOString(),
          financialStatus: o.financialStatus,
          netSalesChf: Number(net.toFixed(2)),
          totalSalesChf: Number(gross.toFixed(2)),
          refundedAmountChf: Number(refunded.toFixed(2)),
          paymentGatewayNames: o.paymentGatewayNames,
        };
      })
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

    const netTotalChf = Number(
      unmatched.reduce((s, o) => s + o.netSalesChf, 0).toFixed(2)
    );
    const paidPositive = unmatched.filter(
      (o) => o.financialStatus !== "REFUNDED" && o.netSalesChf > 0
    );
    const paidPositiveNetChf = Number(
      paidPositive.reduce((s, o) => s + o.netSalesChf, 0).toFixed(2)
    );

    return NextResponse.json({
      ok: true,
      days,
      since: since.toISOString(),
      count: unmatched.length,
      paidPositiveCount: paidPositive.length,
      netTotalChf,
      paidPositiveNetChf,
      note: "Commande Shopify sans aucune ligne OrderMatch = coût d'achat inconnu",
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
