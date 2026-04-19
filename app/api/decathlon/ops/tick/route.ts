import { NextResponse } from "next/server";
import { runDecathlonOpsTick } from "@/decathlon/ops/tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const force = searchParams.get("force") === "1";
    const only = searchParams.get("only")?.split(",").map((s) => s.trim()).filter(Boolean);
    const res = await runDecathlonOpsTick("api", { force, only });
    return NextResponse.json(res);
  } catch (error: any) {
    console.error("[DECATHLON][OPS][TICK] Failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Tick failed" },
      { status: 500 }
    );
  }
}
