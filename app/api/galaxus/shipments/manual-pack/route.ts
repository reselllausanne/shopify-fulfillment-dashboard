import { NextResponse } from "next/server";
import { createManualShipmentsForOrder } from "@/galaxus/warehouse/shipments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const orderId = body?.orderId ? String(body.orderId) : null;
    const packages = Array.isArray(body?.packages) ? body.packages : [];
    if (!orderId) {
      return NextResponse.json({ ok: false, error: "orderId is required" }, { status: 400 });
    }
    if (!packages.length) {
      return NextResponse.json({ ok: false, error: "packages are required" }, { status: 400 });
    }

    const result = await createManualShipmentsForOrder({
      orderId,
      packages,
      trackingNumbers: Array.isArray(body?.trackingNumbers) ? body.trackingNumbers : undefined,
      carrierRaw: body?.carrierRaw ?? undefined,
      carrierFinal: body?.carrierFinal ?? undefined,
      shippedAt: body?.shippedAt ? new Date(body.shippedAt) : undefined,
      deliveryType: body?.deliveryType ?? undefined,
      packageType: body?.packageType ?? undefined,
    });

    return NextResponse.json({ ok: result.status !== "error", result });
  } catch (error: any) {
    console.error("[GALAXUS][SHIPMENTS] Manual pack failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
