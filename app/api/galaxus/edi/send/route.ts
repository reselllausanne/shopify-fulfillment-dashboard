import { NextResponse } from "next/server";
import { buildOutgoingEdiXml, sendOutgoingEdi, sendPendingOutgoingEdi } from "@/galaxus/edi/service";
import type { EdiDocType } from "@/galaxus/edi/filenames";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const download = ["1", "true", "yes"].includes((searchParams.get("download") ?? "").toLowerCase());
    if (!download) {
      return NextResponse.json({ ok: false, error: "Missing download=1" }, { status: 400 });
    }
    const orderId = (searchParams.get("orderId") ?? "").trim();
    const type = (searchParams.get("type") ?? "").trim().toUpperCase() as EdiDocType;
    const force = ["1", "true", "yes"].includes((searchParams.get("force") ?? "").toLowerCase());
    const rawLineIds = (searchParams.get("lineIds") ?? "").trim();
    const lineIds = rawLineIds
      ? rawLineIds
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : undefined;
    if (!orderId) {
      return NextResponse.json({ ok: false, error: "orderId is required" }, { status: 400 });
    }
    if (!type || (type !== "ORDR" && type !== "INVO" && type !== "CANR" && type !== "EOLN")) {
      return NextResponse.json({ ok: false, error: "Invalid type" }, { status: 400 });
    }

    const edi = await buildOutgoingEdiXml({ orderId, type, force, lineIds });
    return new NextResponse(edi.content, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${edi.filename}"`,
      },
    });
  } catch (error: any) {
    console.error("[GALAXUS][EDI][SEND][DOWNLOAD] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Download failed" }, { status: 500 });
  }
}

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
    const types = (body?.types as EdiDocType[] | undefined) ?? ["ORDR", "DELR", "INVO"];
    const force = Boolean(body?.force);
    const lineIdsRaw = Array.isArray(body?.lineIds) ? body.lineIds : undefined;
    const lineIds =
      lineIdsRaw && lineIdsRaw.length > 0
        ? lineIdsRaw.map((value: any) => String(value)).filter((value: string) => value.trim().length > 0)
        : undefined;
    const ordrMode =
      body?.ordrMode === "WITH_ARRIVAL_DATES" || body?.ordrMode === "WITHOUT_POSITIONS"
        ? (body.ordrMode as "WITH_ARRIVAL_DATES" | "WITHOUT_POSITIONS")
        : undefined;
    if (!orderId) {
      return NextResponse.json({ ok: false, error: "orderId is required" }, { status: 400 });
    }
    const results = await sendOutgoingEdi({ orderId, types, ordrMode, force, lineIds });
    return NextResponse.json({ ok: true, results });
  } catch (error: any) {
    console.error("[GALAXUS][EDI][SEND] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
