import { NextRequest, NextResponse } from "next/server";
import { writeGalaxusStockxToken } from "@/lib/stockxGalaxusAuth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing token" }, { status: 400 });
    }
    await writeGalaxusStockxToken(token);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to save token" },
      { status: 500 }
    );
  }
}
