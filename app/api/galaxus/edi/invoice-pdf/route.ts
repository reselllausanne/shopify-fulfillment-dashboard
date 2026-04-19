import { NextResponse } from "next/server";
import { DocumentService } from "@/galaxus/documents/DocumentService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Human-readable invoice PDF (same lines + delivery charge as INVO XML). Galaxus still needs the XML. */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const orderId = (searchParams.get("orderId") ?? "").trim();
    if (!orderId) {
      return NextResponse.json({ ok: false, error: "orderId is required" }, { status: 400 });
    }
    const rawLineIds = (searchParams.get("lineIds") ?? "").trim();
    const lineIds = rawLineIds
      ? rawLineIds
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const dcRaw = (searchParams.get("deliveryCharge") ?? "").trim();
    const deliveryCharge =
      dcRaw && Number.isFinite(Number(dcRaw)) ? Number(dcRaw) : undefined;

    const service = new DocumentService();
    const pdf = await service.generateInvoicePdfForSelectedLines({
      orderId,
      lineIds,
      deliveryCharge,
    });

    const safeName = orderId.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 48);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="invoice-${safeName}.pdf"`,
      },
    });
  } catch (error: unknown) {
    console.error("[GALAXUS][EDI][INVOICE-PDF][GET] Failed:", error);
    const message = error instanceof Error ? error.message : "PDF generation failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode = String(body?.mode ?? "").toLowerCase();
    if (mode !== "custom") {
      return NextResponse.json({ ok: false, error: 'Set mode: "custom"' }, { status: 400 });
    }
    const baseOrderId = String(body?.baseOrderId ?? "").trim();
    const lines = Array.isArray(body?.lines) ? body.lines : [];
    const deliveryChargeRaw = body?.deliveryCharge;
    const deliveryCharge =
      deliveryChargeRaw != null && Number.isFinite(Number(deliveryChargeRaw))
        ? Number(deliveryChargeRaw)
        : undefined;
    if (!baseOrderId) {
      return NextResponse.json({ ok: false, error: "baseOrderId is required" }, { status: 400 });
    }

    const service = new DocumentService();
    const pdf = await service.generateInvoicePdfFromCustomLines({
      baseOrderId,
      lines,
      deliveryCharge,
    });

    const safeName = baseOrderId.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 48);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="invoice-custom-${safeName}.pdf"`,
      },
    });
  } catch (error: unknown) {
    console.error("[GALAXUS][EDI][INVOICE-PDF][POST] Failed:", error);
    const message = error instanceof Error ? error.message : "PDF generation failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
