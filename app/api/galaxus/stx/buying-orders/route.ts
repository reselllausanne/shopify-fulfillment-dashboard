import { NextResponse } from "next/server";
import { fetchRecentStockxBuyingOrders } from "@/galaxus/stx/stockxClient";
import { readGalaxusStockxToken } from "@/lib/stockxGalaxusAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const token = await readGalaxusStockxToken();
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing Galaxus StockX token file" }, { status: 409 });
    }

    const { searchParams } = new URL(request.url);
    const first = Math.max(1, Math.min(Number(searchParams.get("first") ?? "50"), 100));
    const maxPages = Math.max(1, Math.min(Number(searchParams.get("pages") ?? "8"), 20));
    const state = (searchParams.get("state") ?? "PENDING").trim();
    const query = searchParams.get("query")?.trim() || null;

    const orders = await fetchRecentStockxBuyingOrders(token, {
      first,
      maxPages,
      state: state || "PENDING",
      query,
    });

    // Print all orders to server logs (this is what you asked for).
    console.info("[GALAXUS][STX][BUYING_ORDERS] fetched", { state: state || "PENDING", count: orders.length });
    for (const node of orders as any[]) {
      console.info("[GALAXUS][STX][BUYING_ORDERS][ORDER]", {
        chainId: node?.chainId ?? null,
        orderId: node?.orderId ?? null,
        orderNumber: node?.orderNumber ?? null,
        purchaseDate: node?.purchaseDate ?? null,
        creationDate: node?.creationDate ?? null,
        statusKey: node?.state?.statusKey ?? null,
        statusTitle: node?.state?.statusTitle ?? null,
        amount: node?.amount ?? null,
        currencyCode: node?.currencyCode ?? null,
        localizedSizeTitle: node?.localizedSizeTitle ?? null,
        localizedSizeType: node?.localizedSizeType ?? null,
        productVariantId: node?.productVariant?.id ?? null,
        traitSize: node?.productVariant?.traits?.size ?? null,
        baseType: node?.productVariant?.sizeChart?.baseType ?? null,
        baseSize: node?.productVariant?.sizeChart?.baseSize ?? null,
        productTitle: node?.productVariant?.product?.title ?? node?.productVariant?.product?.name ?? null,
        styleId: node?.productVariant?.product?.styleId ?? null,
      });
    }

    // Also return them in JSON so you can see them in browser/response.
    return NextResponse.json({
      ok: true,
      state: state || "PENDING",
      count: orders.length,
      orders,
    });
  } catch (error: any) {
    console.error("[GALAXUS][STX][BUYING_ORDERS] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed to fetch StockX orders" }, { status: 500 });
  }
}

