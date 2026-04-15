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

function docTypeUpper(doc: any): string {
  return String(doc?.type ?? doc?.document_type ?? doc?.document_code ?? "").toUpperCase();
}

function docId(doc: any): string | null {
  const id = doc?.id ?? doc?.document_id;
  if (id === null || id === undefined || id === "") return null;
  const idStr = String(id).trim();
  return idStr || null;
}

/** Lower score = higher priority for packing / delivery documents (OR72). */
function packingSlipTypeRank(doc: any): number {
  const type = docTypeUpper(doc);
  if (type === "SYSTEM_SHIPMENT_DELIVERY_BILL") return 0;
  if (type.includes("SHIPMENT") && type.includes("DELIVERY")) return 1;
  if (type === "PACKING_SLIP" || type.includes("PACKING")) return 2;
  if (type === "SYSTEM_DELIVERY_BILL" || type.includes("DELIVERY_BILL")) return 3;
  if (type.includes("SLIP") || type === "DELIVERY_NOTE") return 4;
  return 50;
}

function isPackingSlipCandidate(doc: any): boolean {
  return packingSlipTypeRank(doc) < 50 && docId(doc) != null;
}

/** True if a key/value pair ties this OR72 row to a Mirakl shipment id (field names vary by front). */
function documentReferencesMiraklShipment(doc: any, miraklShipmentId: string): boolean {
  const needle = String(miraklShipmentId ?? "").trim();
  if (!needle) return false;
  const visit = (node: unknown, keyPath: string): boolean => {
    if (node === null || node === undefined) return false;
    if (typeof node !== "object") {
      if (typeof node === "string" || typeof node === "number") {
        const v = String(node).trim();
        if (v === needle) {
          const low = keyPath.toLowerCase();
          if (low.includes("shipment")) return true;
        }
      }
      return false;
    }
    if (Array.isArray(node)) {
      return node.some((item, i) => visit(item, `${keyPath}[${i}]`));
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const next = keyPath ? `${keyPath}.${k}` : k;
      const low = k.toLowerCase();
      if (low.includes("shipment") && (typeof v === "string" || typeof v === "number")) {
        if (String(v).trim() === needle) return true;
      }
      if (visit(v, next)) return true;
    }
    return false;
  };
  return visit(doc, "");
}

function documentReferencesTracking(doc: any, trackingNumber: string): boolean {
  const t = String(trackingNumber ?? "").trim();
  if (!t) return false;
  const visit = (node: unknown): boolean => {
    if (node === null || node === undefined) return false;
    if (typeof node === "string") return node.trim() === t;
    if (typeof node === "number") return String(node) === t;
    if (typeof node !== "object") return false;
    if (Array.isArray(node)) return node.some(visit);
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const low = k.toLowerCase();
      if ((low.includes("tracking") || low === "identcode" || low === "ident_code") && visit(v)) return true;
      if (visit(v)) return true;
    }
    return false;
  };
  return visit(doc);
}

function pickPackingSlipDocument(
  documents: any[],
  opts?: { miraklShipmentId?: string | null; trackingNumber?: string | null }
): any | null {
  const candidates = documents.filter(isPackingSlipCandidate).sort((a, b) => {
    const ra = packingSlipTypeRank(a);
    const rb = packingSlipTypeRank(b);
    if (ra !== rb) return ra - rb;
    const da = String(a?.date_uploaded ?? a?.uploaded_date ?? "").localeCompare(
      String(b?.date_uploaded ?? b?.uploaded_date ?? "")
    );
    return -da;
  });
  if (!candidates.length) return null;

  const mid = String(opts?.miraklShipmentId ?? "").trim();
  const trk = String(opts?.trackingNumber ?? "").trim();

  if (mid) {
    const byShipment = candidates.filter((d) => documentReferencesMiraklShipment(d, mid));
    if (byShipment.length === 1) return byShipment[0];
    if (byShipment.length > 1 && trk) {
      const byBoth = byShipment.filter((d) => documentReferencesTracking(d, trk));
      if (byBoth.length) return byBoth[0];
    }
    if (byShipment.length) return byShipment[0];
  }

  if (trk) {
    const byTrack = candidates.filter((d) => documentReferencesTracking(d, trk));
    if (byTrack.length === 1) return byTrack[0];
    if (byTrack.length > 1 && mid) {
      const byBoth = byTrack.filter((d) => documentReferencesMiraklShipment(d, mid));
      if (byBoth.length) return byBoth[0];
    }
    if (byTrack.length) return byTrack[0];
  }

  if (mid || trk) return null;
  return candidates[0] ?? null;
}

