// app/api/shopify/set-metafields/route.ts
import { NextResponse } from "next/server";
import { setSupplierOrderMetafields } from "@/shopify/orders/setSupplierMetafields";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const result = await setSupplierOrderMetafields({
      shopifyOrderId: String(body?.shopifyOrderId ?? "").trim(),
      stockxOrderNumber: String(body?.stockxOrderNumber ?? "").trim(),
      estimatedDelivery: body?.estimatedDelivery ?? null,
      stockxStatus: body?.stockxStatus ?? "UNKNOWN",
      supplierCost: body?.supplierCost ?? null,
      marginAmount: body?.marginAmount ?? null,
      marginPercent: body?.marginPercent ?? null,
      trackingNumber: body?.trackingNumber ?? null,
      trackingUrl: body?.trackingUrl ?? null,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || "Failed to set metafields" },
        { status: result.statusCode || 500 }
      );
    }

    return NextResponse.json({ ok: true, metafieldCount: result.metafieldCount });
  } catch (err: any) {
    console.error("[/api/shopify/set-metafields] error:", err);
    return NextResponse.json(
      { error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
