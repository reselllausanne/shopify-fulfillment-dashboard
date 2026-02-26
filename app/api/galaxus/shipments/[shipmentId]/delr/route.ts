import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { uploadDelrForShipment } from "@/galaxus/warehouse/delr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  try {
    const { shipmentId } = await params;
    const body = await request.json().catch(() => ({}));
    const force = Boolean(body?.force);
    const autoShip = Boolean(body?.autoShip);
    if (autoShip) {
      const delayDays = Number.isFinite(Number(body?.delayDays)) ? Number(body.delayDays) : 2;
      const trackingNumber = buildUpsTrackingNumber();
      const shippedAt = new Date();
      await prisma.shipment.update({
        where: { id: shipmentId },
        data: {
          shippedAt,
          trackingNumber,
          carrierFinal: "UPS",
          carrierRaw: "UPS",
        },
      });
      const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
      if (shipment?.orderId) {
        const deliveryDate = new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000);
        await prisma.galaxusOrder.update({
          where: { id: shipment.orderId },
          data: { deliveryDate },
        });
      }
    }
    const result = await uploadDelrForShipment(shipmentId, { force });
    const status = result.httpStatus ?? (result.status === "error" ? 500 : 200);
    return NextResponse.json({ ok: result.status !== "error", result }, { status });
  } catch (error: any) {
    console.error("[GALAXUS][SHIPMENT][DELR] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

function buildUpsTrackingNumber(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let suffix = "";
  for (let i = 0; i < 16; i += 1) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `1Z${suffix}`;
}
