import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  try {
    const staffRole = await getStaffRoleFromRequest(request);
    if (!staffRole) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const { shipmentId } = await params;
    const body = await request.json().catch(() => ({}));
    const trackingNumber = body?.trackingNumber ? String(body.trackingNumber).trim() : null;
    const shippedAt = body?.shippedAt ? new Date(body.shippedAt) : new Date();
    const shipment = await prisma.shipment.update({
      where: { id: shipmentId },
      data: {
        shippedAt,
        ...(trackingNumber ? { trackingNumber } : {}),
      },
    });
    return NextResponse.json({
      ok: true,
      boxId: shipment.id,
      shippedAt: shipment.shippedAt,
      trackingNumber: shipment.trackingNumber ?? null,
    });
  } catch (error: any) {
    console.error("[GALAXUS][SHIPMENT][MARK-SHIPPED] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
