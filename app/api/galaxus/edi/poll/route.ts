import { NextResponse } from "next/server";
import { pollIncomingEdi } from "@/galaxus/edi/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const results = await pollIncomingEdi();
    return NextResponse.json({ ok: true, results });
  } catch (error: any) {
    console.error("[GALAXUS][EDI][POLL] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}
