import { NextResponse } from "next/server";
import { runShopifyOrdersSync } from "@/shopify/orders/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const startDate = body?.startDate ? new Date(body.startDate) : undefined;
    const pageSize = Number(body?.pageSize ?? body?.first ?? 60);
    const result = await runShopifyOrdersSync({
      startDate,
      pageSize,
    });
    return NextResponse.json(
      {
        success: true,
        ...result,
        message: `Synced ${result.synced} Shopify orders from ${result.startDateIso} (${result.skipped} skipped)`,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[SHOPIFY-SYNC] Error:", error);
    return NextResponse.json(
      { error: "Failed to sync Shopify orders", details: error?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
