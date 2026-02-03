import { NextRequest, NextResponse } from "next/server";
import { sendMilestoneEmailForMatch } from "@/app/lib/notifications/stockxEmail";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const matchId = String(body.matchId || "");
    const force = Boolean(body.force);
    const skipIfFulfilled = body.skipIfFulfilled !== false;
    const skipIfEtaPassed = body.skipIfEtaPassed !== false;

    if (!matchId) {
      return NextResponse.json({ ok: false, error: "Missing matchId" }, { status: 400 });
    }

    const result = await sendMilestoneEmailForMatch({
      matchId,
      force,
      skipIfFulfilled,
      skipIfEtaPassed,
    });

    if (result.ok === false && result.error === "Match not found") {
      return NextResponse.json(result, { status: 404 });
    }
    if (result.ok === false) {
      return NextResponse.json(result, { status: 500 });
    }
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[SEND-ONE] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to send" },
      { status: 500 }
    );
  }
}

