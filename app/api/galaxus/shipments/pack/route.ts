import { NextResponse } from "next/server";
import { createShipmentsForOrder } from "@/galaxus/warehouse/shipments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const orderId = body?.orderId ? String(body.orderId) : null;
    if (!orderId) {
      return NextResponse.json({ ok: false, error: "orderId is required" }, { status: 400 });
    }

    const result = await createShipmentsForOrder({
      orderId,
      maxPairsPerParcel: body?.maxPairsPerParcel ? Number(body.maxPairsPerParcel) : undefined,
      allowSplit: body?.allowSplit ?? true,
      trackingNumbers: Array.isArray(body?.trackingNumbers) ? body.trackingNumbers : undefined,
      carrierRaw: body?.carrierRaw ?? undefined,
      carrierFinal: body?.carrierFinal ?? undefined,
      shippedAt: body?.shippedAt ? new Date(body.shippedAt) : undefined,
      deliveryType: body?.deliveryType ?? undefined,
      packageType: body?.packageType ?? undefined,
      force: body?.force ?? false,
    });

    return NextResponse.json({ ok: result.status !== "error", result });
  } catch (error: any) {
    console.error("[GALAXUS][SHIPMENTS] Pack failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
