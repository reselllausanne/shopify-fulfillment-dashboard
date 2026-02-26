import { NextResponse } from "next/server";
import { uploadDelrForShipment } from "@/galaxus/warehouse/delr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  try {
    const { shipmentId } = await params;
    await request.json().catch(() => ({}));
    const result = await uploadDelrForShipment(shipmentId);
    const status = result.httpStatus ?? (result.status === "error" ? 500 : 200);
    return NextResponse.json({ ok: result.status !== "error", result }, { status });
  } catch (error: any) {
    console.error("[GALAXUS][SHIPMENT][DELR] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
