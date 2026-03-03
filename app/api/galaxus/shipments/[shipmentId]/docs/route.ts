import { NextResponse } from "next/server";
import { DocumentType } from "@prisma/client";
import { DocumentService } from "@/galaxus/documents/DocumentService";
import { getStxLinkStatusForShipment } from "@/galaxus/stx/purchaseUnits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  try {
    const { shipmentId } = await params;
    const stxStatus = await getStxLinkStatusForShipment(shipmentId).catch(() => null);
    if (stxStatus?.hasStxItems && !stxStatus.allLinked) {
      return NextResponse.json(
        { ok: false, error: "StockX units are not fully linked yet", stx: stxStatus },
        { status: 409 }
      );
    }
    if (stxStatus?.hasStxItems && !stxStatus.allEtaPresent) {
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
    return NextResponse.json({ ok: true, documents });
  } catch (error: any) {
    console.error("[GALAXUS][SHIPMENT][DOCS] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to generate shipment docs" },
      { status: 500 }
    );
  }
}
