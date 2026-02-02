import { NextResponse } from "next/server";
import { seedGalaxusOrder } from "@/galaxus/seed/seedOrder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const lineCount = Math.max(1, Math.min(Number(body?.lineCount) || 120, 200));
    const order = await seedGalaxusOrder({ lineCount });
    return NextResponse.json({ ok: true, orderId: order.id, galaxusOrderId: order.galaxusOrderId });
  } catch (error: any) {
    console.error("[GALAXUS][SEED] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
