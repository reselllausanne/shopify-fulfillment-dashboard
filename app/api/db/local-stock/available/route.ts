import { NextResponse } from "next/server";
import { getAvailableLocalStockLotsBySku } from "@/shopify/localStock/availableLocalStock";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const rows = await getAvailableLocalStockLotsBySku(body?.skus);
    return NextResponse.json({ ok: true, localStock: rows }, { status: 200 });
  } catch (error: any) {
    console.error("[local-stock/available] failed", error);
    return NextResponse.json(
      { ok: false, error: "Failed to load local stock", details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
