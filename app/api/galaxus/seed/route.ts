import { NextResponse } from "next/server";
import { seedGalaxusOrder } from "@/galaxus/seed/seedOrder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const order = await seedGalaxusOrder({ lineCount: 120 });
    return NextResponse.json({ ok: true, orderId: order.id, galaxusOrderId: order.galaxusOrderId });
  } catch (error: any) {
    console.error("[GALAXUS][SEED] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
