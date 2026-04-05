import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { getStorageAdapter } from "@/galaxus/storage/storage";
import { DocumentType } from "@prisma/client";
import { buildDecathlonOrdersClient } from "@/decathlon/mirakl/ordersClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeOrderDocuments(payload: any): any[] {
  const raw =
    payload?.order_documents ??
    payload?.documents ??
    payload?.data ??
    (Array.isArray(payload) ? payload : null);
  return Array.isArray(raw) ? raw : [];
}

/** OR72 `type` is a document type code; marketplaces vary (Decathlon uses SYSTEM_DELIVERY_BILL). */
function pickPackingSlipId(documents: any[]): string | null {
  const preferred: string[] = [];
  const decathlonBill: string[] = [];
  const fallback: string[] = [];
  for (const doc of documents) {
    const type = String(doc?.type ?? doc?.document_type ?? doc?.document_code ?? "").toUpperCase();
    const id = doc?.id ?? doc?.document_id;
    if (id === null || id === undefined || id === "") continue;
    const idStr = String(id).trim();
    if (!idStr) continue;
    if (type === "PACKING_SLIP" || type.includes("PACKING")) {
      preferred.push(idStr);
    } else if (type === "SYSTEM_DELIVERY_BILL" || type.includes("DELIVERY_BILL")) {
      decathlonBill.push(idStr);
    } else if (type.includes("SLIP") || type === "DELIVERY_NOTE") {
      fallback.push(idStr);
    }
  }
  return preferred[0] ?? decathlonBill[0] ?? fallback[0] ?? null;
}

async function resolveDecathlonOrder(orderId: string) {
  return (
    (await (prisma as any).decathlonOrder.findUnique({ where: { id: orderId } })) ??
    (await (prisma as any).decathlonOrder.findUnique({ where: { orderId } }))
  );
}

async function fetchPackingSlipPdfFromMirakl(order: { id: string; orderId: string }) {
  const client = buildDecathlonOrdersClient();
  const docsPayload: any = await client.listDocuments({ order_ids: order.orderId });
  const documents = normalizeOrderDocuments(docsPayload);
  const documentId = pickPackingSlipId(documents);
  if (!documentId) {
    const types = documents.map((d: any) => String(d?.type ?? d?.document_type ?? "?")).filter(Boolean);
    return {
      ok: false as const,
      status: 404,
      body: {
        ok: false,
        error: "No packing slip document on this order (OR72)",
        hint: "Mirakl returns documents under `order_documents`. Check types on the marketplace.",
        documentTypes: types,
      },
    };
  }
  const pdf = await client.downloadDocuments({ document_ids: documentId });
  return {
    ok: true as const,
    documentId,
    buffer: pdf.buffer,
    contentType: pdf.contentType,
  };
}

async function persistPackingSlipToStorage(
  order: { id: string; orderId: string },
  documentId: string,
  buffer: Buffer
) {
  const storage = getStorageAdapter();
  const key = `decathlon/${order.orderId}/packing-slip/${documentId}.pdf`;
  const stored = await storage.uploadPdf(key, buffer);
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
  return { stored, doc };
}

function attachmentFilename(miraklOrderId: string): string {
  const safe = String(miraklOrderId ?? "order").replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `decathlon-delivery_${safe}.pdf`;
}

/** Browser download: PDF body + Content-Disposition attachment. Still uploads to S3 and records DB. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const order = await resolveDecathlonOrder(orderId);
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }
    const { searchParams } = new URL(request.url);
    const scope = String(searchParams.get("scope") ?? "").trim().toLowerCase();
    const partnerSession = scope === "partner" ? await getPartnerSession(request) : null;
    const partnerKey = normalizeProviderKey(partnerSession?.partnerKey ?? null);
    if (scope === "partner" && !partnerSession) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (scope === "partner" && !partnerKey) {
      return NextResponse.json({ ok: false, error: "Partner key missing" }, { status: 400 });
    }
    if (scope === "partner" && partnerKey && order.partnerKey !== partnerKey) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }
    const fetched = await fetchPackingSlipPdfFromMirakl(order);
    if (!fetched.ok) {
      return NextResponse.json(fetched.body, { status: fetched.status });
    }
    await persistPackingSlipToStorage(order, fetched.documentId, fetched.buffer);
    const filename = attachmentFilename(order.orderId);
    const bytes = new Uint8Array(fetched.buffer);
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": fetched.contentType?.includes("pdf") ? fetched.contentType : "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    console.error("[DECATHLON][PACKING-SLIP][GET] Failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Packing slip failed" },
      { status: 500 }
    );
  }
}

/** JSON metadata (e.g. S3 URL) for tools that do not need a raw download. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const order = await resolveDecathlonOrder(orderId);
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }
    const { searchParams } = new URL(request.url);
    const scope = String(searchParams.get("scope") ?? "").trim().toLowerCase();
    const partnerSession = scope === "partner" ? await getPartnerSession(request) : null;
    const partnerKey = normalizeProviderKey(partnerSession?.partnerKey ?? null);
    if (scope === "partner" && !partnerSession) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (scope === "partner" && !partnerKey) {
      return NextResponse.json({ ok: false, error: "Partner key missing" }, { status: 400 });
    }
    if (scope === "partner" && partnerKey && order.partnerKey !== partnerKey) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }
    const fetched = await fetchPackingSlipPdfFromMirakl(order);
    if (!fetched.ok) {
      return NextResponse.json(fetched.body, { status: fetched.status });
    }
    const { stored, doc } = await persistPackingSlipToStorage(order, fetched.documentId, fetched.buffer);
    return NextResponse.json({
      ok: true,
      documentId: fetched.documentId,
      docId: doc.id,
      url: stored.storageUrl,
    });
  } catch (error: any) {
    console.error("[DECATHLON][PACKING-SLIP][POST] Failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Packing slip failed" },
      { status: 500 }
    );
  }
}
