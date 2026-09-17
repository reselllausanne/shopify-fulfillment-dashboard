import { NextResponse } from "next/server";
import { syncStockxInboundPackagesFromDb } from "@/app/lib/stockxInboundPackages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Refresh the last-N StockX inbound packages used by AWB Shopify fallback. */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const limit = Number(body?.limit ?? 100);
    const result = await syncStockxInboundPackagesFromDb({ limit });
    return NextResponse.json({ ok: true, ...result, limit });
  } catch (error: any) {
    console.error("[STOCKX-INBOUND-PACKAGES] sync failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
