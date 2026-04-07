import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import {
  applyStockxDetailsToDecathlonMatchFields,
  resolveStockxBuyForManualDecathlon,
} from "@/decathlon/stx/manualStockxEnrich";

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

function trimStr(v: unknown): string {
  return String(v ?? "").trim();
}

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await params;
    const body = await request.json().catch(() => ({}));
    const lineId = String(body?.lineId ?? "").trim();
    const data = body?.data ?? {};
    const enrichFromStockx = body?.enrichFromStockx !== false;
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

    const prismaAny = prisma as any;
    const existing = await prismaAny.galaxusStockxMatch.findUnique({
      where: { galaxusOrderLineId: line.id },
    });

    const orderNumberInput = trimStr(data.stockxOrderNumber);
    let auto: ReturnType<typeof applyStockxDetailsToDecathlonMatchFields> | null = null;
    let stockxEnrich: { attempted: boolean; ok: boolean; reason?: string } = {
      attempted: false,
      ok: false,
    };

    if (enrichFromStockx && orderNumberInput) {
      stockxEnrich.attempted = true;
      const resolved = await resolveStockxBuyForManualDecathlon(orderNumberInput);
      if (resolved.ok) {
        auto = applyStockxDetailsToDecathlonMatchFields(resolved.listNode, resolved.details, {
          matchReasons: ["MANUAL_STOCKX_ORDER_LOOKUP_GALAXUS"],
        });
        stockxEnrich = { attempted: true, ok: true };
      } else {
        stockxEnrich = { attempted: true, ok: false, reason: resolved.reason };
      }
    }

    const a = auto ?? ({} as ReturnType<typeof applyStockxDetailsToDecathlonMatchFields>);

    const manualCost =
      parseMaybeNumber(data.stockxAmount) ??
      parseMaybeNumber(data.supplierCost) ??
      parseMaybeNumber(data.manualCostOverride);
    const autoAmount = a.stockxAmount != null ? Number(a.stockxAmount) : null;
    const existingAmount = existing?.stockxAmount != null ? Number(existing.stockxAmount) : null;
    const resolvedCost =
      manualCost !== null
        ? manualCost
        : autoAmount != null && Number.isFinite(autoAmount)
          ? autoAmount
          : existingAmount != null && Number.isFinite(existingAmount)
            ? existingAmount
            : null;

    const stockxOrderNumberFinal =
      trimStr(data.stockxOrderNumber) ||
      trimStr(a.stockxOrderNumber) ||
      trimStr(existing?.stockxOrderNumber) ||
      `MANUAL-${order.galaxusOrderId}-${line.lineNumber ?? 1}`;

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
      stockxChainId: trimStr(data.stockxChainId) || trimStr(a.stockxChainId) || trimStr(existing?.stockxChainId) || null,
      stockxOrderId: trimStr(data.stockxOrderId) || trimStr(a.stockxOrderId) || trimStr(existing?.stockxOrderId) || null,
      stockxOrderNumber: stockxOrderNumberFinal,
      stockxVariantId: trimStr(data.stockxVariantId) || trimStr(a.stockxVariantId) || trimStr(existing?.stockxVariantId) || null,
      stockxProductName:
        trimStr(data.stockxProductName) || trimStr(a.stockxProductName) || trimStr(existing?.stockxProductName) || null,
      stockxSkuKey: trimStr(data.stockxSkuKey) || trimStr(a.stockxSkuKey) || trimStr(existing?.stockxSkuKey) || null,
      stockxSizeEU: trimStr(data.stockxSizeEU) || trimStr(a.stockxSizeEU) || trimStr(existing?.stockxSizeEU) || null,
      stockxPurchaseDate:
        parseMaybeDate(data.stockxPurchaseDate) ?? a.stockxPurchaseDate ?? existing?.stockxPurchaseDate ?? null,
      stockxAmount: resolvedCost,
      stockxCurrencyCode:
        trimStr(data.shopifyCurrencyCode ?? data.stockxCurrencyCode) ||
        trimStr(a.stockxCurrencyCode) ||
        trimStr(existing?.stockxCurrencyCode) ||
        String(order.currencyCode ?? "CHF").trim(),
      stockxStatus: trimStr(data.stockxStatus) || trimStr(a.stockxStatus) || trimStr(existing?.stockxStatus) || "MANUAL",
      stockxEstimatedDelivery:
        parseMaybeDate(data.stockxEstimatedDelivery) ??
        a.stockxEstimatedDelivery ??
        existing?.stockxEstimatedDelivery ??
        null,
      stockxLatestEstimatedDelivery:
        parseMaybeDate(data.stockxLatestEstimatedDelivery) ??
        a.stockxLatestEstimatedDelivery ??
        existing?.stockxLatestEstimatedDelivery ??
        null,
      stockxAwb: trimStr(data.stockxAwb) || trimStr(a.stockxAwb) || trimStr(existing?.stockxAwb) || null,
      stockxTrackingUrl:
        trimStr(data.stockxTrackingUrl) || trimStr(a.stockxTrackingUrl) || trimStr(existing?.stockxTrackingUrl) || null,
      stockxCheckoutType:
        trimStr(data.stockxCheckoutType) ||
        trimStr(a.stockxCheckoutType) ||
        trimStr(existing?.stockxCheckoutType) ||
        null,
      stockxStates: data.stockxStates !== undefined ? data.stockxStates : a.stockxStates ?? existing?.stockxStates ?? null,
      matchConfidence: "high",
      matchScore: 1,
      matchType: auto ? "SYNC" : "MANUAL",
      matchReasons: auto
        ? JSON.stringify(["MANUAL_STOCKX_ORDER_LOOKUP_GALAXUS"])
        : JSON.stringify(["MANUAL_ENTRY"]),
      timeDiffHours: null,
      updatedAt: new Date(),
    };

    const match = await prismaAny.galaxusStockxMatch.upsert({
      where: { galaxusOrderLineId: line.id },
      update: payload,
      create: payload,
    });

    return NextResponse.json({ ok: true, match, stockxEnrich });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Manual entry failed" },
      { status: 500 }
    );
  }
}
