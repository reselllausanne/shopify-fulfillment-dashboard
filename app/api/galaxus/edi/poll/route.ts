import { NextResponse } from "next/server";
import { runEdiInPipeline } from "@/galaxus/ops/orderPipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const pipeline = await runEdiInPipeline();
    return NextResponse.json({ ok: true, pipeline });
  } catch (error: any) {
    console.error("[GALAXUS][EDI][POLL] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}
