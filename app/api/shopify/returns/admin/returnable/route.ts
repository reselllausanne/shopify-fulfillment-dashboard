import { NextResponse } from "next/server";
import {
  ShopifyReturnRequestError,
  getReturnableItemsForOrderAdmin,
} from "@/shopify/returns/createAndOpenReturn";
import { toPublicReturnsErrorMessage } from "@/shopify/returns/publicApiErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin-only: list returnable line items for an order by order number alone.
// No email, no public API key. Used by the staff return-opening form so the
// operator can select which line items to return when an order has multiple
// products. Same-origin only (no CORS header for cross-origin).
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const orderNumber = String(body?.orderNumber ?? "").trim();
    if (!orderNumber) {
      return NextResponse.json(
        { ok: false, success: false, message: "Missing orderNumber" },
        { status: 400 }
      );
    }
    const result = await getReturnableItemsForOrderAdmin({ orderNumber });
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
    console.error("[SHOPIFY][RETURNS][ADMIN][RETURNABLE] Unhandled error", error);
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
