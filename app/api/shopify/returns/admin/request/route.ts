import { NextResponse } from "next/server";
import {
  ShopifyReturnRequestError,
  createAndOpenReturnFromFormData,
} from "@/shopify/returns/createAndOpenReturn";
import { toPublicReturnsErrorMessage } from "@/shopify/returns/publicApiErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin-only: create + open a Shopify return for selected line items.
// No email, no public API key, no origin check. Same-origin admin form only.
// Accepts `items` array (fulfillmentLineItemId + quantity) to return only the
// selected products when an order has multiple line items.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const reqUrl = new URL(request.url);
    const publicBaseUrl =
      String(process.env.RETURNS_PUBLIC_BASE_URL || "").trim() ||
      `${reqUrl.protocol}//${reqUrl.host}`;

    // Admin can skip details — default to a staff note so validation passes.
    const details = String(body?.details ?? "").trim() || "Return opened by staff.";
    const reason = String(body?.reason ?? "OTHER").trim().toUpperCase() || "OTHER";

    const result = await createAndOpenReturnFromFormData(
      {
        orderNumber: body?.orderNumber,
        reason,
        details,
        items: Array.isArray(body?.items) ? body.items : undefined,
      },
      { publicBaseUrl }
    );

    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (error: any) {
    if (error instanceof ShopifyReturnRequestError) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          code: error.code,
          message: toPublicReturnsErrorMessage(error),
          details: error.details ?? null,
        },
        { status: error.status }
      );
    }
    console.error("[SHOPIFY][RETURNS][ADMIN][REQUEST] Unhandled error", error);
    return NextResponse.json(
      {
        ok: false,
        success: false,
        message: error instanceof Error ? error.message : "Unexpected server error",
      },
      { status: 500 }
    );
  }
}
