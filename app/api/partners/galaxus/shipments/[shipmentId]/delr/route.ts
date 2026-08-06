import { NextRequest, NextResponse } from "next/server";
import { buildDelrXmlForShipment, uploadDelrForShipment } from "@/galaxus/warehouse/delr";
import { requirePartnerSelfFulfillAccess } from "@/app/api/partners/galaxus/_auth";
import { loadPartnerShipment } from "@/app/api/partners/galaxus/shipments/_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  try {
    const auth = await requirePartnerSelfFulfillAccess(request);
    if (!auth.access) return auth.response!;
    const access = auth.access;
    const { shipmentId } = await params;
    const shipment = await loadPartnerShipment(shipmentId, access.providerKey);
    if (!shipment) {
      return NextResponse.json({ ok: false, error: "Shipment not found" }, { status: 404 });
    }
    const { searchParams } = new URL(request.url);
    const download = ["1", "true", "yes"].includes((searchParams.get("download") ?? "").toLowerCase());
    if (!download) {
      return NextResponse.json({ ok: false, error: "Missing download=1" }, { status: 400 });
    }
    const force = ["1", "true", "yes"].includes((searchParams.get("force") ?? "").toLowerCase());
    const edi = await buildDelrXmlForShipment(shipmentId, { force });
    return new Response(edi.content as unknown as BodyInit, {
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "content-disposition": `attachment; filename="${edi.filename}"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed to build DELR" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  try {
    const auth = await requirePartnerSelfFulfillAccess(request);
    if (!auth.access) return auth.response!;
    const access = auth.access;
    const { shipmentId } = await params;
    const shipment = await loadPartnerShipment(shipmentId, access.providerKey);
    if (!shipment) {
      return NextResponse.json({ ok: false, error: "Shipment not found" }, { status: 404 });
    }
    const { searchParams } = new URL(request.url);
    const force = ["1", "true", "yes"].includes((searchParams.get("force") ?? "").toLowerCase());
    const result = await uploadDelrForShipment(shipmentId, {
      force,
      actor: {
        type: "partner",
        partnerId: access.session.partnerId,
        partnerKey: access.session.partnerKey,
      },
    });
    const status = result.httpStatus ?? (result.status === "error" ? 500 : 200);
    return NextResponse.json({ ok: result.status !== "error", result }, { status });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed to upload DELR" }, { status: 500 });
  }
}
