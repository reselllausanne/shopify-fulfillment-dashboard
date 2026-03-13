import { NextResponse } from "next/server";
import { buildDelrXmlForShipment, uploadDelrForShipment } from "@/galaxus/warehouse/delr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  try {
    const { shipmentId } = await params;
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
    console.error("[GALAXUS][SHIPMENT][DELR][DOWNLOAD] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to build DELR" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  try {
    const { shipmentId } = await params;
    await request.json().catch(() => ({}));
    const { searchParams } = new URL(request.url);
    const force = ["1", "true", "yes"].includes((searchParams.get("force") ?? "").toLowerCase());
    const result = await uploadDelrForShipment(shipmentId, { force });
    const status = result.httpStatus ?? (result.status === "error" ? 500 : 200);
    return NextResponse.json({ ok: result.status !== "error", result }, { status });
  } catch (error: any) {
    console.error("[GALAXUS][SHIPMENT][DELR] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
