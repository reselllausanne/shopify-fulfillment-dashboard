import { NextResponse } from "next/server";
import { resetDelrForShipment } from "@/galaxus/warehouse/resetDelr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/galaxus/shipments/:shipmentId/reset-delr
 *
 * Rolls back a FULFILLED/UPLOADED shipment that was never actually ingested by Galaxus
 * (e.g. the DELR file was manually removed from the SFTP before processing).
 *
 * After the reset:
 *   - shipment.status         → MANUAL
 *   - shipment.delrSentAt     → null
 *   - shipment.delrFileName   → null
 *   - shipment.delrStatus     → PENDING
 *   - shipment.galaxusShippedAt → cleared
 *   - warehouseMarkedShippedAt → cleared on affected order lines
 *
 * The shipment can then be deleted and re-created with the correct items.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  try {
    const { shipmentId } = await params;
    const result = await resetDelrForShipment(shipmentId);
    const httpStatus = result.httpStatus ?? (result.ok ? 200 : 500);
    return NextResponse.json({ ok: result.ok, result }, { status: httpStatus });
  } catch (error: any) {
    console.error("[GALAXUS][SHIPMENT][RESET-DELR] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Reset DELR failed" }, { status: 500 });
  }
}
