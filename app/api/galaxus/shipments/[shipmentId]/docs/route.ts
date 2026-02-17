import { NextResponse } from "next/server";
import { DocumentType } from "@prisma/client";
import { DocumentService } from "@/galaxus/documents/DocumentService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  try {
    const { shipmentId } = await params;
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
