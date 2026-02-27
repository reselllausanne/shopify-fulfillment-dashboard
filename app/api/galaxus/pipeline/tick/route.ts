import { NextResponse } from "next/server";
import { runGalaxusPipelineTick } from "@/galaxus/jobs/pipelineScheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const origin = new URL(request.url).origin;
    const { searchParams } = new URL(request.url);
    const force = ["1", "true", "yes"].includes((searchParams.get("force") ?? "").toLowerCase());
    const onlyRaw = searchParams.get("only") ?? "";
    const onlyJobs = onlyRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const data = await runGalaxusPipelineTick(origin, { force, onlyJobs });
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("[GALAXUS][PIPELINE][TICK] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Tick failed" }, { status: 500 });
  }
}

