import { NextResponse } from "next/server";
import { backfillInventoryLedger } from "@/inventory/backfill";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const prismaAny = prisma as any;
    const [events, lineStates, listings] = await Promise.all([
      prismaAny.inventoryEvent?.count?.() ?? 0,
      prismaAny.orderLineSyncState?.count?.() ?? 0,
      prismaAny.channelListingState?.count?.() ?? 0,
    ]);
    return NextResponse.json({
      ok: true,
      counts: {
        inventoryEvents: events,
        orderLineSyncStates: lineStates,
        channelListingStates: listings,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Inventory status failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const limitPerChannel = Number(body?.limitPerChannel ?? body?.limit ?? 500);
    const dryRun = Boolean(body?.dryRun);
    const result = await backfillInventoryLedger({ limitPerChannel, dryRun });
    return NextResponse.json({ ok: true, result });
  } catch (error: any) {
    console.error("[INVENTORY][BACKFILL] Failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Backfill failed" },
      { status: 500 }
    );
  }
}
