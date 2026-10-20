import { NextRequest, NextResponse } from "next/server";
import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";
import { buildStockxDailyRecap, sendStockxDailyRecap } from "@/lib/stockxDailyRecap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function isLocalCron(req: NextRequest): boolean {
  const host = (req.headers.get("host") || "").toLowerCase();
  return host.startsWith("127.0.0.1") || host.startsWith("localhost");
}

export async function POST(req: NextRequest) {
  try {
    const role = await getStaffRoleFromRequest(req);
    if (role !== "admin" && !isLocalCron(req)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const hours = Math.min(168, Math.max(1, Number(body.hours ?? 24)));
    const dryRun = Boolean(body.dryRun);
    const recap = dryRun ? await buildStockxDailyRecap(hours) : await sendStockxDailyRecap(hours);
    const sent = "sent" in recap ? recap.sent : false;

    return NextResponse.json({
      ok: dryRun || sent,
      sent,
      dryRun,
      subject: recap.subject,
      text: recap.text,
      stats: recap.stats,
    });
  } catch (error: any) {
    console.error("[STOCKX-DAILY-RECAP] Error:", error?.message || error);
    return NextResponse.json({ ok: false, error: error?.message || "Internal error" }, { status: 500 });
  }
}
