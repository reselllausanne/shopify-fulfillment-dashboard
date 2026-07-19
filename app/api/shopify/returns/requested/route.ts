import { NextResponse } from "next/server";
import { ShopifyReturnRequestError } from "@/shopify/returns/createAndOpenReturn";
import {
  listRequestedShopifyReturns,
  syncShopifyReturnsFromAdmin,
} from "@/shopify/returns/requestedReturns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await listRequestedShopifyReturns();
    return NextResponse.json(result, { status: 200 });
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
        message: error instanceof Error ? error.message : "Failed to list requested returns",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action ?? "sync").trim();
    if (action !== "sync") {
      return NextResponse.json(
        { ok: false, success: false, message: `Unsupported action: ${action}` },
        { status: 400 }
      );
    }

    const result = await syncShopifyReturnsFromAdmin();
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
        message: error instanceof Error ? error.message : "Failed to sync Shopify returns",
      },
      { status: 500 }
    );
  }
}
