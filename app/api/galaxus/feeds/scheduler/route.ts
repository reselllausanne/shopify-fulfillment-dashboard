import { NextResponse } from "next/server";
import { getFeedSchedulerStatus, startFeedScheduler, stopFeedScheduler } from "@/galaxus/jobs/feedScheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cachedStatus: any | null = null;
let cachedAt: number | null = null;
const CACHE_TTL_MS = 30000;

export async function GET(request: Request) {
  const now = Date.now();
  if (cachedAt && cachedStatus && now - cachedAt < CACHE_TTL_MS) {
    return NextResponse.json({ ok: true, status: cachedStatus, cached: true });
  }
  try {
    const status = await getFeedSchedulerStatus();
    cachedStatus = status;
    cachedAt = now;
    return NextResponse.json({ ok: true, status });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message ?? "Scheduler status unavailable",
        status: cachedStatus ?? null,
      },
      { status: 503 }
    );
  }
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = (searchParams.get("action") ?? "start").toLowerCase();
  const origin = new URL(request.url).origin;

  if (action === "stop") {
    const status = await stopFeedScheduler();
    return NextResponse.json({ ok: true, status });
  }

  const status = await startFeedScheduler(origin, true);
  return NextResponse.json({ ok: true, status });
}
