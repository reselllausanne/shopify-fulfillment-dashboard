import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import {
  getStxLinkStatusForOrder,
  cancelStxPurchaseUnit,
  linkOldestPendingStxUnit,
  resolveGalaxusOrderByIdOrRef,
} from "@/galaxus/stx/purchaseUnits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractAwbFromTrackingInput(raw: string): string | null {
  const input = String(raw ?? "").trim();
  if (!input) return null;
  // If the user pasted a URL, keep only the last path token if it looks like a tracking number.
  const urlLike = input.startsWith("http://") || input.startsWith("https://");
  if (urlLike) {
    try {
      const url = new URL(input);
      const last = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
      const candidate = last.trim();
      if (candidate && /^[A-Za-z0-9-]{8,}$/.test(candidate)) return candidate;
    } catch {
      // fall through
    }
  }
  const compact = input.replace(/\s+/g, " ").trim();
  // Common: "DPD\n123456789" or "Tracking: 123456789"
  const m = compact.match(/([0-9]{8,})/);
  if (m?.[1]) return m[1];
  if (/^[A-Za-z0-9-]{8,}$/.test(compact)) return compact;
  return null;
}

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await params;
    const body = await request.json().catch(() => ({}));

    const supplierVariantId = String(body?.supplierVariantId ?? "").trim();
    const stockxOrderId = String(body?.stockxOrderId ?? "").trim();
    const etaMinRaw = body?.etaMin ?? null;
    const etaMaxRaw = body?.etaMax ?? null;
    const trackingRaw = String(body?.trackingRaw ?? "").trim();
    const note = String(body?.note ?? "").trim();
    const action = String(body?.action ?? "").trim().toLowerCase();
    const cancelReason = String(body?.cancelReason ?? "").trim();

    if (action === "cancel") {
      if (!stockxOrderId) {
        return NextResponse.json({ ok: false, error: "Missing stockxOrderId" }, { status: 400 });
      }
      const order = await resolveGalaxusOrderByIdOrRef(orderId);
      if (!order) return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
      const cancel = await cancelStxPurchaseUnit({
        galaxusOrderId: order.galaxusOrderId,
        stockxOrderId,
        reason: cancelReason || null,
      });
      if (!cancel.ok) {
        return NextResponse.json({ ok: false, error: `Cancel failed: ${cancel.status}` }, { status: 409 });
      }
      const status = await getStxLinkStatusForOrder(order.galaxusOrderId);
      return NextResponse.json({ ok: true, status, cancel });
    }

    if (!supplierVariantId) return NextResponse.json({ ok: false, error: "Missing supplierVariantId" }, { status: 400 });
    if (!stockxOrderId) return NextResponse.json({ ok: false, error: "Missing stockxOrderId" }, { status: 400 });

    const order = await resolveGalaxusOrderByIdOrRef(orderId);
    if (!order) return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });

    const etaMin = etaMinRaw ? new Date(String(etaMinRaw)) : null;
    const etaMax = etaMaxRaw ? new Date(String(etaMaxRaw)) : null;
    const awb = extractAwbFromTrackingInput(trackingRaw) ?? null;

    const linkResult = await linkOldestPendingStxUnit({
      galaxusOrderId: order.galaxusOrderId,
      supplierVariantId,
      stockxOrderId,
      awb,
      etaMin,
      etaMax,
      checkoutType: "MANUAL_OVERRIDE",
    });
    if (linkResult.status === "missing_eta") {
      return NextResponse.json(
        { ok: false, error: "ETA min/max required to link a StockX unit" },
        { status: 400 }
      );
    }

    // Persist manual context even if the unit already existed/linked.
    const manualUpdate: Record<string, unknown> = {
      manualSetAt: new Date(),
    };
    if (trackingRaw) manualUpdate.manualTrackingRaw = trackingRaw;
    if (note) manualUpdate.manualNote = note;

    if (linkResult.status === "linked" && linkResult.unitId) {
      await (prisma as any).stxPurchaseUnit.update({
        where: { id: linkResult.unitId },
        data: manualUpdate,
      });
    } else if (linkResult.status === "already_linked") {
      const existing = await (prisma as any).stxPurchaseUnit.findUnique({
        where: { stockxOrderId },
        select: { id: true },
      });
      if (existing?.id) {
        await (prisma as any).stxPurchaseUnit.update({
          where: { id: existing.id },
          data: manualUpdate,
        });
      }
    }

    const status = await getStxLinkStatusForOrder(order.galaxusOrderId);
    return NextResponse.json({ ok: true, result: linkResult, status });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? "Manual StockX link failed" }, { status: 500 });
  }
}

