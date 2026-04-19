import { NextResponse } from "next/server";
import { GALAXUS_STOCKX_TOKEN_FILE, writeGalaxusStockxToken } from "@/lib/stockxGalaxusAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = String(body?.token ?? "").trim();
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing token" }, { status: 400 });
    }
    // Same file as Galaxus direct-delivery (one StockX account).
    await writeGalaxusStockxToken(token, GALAXUS_STOCKX_TOKEN_FILE);
    return NextResponse.json({ ok: true, tokenFile: GALAXUS_STOCKX_TOKEN_FILE });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Save token failed" },
      { status: 500 }
    );
  }
}
