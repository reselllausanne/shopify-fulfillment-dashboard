import { NextResponse } from "next/server";
import { runOpsTick } from "@/galaxus/ops/tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const force = ["1", "true", "yes"].includes((searchParams.get("force") ?? "").toLowerCase());
    const onlyRaw = searchParams.get("only") ?? "";
    const only = onlyRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const origin = new URL(request.url).origin;
    const data = await runOpsTick(origin, { force, only });
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("[GALAXUS][OPS][TICK] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Tick failed" }, { status: 500 });
  }
}
