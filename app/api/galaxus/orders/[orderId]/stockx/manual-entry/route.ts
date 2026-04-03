import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseMaybeDate(value: any): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseMaybeNumber(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(String(value).replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const body = await request.json().catch(() => ({}));
    const lineId = String(body?.lineId ?? "").trim();
    const data = body?.data ?? {};
    if (!lineId) {
      return NextResponse.json({ ok: false, error: "Missing lineId" }, { status: 400 });
    }

    const order =
      (await prisma.galaxusOrder.findUnique({
        where: { id: orderId },
        include: { lines: true },
      })) ??
      (await prisma.galaxusOrder.findUnique({
        where: { galaxusOrderId: orderId },
        include: { lines: true },
      }));
    if (!order) return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });

    const line = (order.lines || []).find((l: any) => l.id === lineId);
    if (!line) {
      return NextResponse.json({ ok: false, error: "Line not found" }, { status: 404 });
    }

    const resolvedCost =
      parseMaybeNumber(data.stockxAmount) ??
      parseMaybeNumber(data.supplierCost) ??
      parseMaybeNumber(data.manualCostOverride);

    const payload = {
      galaxusOrderId: order.id,
      galaxusOrderRef: order.galaxusOrderId ?? null,
      galaxusOrderDate: order.orderDate ?? null,
      galaxusOrderLineId: line.id,
      galaxusLineNumber: line.lineNumber ?? null,
      galaxusProductName: line.productName ?? "Item",
      galaxusDescription: line.description ?? null,
      galaxusSize: line.size ?? null,
      galaxusGtin: line.gtin ?? null,
      galaxusProviderKey: line.providerKey ?? null,
      galaxusSupplierSku: line.supplierSku ?? null,
      galaxusQuantity: Number(line.quantity ?? 0),
      galaxusUnitNetPrice: line.unitNetPrice,
      galaxusLineNetAmount: line.lineNetAmount,
      galaxusVatRate: line.vatRate,
      galaxusCurrencyCode: order.currencyCode ?? "CHF",
      // Keep Galaxus matches minimal: do not persist StockX identifiers here.
      stockxChainId: null,
      stockxOrderId: null,
      stockxOrderNumber: String(data.stockxOrderNumber ?? "").trim() || `MANUAL-${order.galaxusOrderId}-${line.lineNumber}`,
      stockxVariantId: String(data.stockxVariantId ?? "").trim() || null,
      stockxProductName: String(data.stockxProductName ?? "").trim() || null,
      stockxSkuKey: String(data.stockxSkuKey ?? "").trim() || null,
      stockxSizeEU: String(data.stockxSizeEU ?? "").trim() || null,
      stockxPurchaseDate: parseMaybeDate(data.stockxPurchaseDate),
      stockxAmount: resolvedCost,
      stockxCurrencyCode: String(data.shopifyCurrencyCode ?? data.stockxCurrencyCode ?? order.currencyCode ?? "CHF").trim(),
      stockxStatus: String(data.stockxStatus ?? "MANUAL").trim() || "MANUAL",
      stockxEstimatedDelivery: parseMaybeDate(data.stockxEstimatedDelivery),
      stockxLatestEstimatedDelivery: parseMaybeDate(data.stockxLatestEstimatedDelivery),
      stockxAwb: String(data.stockxAwb ?? "").trim() || null,
      stockxTrackingUrl: String(data.stockxTrackingUrl ?? "").trim() || null,
      stockxCheckoutType: String(data.stockxCheckoutType ?? "").trim() || null,
      stockxStates: data.stockxStates ?? null,
      matchConfidence: "high",
      matchScore: 1,
      matchType: "MANUAL",
      matchReasons: JSON.stringify(["MANUAL_ENTRY"]),
      timeDiffHours: null,
      updatedAt: new Date(),
    };

    const match = await (prisma as any).galaxusStockxMatch.upsert({
      where: { galaxusOrderLineId: line.id },
      update: payload,
      create: payload,
    });

    return NextResponse.json({ ok: true, match });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Manual entry failed" },
      { status: 500 }
    );
  }
}
