import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import {
  SHOPIFY_FULFILL_FEE_MARKER_PREFIX,
  SHOPIFY_FULFILL_SHIP_MARKER_PREFIX,
  defaultShopifyFulfillExpensesSince,
  syncShopifyFulfillmentExpenses,
} from "@/shopify/fulfillmentExpenses";
import { toNumberSafe } from "@/app/utils/numbers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — list recoverable Shopify fulfill ship/fee Business expenses (year-end).
 * POST — backfill/sync expenses for fulfilled shoe orders (default last 2 months).
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) dateFilter.lte = new Date(to);

    const rows = await prisma.personalExpense.findMany({
      where: {
        isBusiness: true,
        ...(Object.keys(dateFilter).length ? { date: dateFilter } : {}),
        OR: [
          { note: { contains: SHOPIFY_FULFILL_SHIP_MARKER_PREFIX } },
          { note: { contains: SHOPIFY_FULFILL_FEE_MARKER_PREFIX } },
        ],
      },
      include: {
        category: { select: { name: true, type: true } },
        account: { select: { name: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });

    const totals = {
      shipChf: 0,
      feeChf: 0,
      totalChf: 0,
      shipCount: 0,
      feeCount: 0,
    };
    for (const r of rows) {
      const amt = toNumberSafe(r.amount, 0);
      totals.totalChf += amt;
      if (String(r.note ?? "").includes(SHOPIFY_FULFILL_SHIP_MARKER_PREFIX)) {
        totals.shipChf += amt;
        totals.shipCount += 1;
      } else {
        totals.feeChf += amt;
        totals.feeCount += 1;
      }
    }

    return NextResponse.json({
      success: true,
      count: rows.length,
      totals: {
        shipChf: Number(totals.shipChf.toFixed(2)),
        feeChf: Number(totals.feeChf.toFixed(2)),
        totalChf: Number(totals.totalChf.toFixed(2)),
        shipCount: totals.shipCount,
        feeCount: totals.feeCount,
      },
      expenses: rows.map((r) => ({
        id: r.id,
        date: r.date.toISOString().slice(0, 10),
        amount: toNumberSafe(r.amount, 0),
        category: r.category?.name ?? null,
        account: r.account?.name ?? null,
        note: r.note,
        isBusiness: r.isBusiness,
      })),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to list Shopify fulfillment expenses" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const sinceRaw = body?.since ? String(body.since) : null;
    const limit = body?.limit != null ? Number(body.limit) : undefined;
    const since = sinceRaw ? new Date(sinceRaw) : defaultShopifyFulfillExpensesSince();
    if (Number.isNaN(since.getTime())) {
      return NextResponse.json({ error: "Invalid since date" }, { status: 400 });
    }

    const result = await syncShopifyFulfillmentExpenses({
      since,
      limit: Number.isFinite(limit) ? limit : undefined,
    });

    return NextResponse.json({
      success: true,
      since: since.toISOString(),
      ...result,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to sync Shopify fulfillment expenses" },
      { status: 500 }
    );
  }
}
