import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  try {
    await request.json().catch(() => ({}));
    const { shipmentId } = await params;
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        orderId: true,
        status: true,
        delrSentAt: true,
        delrStatus: true,
      },
    });
    if (!shipment) {
      return NextResponse.json({ ok: false, error: "Shipment not found" }, { status: 404 });
    }
    const status = String(shipment.status ?? "").toUpperCase();
    const delrStatus = String(shipment.delrStatus ?? "").toUpperCase();
    if (shipment.delrSentAt || delrStatus === "UPLOADED") {
      return NextResponse.json(
        { ok: false, error: "Cannot delete a shipment with DELR sent/uploaded" },
        { status: 409 }
      );
    }
    if (status !== "MANUAL") {
      return NextResponse.json(
        { ok: false, error: "Only manual shipments can be deleted" },
        { status: 409 }
      );
    }
    await prisma.$transaction(async (tx) => {
      await tx.shipmentItem.deleteMany({ where: { shipmentId } });
      await tx.document.deleteMany({ where: { shipmentId } });
      await tx.shipment.delete({ where: { id: shipmentId } });
    });
    return NextResponse.json({ ok: true, shipmentId, orderId: shipment.orderId ?? null });
  } catch (error: any) {
    console.error("[GALAXUS][SHIPMENTS] Delete failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Delete shipment failed" },
      { status: 500 }
    );
  }
}
