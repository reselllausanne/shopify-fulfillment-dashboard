import { NextResponse } from "next/server";
import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";
import { reopenPhantomDirectShipment } from "@/galaxus/directDelivery/directPartialShip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const staffRole = await getStaffRoleFromRequest(request as any);
    if (!staffRole) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { orderId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      confirm?: boolean;
      shipmentBusinessId?: string;
    };

    const result = await reopenPhantomDirectShipment(orderId, {
      confirm: Boolean(body?.confirm),
      shipmentBusinessId: String(body?.shipmentBusinessId ?? "").trim() || undefined,
    });

    if (!result.ok) {
      const status = result.error === "Order not found" ? 404 : 400;
      return NextResponse.json(result, { status });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[GALAXUS][SHIPMENTS][REOPEN] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Reopen failed" },
      { status: 500 }
    );
  }
}
