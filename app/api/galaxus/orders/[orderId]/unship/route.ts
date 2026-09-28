import { NextResponse } from "next/server";
import { unshipGalaxusDirectOrder } from "@/galaxus/directDelivery/unshipDirectOrder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/galaxus/orders/:orderId/unship
 *
 * Mistake recovery: put a direct-delivery order back to unfulfilled by resetting
 * DELR flags, deleting shipments, and clearing warehouseMarkedShippedAt.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const result = await unshipGalaxusDirectOrder(orderId);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error ?? result.message, result },
        { status: result.error?.includes("not found") ? 404 : 400 }
      );
    }
    return NextResponse.json({ ok: true, result });
  } catch (error: any) {
    console.error("[GALAXUS][DIRECT][UNSHIP] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Unship failed" },
      { status: 500 }
    );
  }
}
