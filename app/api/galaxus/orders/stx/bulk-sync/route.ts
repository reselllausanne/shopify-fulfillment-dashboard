import { NextResponse } from "next/server";
import { runGalaxusBulkStxSync } from "@/galaxus/stx/bulkVisibleSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawIds = Array.isArray(body?.orderIds) ? body.orderIds : [];
    const orderIds = rawIds.map((id: unknown) => String(id ?? "").trim()).filter(Boolean);

    if (orderIds.length === 0) {
      return NextResponse.json({ ok: false, error: "orderIds required" }, { status: 400 });
    }

    const result = await runGalaxusBulkStxSync(orderIds);
    const status = result.ok ? 200 : result.error?.includes("token") ? 409 : 502;
    return NextResponse.json(result, { status: result.ok ? 200 : status });
  } catch (error: any) {
    console.error("[GALAXUS][STX][BULK_SYNC] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Bulk StockX sync failed" },
      { status: 500 }
    );
  }
}