async function resolveMiraklTrackingForShipment(
  miraklOrderId: string,
  miraklShipmentId: string
): Promise<string | null> {
  try {
    const client = buildDecathlonOrdersClient();
    const res = await client.listShipments(miraklOrderId);
    const row = (res?.data ?? []).find((s) => String(s?.id ?? "").trim() === miraklShipmentId);
    const tn = String(row?.tracking?.tracking_number ?? "").trim();
    return tn || null;
  } catch {
    return null;
  }
}

async function resolveDecathlonOrder(orderId: string) {
  return (
    (await prisma.decathlonOrder.findUnique({
      where: { id: orderId },
      include: { shipments: { orderBy: { shippedAt: "asc" } } },
    })) ??
    (await prisma.decathlonOrder.findUnique({
      where: { orderId },
      include: { shipments: { orderBy: { shippedAt: "asc" } } },
    }))
  );
}

type FetchPackingOpts = {
  miraklShipmentId?: string | null;
  trackingNumber?: string | null;
};

async function fetchPackingSlipPdfFromMirakl(
  order: { id: string; orderId: string },
  opts?: FetchPackingOpts
) {
  const client = buildDecathlonOrdersClient();
  let trackingHint = String(opts?.trackingNumber ?? "").trim() || null;
  const miraklShipmentId = String(opts?.miraklShipmentId ?? "").trim() || null;

  if (miraklShipmentId && !trackingHint) {
    trackingHint = await resolveMiraklTrackingForShipment(order.orderId, miraklShipmentId);
  }

  const docsPayload: any = await client.listDocuments({ order_ids: order.orderId });
  const documents = normalizeOrderDocuments(docsPayload);
  const picked = pickPackingSlipDocument(documents, {
    miraklShipmentId,
    trackingNumber: trackingHint,
  });
  const documentId = picked ? docId(picked) : null;

  if (!documentId) {
    const types = documents.map((d: any) => docTypeUpper(d)).filter(Boolean);
    return {
      ok: false as const,
      status: 404,
      body: {
        ok: false,
        error: miraklShipmentId
          ? "No packing slip / delivery bill matched this Mirakl shipment (OR72). Try again after Mirakl generates the document, or check document types."
          : "No packing slip document on this order (OR72)",
        hint: "Mirakl returns documents under `order_documents`. Check types on the marketplace.",
        documentTypes: types,
        miraklShipmentId: miraklShipmentId || undefined,
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
  buffer: Buffer,
  dbShipmentId?: string | null
) {
  const storage = getStorageAdapter();
  const key = `decathlon/${order.orderId}/packing-slip/${documentId}.pdf`;
  const stored = await storage.uploadPdf(key, buffer);
  const existingDocs = await prisma.decathlonOrderDocument.findMany({
    where: { orderId: order.id, type: DocumentType.DELIVERY_NOTE },
    orderBy: { version: "desc" },
    take: 1,
  });
  const nextVersion = existingDocs[0]?.version ? existingDocs[0].version + 1 : 1;
  const doc = await prisma.decathlonOrderDocument.create({
    data: {
      orderId: order.id,
      shipmentId: dbShipmentId?.trim() || null,
      type: DocumentType.DELIVERY_NOTE,
      version: nextVersion,
      storageUrl: stored.storageUrl,
      checksum: null,
      miraklDocumentId: documentId,
    },
  });
  return { stored, doc };
}

function attachmentFilename(miraklOrderId: string, dbShipmentId?: string | null): string {
  const safe = String(miraklOrderId ?? "order").replace(/[^a-zA-Z0-9._-]+/g, "_");
  const suf = dbShipmentId ? `_shipment_${String(dbShipmentId).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 24)}` : "";
  return `decathlon-delivery_${safe}${suf}.pdf`;
}

type PackingSlipScopeResult =
  | { ok: true; dbShipmentId: string | null; miraklShipmentId: string | null; trackingNumber: string | null }
  | { ok: false; status: number; body: Record<string, unknown> };

async function resolvePackingSlipScope(
  order: { id: string; orderId: string; shipments: any[] },
  searchParams: URLSearchParams
): Promise<PackingSlipScopeResult> {
  const shipmentIdParam = String(searchParams.get("shipmentId") ?? "").trim();
  const rows = Array.isArray(order.shipments) ? order.shipments : [];
  const withMirakl = rows.filter((s: any) => String(s?.miraklShipmentId ?? "").trim());

  let dbShipmentId: string | null = null;
  let miraklShipmentId: string | null = null;
  let trackingNumber: string | null = null;

  if (shipmentIdParam) {
    const row = rows.find((s: any) => String(s?.id ?? "") === shipmentIdParam);
    if (!row) {
      return {
        ok: false,
        status: 404,
        body: { ok: false, error: "Shipment not found for this order" },
      };
    }
    dbShipmentId = String(row.id);
    miraklShipmentId = String(row.miraklShipmentId ?? "").trim() || null;
    trackingNumber = String(row.trackingNumber ?? "").trim() || null;
    if (!miraklShipmentId) {
      return {
        ok: false,
        status: 400,
        body: {
          ok: false,
          error:
            "This shipment has no Mirakl shipment id (created before tracking was added). Use the generic packing slip or re-ship from an updated build.",
        },
      };
    }
  } else if (withMirakl.length === 1) {
    const row = withMirakl[0];
    dbShipmentId = String(row.id);
    miraklShipmentId = String(row.miraklShipmentId ?? "").trim() || null;
    trackingNumber = String(row.trackingNumber ?? "").trim() || null;
  } else if (withMirakl.length > 1) {
    return {
      ok: false,
      status: 400,
      body: {
        ok: false,
        error:
          "This order has multiple Mirakl shipments. Pass ?shipmentId=<DecathlonShipment.id> to download the packing slip for a specific parcel.",
        shipments: withMirakl.map((s: any) => ({
          id: s.id,
          miraklShipmentId: s.miraklShipmentId ?? null,
          trackingNumber: s.trackingNumber ?? null,
          shippedAt: s.shippedAt ?? null,
        })),
      },
    };
  }

  return { ok: true, dbShipmentId, miraklShipmentId, trackingNumber };
}

async function handlePackingSlipRequest(
  request: NextRequest,
  params: Promise<{ orderId: string }>,
  mode: "pdf" | "json"
) {
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

  const scopeRes = await resolvePackingSlipScope(order as any, searchParams);
  if (!scopeRes.ok) {
    return NextResponse.json(scopeRes.body, { status: scopeRes.status });
  }

  const fetched = await fetchPackingSlipPdfFromMirakl(order, {
    miraklShipmentId: scopeRes.miraklShipmentId,
    trackingNumber: scopeRes.trackingNumber,
  });
  if (!fetched.ok) {
    return NextResponse.json(fetched.body, { status: fetched.status });
  }

  const { stored, doc } = await persistPackingSlipToStorage(
    order,
    fetched.documentId,
    fetched.buffer,
    scopeRes.dbShipmentId
  );

  if (mode === "json") {
    return NextResponse.json({
      ok: true,
      documentId: fetched.documentId,
      docId: doc.id,
      url: stored.storageUrl,
      shipmentId: scopeRes.dbShipmentId,
    });
  }

  const filename = attachmentFilename(order.orderId, scopeRes.dbShipmentId);
  const bytes = new Uint8Array(fetched.buffer);
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": fetched.contentType?.includes("pdf") ? fetched.contentType! : "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Browser download: PDF body + Content-Disposition attachment. Still uploads to S3 and records DB. */
export async function GET(request: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  try {
    return await handlePackingSlipRequest(request, ctx.params, "pdf");
  } catch (error: any) {
    console.error("[DECATHLON][PACKING-SLIP][GET] Failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Packing slip failed" },
      { status: 500 }
    );
  }
}

/** JSON metadata (e.g. S3 URL) for tools that do not need a raw download. */
export async function POST(request: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  try {
    return await handlePackingSlipRequest(request, ctx.params, "json");
  } catch (error: any) {
    console.error("[DECATHLON][PACKING-SLIP][POST] Failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Packing slip failed" },
      { status: 500 }
    );
  }
}
