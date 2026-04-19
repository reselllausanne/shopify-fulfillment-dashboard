import { NextResponse } from "next/server";
import { getDecathlonOpsStatus } from "@/decathlon/ops/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getDecathlonOpsStatus();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("[DECATHLON][OPS][STATUS] Failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Status failed" },
      { status: 500 }
    );
  }
}
