import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getStorageAdapter } from "@/galaxus/storage/storage";
import { DocumentType } from "@prisma/client";
import { buildDecathlonOrdersClient } from "@/decathlon/mirakl/ordersClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pickPackingSlipId(documents: any[]): string | null {
  for (const doc of documents) {
    const type = String(doc?.type ?? doc?.document_type ?? "").toUpperCase();
    if (type === "PACKING_SLIP") {
      return String(doc?.id ?? doc?.document_id ?? "").trim() || null;
    }
  }
  return null;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const order =
      (await (prisma as any).decathlonOrder.findUnique({ where: { id: orderId } })) ??
      (await (prisma as any).decathlonOrder.findUnique({ where: { orderId } }));
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }
    const client = buildDecathlonOrdersClient();
    const docsPayload: any = await client.listDocuments({ order_ids: order.orderId });
    const documents: any[] = docsPayload?.documents ?? docsPayload?.data ?? [];
    const documentId = pickPackingSlipId(documents);
    if (!documentId) {
      return NextResponse.json({ ok: false, error: "PACKING_SLIP not found" }, { status: 404 });
    }
    const pdf = await client.downloadDocuments({ document_ids: documentId });
    const storage = getStorageAdapter();
    const key = `decathlon/${order.orderId}/packing-slip/${documentId}.pdf`;
    const stored = await storage.uploadPdf(key, pdf.buffer);
    const existingDocs = await (prisma as any).decathlonOrderDocument.findMany({
      where: { orderId: order.id, type: DocumentType.DELIVERY_NOTE },
      orderBy: { version: "desc" },
      take: 1,
    });
    const nextVersion = existingDocs[0]?.version ? existingDocs[0].version + 1 : 1;
    const doc = await (prisma as any).decathlonOrderDocument.create({
      data: {
        orderId: order.id,
        type: DocumentType.DELIVERY_NOTE,
        version: nextVersion,
        storageUrl: stored.storageUrl,
        checksum: null,
        miraklDocumentId: documentId,
      },
    });
    return NextResponse.json({ ok: true, documentId, docId: doc.id, url: stored.storageUrl });
  } catch (error: any) {
    console.error("[DECATHLON][PACKING-SLIP] Failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Packing slip failed" },
      { status: 500 }
    );
  }
}
