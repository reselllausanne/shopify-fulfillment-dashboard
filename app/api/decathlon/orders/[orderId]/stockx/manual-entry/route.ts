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
      (await (prisma as any).decathlonOrder.findUnique({
        where: { id: orderId },
        include: { lines: true },
      })) ??
      (await (prisma as any).decathlonOrder.findUnique({
        where: { orderId },
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
      decathlonOrderId: order.id,
      decathlonOrderDate: order.orderDate ?? null,
      decathlonOrderLineId: line.id,
      decathlonLineNumber: line.lineNumber ?? null,
      decathlonProductName: line.productTitle ?? "Item",
      decathlonDescription: line.description ?? null,
      decathlonSize: line.size ?? null,
      decathlonGtin: line.gtin ?? null,
      decathlonProviderKey: line.providerKey ?? null,
      decathlonSupplierSku: line.supplierSku ?? null,
      decathlonQuantity: Number(line.quantity ?? 0),
      decathlonUnitNetPrice: line.unitPrice ?? null,
      decathlonLineNetAmount: line.lineTotal ?? null,
      decathlonVatRate: null,
      decathlonCurrencyCode: order.currencyCode ?? "CHF",
      stockxChainId: String(data.stockxChainId ?? "").trim() || null,
      stockxOrderId: String(data.stockxOrderId ?? "").trim() || null,
      stockxOrderNumber:
        String(data.stockxOrderNumber ?? "").trim() || `MANUAL-${order.orderId}-${line.lineNumber ?? 1}`,
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

    const match = await (prisma as any).decathlonStockxMatch.upsert({
      where: { decathlonOrderLineId: line.id },
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
