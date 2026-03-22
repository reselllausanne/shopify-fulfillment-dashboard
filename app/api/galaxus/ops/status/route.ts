import { NextResponse } from "next/server";
import { getOpsStatus } from "@/galaxus/ops/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getOpsStatus();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("[GALAXUS][OPS][STATUS] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Status failed" },
      { status: 500 }
    );
  }
}
