import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { uploadDelrForShipment } from "@/galaxus/warehouse/delr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  const session = await getPartnerSession(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { shipmentId } = await params;
  const body = await req.json().catch(() => ({}));
  const trackingNumber = body?.trackingNumber ? String(body.trackingNumber).trim() : "";
  const carrier = body?.carrier ? String(body.carrier).trim() : "";
  const force = Boolean(body?.force);

  if (!shipmentId || !trackingNumber) {
    return NextResponse.json(
      { ok: false, error: "shipmentId and trackingNumber are required" },
      { status: 400 }
    );
  }

  const providerKey = normalizeProviderKey(session.partnerKey);
  if (!providerKey) {
    return NextResponse.json({ ok: false, error: "Invalid partner key" }, { status: 400 });
  }

  const shipment = await (prisma as any).shipment.findFirst({
    where: { id: shipmentId, providerKey },
  });
  if (!shipment) {
    return NextResponse.json({ ok: false, error: "Shipment not found" }, { status: 404 });
  }

  await (prisma as any).shipment.update({
    where: { id: shipmentId },
    data: {
      trackingNumber,
      carrierFinal: carrier || shipment.carrierFinal || null,
      carrierRaw: carrier || shipment.carrierRaw || null,
    },
  });

  const delr = await uploadDelrForShipment(shipmentId, { force });
  if (delr.status === "error") {
    return NextResponse.json({ ok: false, error: delr.message ?? "DELR upload failed", delr }, { status: 409 });
  }

  return NextResponse.json({ ok: true, delr });
}
