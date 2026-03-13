import { NextResponse } from "next/server";
import { DocumentType } from "@prisma/client";
import { DocumentService } from "@/galaxus/documents/DocumentService";
import { getStxLinkStatusForShipment } from "@/galaxus/stx/purchaseUnits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  try {
    const { shipmentId } = await params;
    const { searchParams } = new URL(request.url);
    const force = ["1", "true", "yes"].includes((searchParams.get("force") ?? "").toLowerCase());
    const stxStatus = await getStxLinkStatusForShipment(shipmentId).catch(() => null);
    if (stxStatus?.hasStxItems && !stxStatus.allLinked && !force) {
      return NextResponse.json(
        { ok: false, error: "StockX units are not fully linked yet", stx: stxStatus },
        { status: 409 }
      );
    }
    if (stxStatus?.hasStxItems && !stxStatus.allEtaPresent && !force) {
      return NextResponse.json(
        { ok: false, error: "StockX linked units are missing ETA bounds", stx: stxStatus },
        { status: 409 }
      );
    }
    const service = new DocumentService();
    const documents = await service.generateForShipment({
      shipmentId,
      types: [DocumentType.DELIVERY_NOTE, DocumentType.LABEL],
    });
    return NextResponse.json({ ok: true, documents, forced: force });
  } catch (error: any) {
    console.error("[GALAXUS][SHIPMENT][DOCS] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to generate shipment docs" },
      { status: 500 }
    );
  }
}
