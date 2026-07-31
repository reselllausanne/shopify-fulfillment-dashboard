import { NextResponse } from "next/server";
import {
  applyStockxDetailsToDecathlonMatchFields,
  looksLikeStockxOrderNumber,
  resolveStockxBuyForManualDecathlon,
} from "@/decathlon/stx/manualStockxEnrich";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toIso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    await params;
    const { searchParams } = new URL(request.url);
    const orderNumber = String(searchParams.get("orderNumber") ?? "").trim();
    if (!orderNumber) {
      return NextResponse.json({ ok: false, error: "Missing orderNumber" }, { status: 400 });
    }
    if (!looksLikeStockxOrderNumber(orderNumber)) {
      return NextResponse.json({ ok: false, error: "Not a StockX order number format" }, { status: 400 });
    }

    const resolved = await resolveStockxBuyForManualDecathlon(orderNumber);
    if (!resolved.ok) {
      return NextResponse.json({ ok: false, error: resolved.reason }, { status: 404 });
    }

    const fields = applyStockxDetailsToDecathlonMatchFields(resolved.listNode, resolved.details, {
      matchReasons: ["MANUAL_STOCKX_ORDER_LOOKUP_GALAXUS"],
    });

    return NextResponse.json({
      ok: true,
      fields: {
        stockxOrderNumber: fields.stockxOrderNumber,
        stockxOrderId: fields.stockxOrderId,
        stockxChainId: fields.stockxChainId,
        stockxVariantId: fields.stockxVariantId,
        stockxProductName: fields.stockxProductName,
        stockxSkuKey: fields.stockxSkuKey,
        stockxSizeEU: fields.stockxSizeEU,
        stockxPurchaseDate: toIso(fields.stockxPurchaseDate),
        stockxAmount: fields.stockxAmount,
        stockxCurrencyCode: fields.stockxCurrencyCode,
        stockxStatus: fields.stockxStatus,
        stockxEstimatedDelivery: toIso(fields.stockxEstimatedDelivery),
        stockxLatestEstimatedDelivery: toIso(fields.stockxLatestEstimatedDelivery),
        stockxAwb: fields.stockxAwb,
        stockxTrackingUrl: fields.stockxTrackingUrl,
        stockxCheckoutType: fields.stockxCheckoutType,
        stockxStates: fields.stockxStates,
        supplierCost: fields.stockxAmount,
        matchType: fields.matchType,
        matchConfidence: fields.matchConfidence,
        matchScore: fields.matchScore,
        matchReasons: fields.matchReasons,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Lookup failed" },
      { status: 500 }
    );
  }
}
