import { NextResponse } from "next/server";
import { getFeedSchedulerStatus, runFeedSchedulerTick } from "@/galaxus/jobs/feedScheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const origin = new URL(request.url).origin;
    const results = await runFeedSchedulerTick(origin);
    const status = await getFeedSchedulerStatus();
    return NextResponse.json({ ok: true, results, status });
  } catch (error: any) {
    console.error("[GALAXUS][FEEDS][CRON] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Scheduler failed" }, { status: 500 });
  }
}
