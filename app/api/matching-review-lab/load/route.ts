import { NextResponse } from "next/server";
import {
  loadMatchingReviewBatch,
  putBatch,
  slimUnitForClient,
  type LabChannel,
} from "@/matching-review-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Matching Review Lab — load open client units + StockX snapshot (server-held).
 * Returns slim units + batchId. Never ships full StockX buys to the browser.
 * Dry-run only. Never writes OrderMatch.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(300, Number(body?.limit ?? 150)));
    const channelsRaw = Array.isArray(body?.channels)
      ? (body.channels as string[])
      : ["SHOPIFY", "GALAXUS", "DECATHLON"];
    const channels = channelsRaw.filter(
      (c): c is LabChannel =>
        c === "SHOPIFY" || c === "GALAXUS" || c === "DECATHLON"
    );
    const shopifyDays = Number(body?.shopifyDays ?? 30);
    const forceRefreshStockx = Boolean(body?.forceRefreshStockx);

    const batch = await loadMatchingReviewBatch({
      limit,
      channels: channels.length ? channels : ["SHOPIFY", "GALAXUS", "DECATHLON"],
      shopifyDays,
      forceRefreshStockx,
    });

    const snapshot = putBatch({
      units: batch.units,
      buys: batch.buys,
      freshness: batch.freshness,
      meta: batch.meta,
    });

    return NextResponse.json({
      ok: true,
      wroteLiveMatch: false,
      batchId: snapshot.batchId,
      units: snapshot.units.map(slimUnitForClient),
      buyCount: snapshot.buys.length,
      freshness: snapshot.freshness,
      meta: snapshot.meta,
      warnings: batch.warnings,
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
