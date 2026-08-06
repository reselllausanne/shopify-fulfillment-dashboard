import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import {
  GALAXUS_DELR_PACK_MARKER_PREFIX,
  GALAXUS_DELR_SHIP_MARKER_PREFIX,
  syncGalaxusDelrFulfillmentExpensesForUploaded,
} from "@/galaxus/warehouse/delrFulfillmentExpenses";
import { toNumberSafe } from "@/app/utils/numbers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — list recoverable Galaxus DELR pack/ship Business expenses (year-end).
 * POST — backfill/sync expenses for uploaded DELRs.
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
          { note: { contains: GALAXUS_DELR_PACK_MARKER_PREFIX } },
          { note: { contains: GALAXUS_DELR_SHIP_MARKER_PREFIX } },
        ],
      },
      include: {
        category: { select: { name: true, type: true } },
        account: { select: { name: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });

    const totals = {
      packChf: 0,
      shipChf: 0,
      totalChf: 0,
      packCount: 0,
      shipCount: 0,
    };
    for (const r of rows) {
      const amt = toNumberSafe(r.amount, 0);
      totals.totalChf += amt;
      if (String(r.note ?? "").includes(GALAXUS_DELR_PACK_MARKER_PREFIX)) {
        totals.packChf += amt;
        totals.packCount += 1;
      } else {
        totals.shipChf += amt;
        totals.shipCount += 1;
      }
    }

    return NextResponse.json({
      success: true,
      count: rows.length,
      totals: {
        packChf: Number(totals.packChf.toFixed(2)),
        shipChf: Number(totals.shipChf.toFixed(2)),
        totalChf: Number(totals.totalChf.toFixed(2)),
        packCount: totals.packCount,
        shipCount: totals.shipCount,
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
      { error: error?.message ?? "Failed to list DELR fulfillment expenses" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const sinceRaw = body?.since ? String(body.since) : null;
    const limit = body?.limit != null ? Number(body.limit) : undefined;
    const since = sinceRaw ? new Date(sinceRaw) : null;
    if (sinceRaw && Number.isNaN(since?.getTime())) {
      return NextResponse.json({ error: "Invalid since date" }, { status: 400 });
    }

    const result = await syncGalaxusDelrFulfillmentExpensesForUploaded({
      since,
      limit: Number.isFinite(limit) ? limit : undefined,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to sync DELR fulfillment expenses" },
      { status: 500 }
    );
  }
}
