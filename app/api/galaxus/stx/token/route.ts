import { NextRequest, NextResponse } from "next/server";
import { writeGalaxusStockxToken } from "@/lib/stockxGalaxusAuth";
import { persistSupplierToken } from "@/lib/stockxToken";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing token" }, { status: 400 });
    }
    await writeGalaxusStockxToken(token);
    // Keep DB StockXToken in sync so backfill / getSupplierToken see the same bearer.
    await persistSupplierToken(token).catch((err) => {
      console.warn("[GALAXUS][STX][TOKEN] DB persist skipped:", err?.message ?? err);
    });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to save token" },
      { status: 500 }
    );
  }
}
