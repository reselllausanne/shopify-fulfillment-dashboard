import { NextResponse } from "next/server";
import { sendOutgoingEdi, sendPendingOutgoingEdi } from "@/galaxus/edi/service";
import type { EdiDocType } from "@/galaxus/edi/filenames";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode = body?.mode ?? "single";
    if (mode === "pending") {
      const limit = Number(body?.limit ?? 5);
      const results = await sendPendingOutgoingEdi(limit);
      return NextResponse.json({ ok: true, results });
    }

    const orderId = body?.orderId as string | undefined;
    const types = (body?.types as EdiDocType[] | undefined) ?? ["ORDR", "DELR", "INVO", "EXPINV"];
    const ordrMode =
      body?.ordrMode === "WITH_ARRIVAL_DATES" || body?.ordrMode === "WITHOUT_POSITIONS"
        ? (body.ordrMode as "WITH_ARRIVAL_DATES" | "WITHOUT_POSITIONS")
        : undefined;
    const forceDelr = Boolean(body?.forceDelr);
    if (!orderId) {
      return NextResponse.json({ ok: false, error: "orderId is required" }, { status: 400 });
    }
    const results = await sendOutgoingEdi({ orderId, types, ordrMode, forceDelr });
    return NextResponse.json({ ok: true, results });
  } catch (error: any) {
    console.error("[GALAXUS][EDI][SEND] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
