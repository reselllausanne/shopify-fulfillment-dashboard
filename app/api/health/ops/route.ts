import { NextRequest, NextResponse } from "next/server";

import { requireHealthAdmin } from "@/app/lib/healthAdminAuth";
import { getDebugSnapshot } from "@/healthdata/repository";
import { backfillCommand } from "@/healthdata/commands/backfill";
import { syncCommand } from "@/healthdata/commands/sync";

export async function GET(req: NextRequest) {
  const denied = await requireHealthAdmin(req);
  if (denied) return denied;
  const debug = await getDebugSnapshot();
  return NextResponse.json({ ok: true, debug });
}

export async function POST(req: NextRequest) {
  const denied = await requireHealthAdmin(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    days?: number;
    provider?: string;
  };

  if (body.action === "backfill") {
    const code = await backfillCommand({
      days: body.days ?? 90,
      provider: body.provider ?? "mock_garmin",
    });
    return NextResponse.json({ ok: code === 0, exitCode: code });
  }

  if (body.action === "sync") {
    const code = await syncCommand({
      provider: body.provider ?? "mock_garmin",
      lookbackDays: body.days ?? 3,
    });
    return NextResponse.json({ ok: code === 0, exitCode: code });
  }

  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
}
