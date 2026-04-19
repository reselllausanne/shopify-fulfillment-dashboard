import { NextResponse } from "next/server";
import { fetchStockxBuyOrderDetails } from "@/galaxus/stx/stockxClient";
import { readGalaxusStockxToken } from "@/lib/stockxGalaxusAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const token = await readGalaxusStockxToken();
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing Galaxus StockX token file" }, { status: 409 });
    }

    const { searchParams } = new URL(request.url);
    const chainId = (searchParams.get("chainId") ?? "").trim();
    const orderId = (searchParams.get("orderId") ?? "").trim();
    if (!chainId || !orderId) {
      return NextResponse.json({ ok: false, error: "chainId and orderId are required" }, { status: 400 });
    }

    const details = await fetchStockxBuyOrderDetails(token, { chainId, orderId });
    return NextResponse.json({
      ok: true,
      chainId,
      orderId,
      awb: details.awb ?? null,
      etaMin: details.etaMin ? details.etaMin.toISOString() : null,
      etaMax: details.etaMax ? details.etaMax.toISOString() : null,
      order: details.order ?? null,
    });
  } catch (error: any) {
    console.error("[GALAXUS][STX][BUY_ORDER_DETAILS] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to fetch StockX order details" },
      { status: 500 }
    );
  }
}

