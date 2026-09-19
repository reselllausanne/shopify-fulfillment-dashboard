import { NextResponse } from "next/server";
import { searchStockxBuys, type LabStockxBuy } from "@/matching-review-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Manual StockX buy search against the in-memory/snapshot buys payload. */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const buys = (body?.buys ?? []) as LabStockxBuy[];
    if (!Array.isArray(buys)) {
      return NextResponse.json({ ok: false, error: "buys array required" }, { status: 400 });
    }

    const hits = searchStockxBuys(buys, {
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
      hits: hits.map((b) => ({ ...b, rawNode: undefined })),
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
