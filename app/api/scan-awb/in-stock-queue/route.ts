import { NextResponse } from "next/server";
import { listInStockShipQueue } from "@/lib/scanInStockQueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Open ship-from-me units that still sit in warehouse / magasin stock.
 * Powers the /scan right-rail panel.
 */
export async function GET() {
  try {
    const items = await listInStockShipQueue();
    return NextResponse.json({
      ok: true,
      count: items.length,
      items,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[SCAN][in-stock-queue]", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to load in-stock queue" },
      { status: 500 }
    );
  }
}
