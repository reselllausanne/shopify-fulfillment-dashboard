import { NextResponse } from "next/server";
import { runKickdbEnrich } from "@/galaxus/kickdb/enrichJob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") ?? "50");
    const offset = Number(searchParams.get("offset") ?? "0");
    const debug = searchParams.get("debug") === "1";
    const force = searchParams.get("force") === "1";
    const raw = searchParams.get("raw") === "1";
    const supplierVariantId = searchParams.get("supplierVariantId")?.trim() || null;
    const supplierSku = searchParams.get("supplierSku")?.trim() || null;

    const { results } = await runKickdbEnrich({
      limit,
      offset,
      debug,
      force,
      raw,
      supplierVariantId,
      supplierSku,
    });

    return NextResponse.json({ ok: true, limit, offset, results });
  } catch (error: any) {
    console.error("[GALAXUS][KICKDB][ENRICH] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
