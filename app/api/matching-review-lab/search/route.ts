import { NextResponse } from "next/server";
import {
  getBatch,
  searchStockxBuys,
  slimBuyForClient,
} from "@/matching-review-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Manual StockX buy search against the server-held batch snapshot. */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const batchId = String(body?.batchId ?? "").trim();
    if (!batchId) {
      return NextResponse.json({ ok: false, error: "batchId required" }, { status: 400 });
    }
    const batch = getBatch(batchId);
    if (!batch) {
      return NextResponse.json(
        { ok: false, error: "batch expired or unknown — reload lot" },
        { status: 404 }
      );
    }

    const hits = searchStockxBuys(batch.buys, {
      awb: body?.awb,
      buyOrderId: body?.buyOrderId,
      buyOrderNumber: body?.buyOrderNumber,
      gtin: body?.gtin,
      sku: body?.sku,
      name: body?.name,
      size: body?.size,
      limit: body?.limit,
    });

    return NextResponse.json({
      ok: true,
      count: hits.length,
      hits: hits.map(slimBuyForClient),
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
