import { NextResponse } from "next/server";
import { syncStockxInboundPackagesFromStockxApi } from "@/app/lib/stockxInboundSyncFromApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Refresh the last-N StockX inbound packages used by Shopify AWB fallback.
 * Pulls directly from the StockX buying API (PENDING + HISTORICAL) for every
 * Shopify-side StockX account. The legacy DB-copy path is gone.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const limitPerAccount = Math.max(
      1,
      Math.min(500, Number(body?.limit ?? body?.limitPerAccount ?? 100))
    );
    const maxPages = Math.max(1, Number(body?.maxPages ?? 4));
    const concurrency = Math.max(1, Number(body?.concurrency ?? 2));

    const result = await syncStockxInboundPackagesFromStockxApi({
      limitPerAccount,
      maxPages,
      concurrency,
    });
    return NextResponse.json({ ...result, limit: limitPerAccount });
  } catch (error: any) {
    console.error("[STOCKX-INBOUND-PACKAGES] sync failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
