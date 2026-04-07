import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
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
      (await prisma.decathlonOrder.findUnique({
        where: { id: orderId },
        include: { lines: true },
      })) ??
      (await prisma.decathlonOrder.findUnique({
        where: { orderId },
        include: { lines: true },
      }));
    if (!order) return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });

    const line = (order.lines || []).find((l: any) => l.id === lineId);
    if (!line) {
      return NextResponse.json({ ok: false, error: "Line not found" }, { status: 404 });
    }

    const partnerSession = await getPartnerSession(request);
    if (partnerSession) {
      const sessionPk = normalizeProviderKey(partnerSession.partnerKey ?? null);
      if (!sessionPk) {
        return NextResponse.json({ ok: false, error: "Invalid partner session" }, { status: 403 });
      }
      const orderPk = normalizeProviderKey(order.partnerKey ?? null);
      // Only enforce tenant isolation when the order is assigned to a partner (non-null partnerKey).
      if (orderPk != null && orderPk !== sessionPk) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "This Decathlon order is linked to another partner account. Use the admin Decathlon page without partner login, or fix order.partnerKey.",
          },
          { status: 403 }
        );
      }
      const existing = await prisma.decathlonStockxMatch.findUnique({
        where: { decathlonOrderLineId: lineId },
      });
      if (existing) {
        const status = trimStr(existing.stockxStatus) || "MATCHED";
        return NextResponse.json(
          {
            ok: false,
            error:
              `This line already has a StockX record on the admin dashboard (status: ${status}). Duplicates are not allowed — contact an admin to change it.`,
          },
          { status: 403 }
        );
      }
    }

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
        auto = applyStockxDetailsToDecathlonMatchFields(resolved.listNode, resolved.details);
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
    const resolvedCost =
      manualCost !== null
        ? manualCost
        : a.stockxAmount != null
          ? Number(a.stockxAmount)
          : null;

    const stockxOrderNumberFinal =
      trimStr(data.stockxOrderNumber) ||
      a.stockxOrderNumber ||
      `MANUAL-${order.orderId}-${line.lineNumber ?? 1}`;

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
      stockxChainId: trimStr(data.stockxChainId) || a.stockxChainId || null,
      stockxOrderId: trimStr(data.stockxOrderId) || a.stockxOrderId || null,
      stockxOrderNumber: stockxOrderNumberFinal,
      stockxVariantId: trimStr(data.stockxVariantId) || a.stockxVariantId || null,
      stockxProductName: trimStr(data.stockxProductName) || a.stockxProductName || null,
      stockxSkuKey: trimStr(data.stockxSkuKey) || a.stockxSkuKey || null,
      stockxSizeEU: trimStr(data.stockxSizeEU) || a.stockxSizeEU || null,
      stockxPurchaseDate: parseMaybeDate(data.stockxPurchaseDate) ?? a.stockxPurchaseDate ?? null,
      stockxAmount: resolvedCost,
      stockxCurrencyCode:
        trimStr(data.shopifyCurrencyCode ?? data.stockxCurrencyCode) ||
        trimStr(a.stockxCurrencyCode) ||
        String(order.currencyCode ?? "CHF").trim(),
      stockxStatus: trimStr(data.stockxStatus) || a.stockxStatus || "MANUAL",
      stockxEstimatedDelivery: parseMaybeDate(data.stockxEstimatedDelivery) ?? a.stockxEstimatedDelivery ?? null,
      stockxLatestEstimatedDelivery:
        parseMaybeDate(data.stockxLatestEstimatedDelivery) ?? a.stockxLatestEstimatedDelivery ?? null,
      stockxAwb: trimStr(data.stockxAwb) || a.stockxAwb || null,
      stockxTrackingUrl: trimStr(data.stockxTrackingUrl) || a.stockxTrackingUrl || null,
      stockxCheckoutType: trimStr(data.stockxCheckoutType) || a.stockxCheckoutType || null,
      stockxStates: data.stockxStates ?? a.stockxStates ?? null,
      matchConfidence: "high",
      matchScore: 1,
      matchType: auto ? "SYNC" : "MANUAL",
      matchReasons: auto
        ? JSON.stringify(["MANUAL_STOCKX_ORDER_LOOKUP"])
        : JSON.stringify(["MANUAL_ENTRY"]),
      timeDiffHours: null,
      updatedAt: new Date(),
    };

    const match = await prisma.decathlonStockxMatch.upsert({
      where: { decathlonOrderLineId: line.id },
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
