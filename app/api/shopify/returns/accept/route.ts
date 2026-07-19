import { NextResponse } from "next/server";
import { ShopifyReturnRequestError } from "@/shopify/returns/createAndOpenReturn";
import { acceptRequestedShopifyReturn } from "@/shopify/returns/requestedReturns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const returnId = String(body?.returnId ?? "").trim();
    if (!returnId) {
      return NextResponse.json(
        { ok: false, success: false, message: "Missing returnId" },
        { status: 400 }
      );
    }

    const publicBaseUrl =
      String(process.env.RETURNS_PUBLIC_BASE_URL || "").trim() ||
      String(new URL(request.url).origin || "").trim();

    const result = await acceptRequestedShopifyReturn(returnId, { publicBaseUrl });
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (error) {
    if (error instanceof ShopifyReturnRequestError) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          code: error.code,
          message: error.message,
          details: error.details,
        },
        { status: error.status }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        success: false,
        message: error instanceof Error ? error.message : "Failed to accept return",
      },
      { status: 500 }
    );
  }
}
