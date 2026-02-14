import { NextResponse } from "next/server";
import { getFeedSchedulerStatus, startFeedScheduler, stopFeedScheduler } from "@/galaxus/jobs/feedScheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const status = getFeedSchedulerStatus();
  return NextResponse.json({ ok: true, status });
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = (searchParams.get("action") ?? "start").toLowerCase();
  const origin = new URL(request.url).origin;

  if (action === "stop") {
    const status = stopFeedScheduler();
    return NextResponse.json({ ok: true, status });
  }

  const status = await startFeedScheduler(origin, true);
  return NextResponse.json({ ok: true, status });
}
