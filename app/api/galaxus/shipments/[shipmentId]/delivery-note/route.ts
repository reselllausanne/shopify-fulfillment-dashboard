import { NextResponse } from "next/server";
import { DocumentType } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { DocumentService } from "@/galaxus/documents/DocumentService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  try {
    const { shipmentId } = await params;
    const { searchParams } = new URL(request.url);
    const force = ["1", "true", "yes"].includes((searchParams.get("force") ?? "").toLowerCase());

    if (!force) {
      const existing = await prisma.document.findFirst({
        where: { shipmentId, type: DocumentType.DELIVERY_NOTE },
        orderBy: { version: "desc" },
      });
      if (existing) {
        return NextResponse.json({
          ok: true,
          documentId: existing.id,
          url: `/api/galaxus/documents/${existing.id}`,
        });
      }
    }

    const service = new DocumentService();
    const documents = await service.generateForShipment({
      shipmentId,
      types: [DocumentType.DELIVERY_NOTE],
    });
    const created = documents.find((doc) => doc.type === DocumentType.DELIVERY_NOTE) ?? documents[0];
    if (!created) {
      return NextResponse.json({ ok: false, error: "Delivery note not generated" }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      documentId: created.id,
      url: `/api/galaxus/documents/${created.id}`,
    });
  } catch (error: any) {
    console.error("[GALAXUS][SHIPMENT][DELIVERY_NOTE] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed" }, { status: 500 });
  }
}
