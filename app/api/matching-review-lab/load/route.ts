import { NextResponse } from "next/server";
import { loadMatchingReviewBatch, type LabChannel } from "@/matching-review-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Matching Review Lab — load open client units + StockX snapshot.
 * Dry-run only. Never writes OrderMatch.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const limit = Number(body?.limit ?? 120);
    const channelsRaw = Array.isArray(body?.channels)
      ? (body.channels as string[])
      : ["SHOPIFY", "GALAXUS"];
    const channels = channelsRaw.filter(
      (c): c is LabChannel => c === "SHOPIFY" || c === "GALAXUS"
    );
    const shopifyDays = Number(body?.shopifyDays ?? 30);
    const forceRefreshStockx = Boolean(body?.forceRefreshStockx);

    const batch = await loadMatchingReviewBatch({
      limit,
      channels: channels.length ? channels : ["SHOPIFY", "GALAXUS"],
      shopifyDays,
      forceRefreshStockx,
    });

    return NextResponse.json({
      ok: true,
      wroteLiveMatch: false,
      units: batch.units,
      buys: batch.buys.map((b) => ({
        ...b,
        rawNode: undefined,
      })),
      freshness: batch.freshness,
      meta: batch.meta,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
