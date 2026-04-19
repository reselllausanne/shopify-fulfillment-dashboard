import { NextResponse } from "next/server";
import { readGalaxusStockxToken } from "@/lib/stockxGalaxusAuth";
import { fetchRecentStockxBuyingOrders, fetchStockxBuyOrderDetailsFull } from "@/galaxus/stx/stockxClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATES = ["PENDING", "COMPLETED", "SHIPPED", "MATCHED", "ORDER_CREATED"];

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const orderId = String(searchParams.get("orderId") ?? "").trim();
    if (!orderId) {
      return NextResponse.json({ ok: false, error: "Missing orderId" }, { status: 400 });
    }

    const token = await readGalaxusStockxToken();
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing Galaxus StockX token file" }, { status: 409 });
    }

    let match: any | null = null;
    for (const state of STATES) {
      const orders = await fetchRecentStockxBuyingOrders(token, {
        first: 50,
        maxPages: 8,
        state,
      });
      match = orders.find((node: any) => String(node?.orderId ?? "").trim() === orderId) ?? null;
      if (match) break;
    }

    if (!match) {
      return NextResponse.json({ ok: false, error: "Order not found in recent StockX orders" }, { status: 404 });
    }

    const chainId = String(match?.chainId ?? "").trim();
    if (!chainId) {
      return NextResponse.json({ ok: false, error: "Missing chainId for order" }, { status: 409 });
    }

    const details = await fetchStockxBuyOrderDetailsFull(token, { chainId, orderId });
    return NextResponse.json({
      ok: true,
      orderId,
      chainId,
      details: {
        awb: details.awb ?? null,
        etaMin: details.etaMin ? details.etaMin.toISOString() : null,
        etaMax: details.etaMax ? details.etaMax.toISOString() : null,
        checkoutType: details.order?.checkoutType ?? null,
        trackingUrl: details.order?.shipping?.shipment?.trackingUrl ?? null,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? "Lookup failed" }, { status: 500 });
  }
}

