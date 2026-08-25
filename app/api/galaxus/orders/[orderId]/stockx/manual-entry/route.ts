import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import {
  applyStockxDetailsToDecathlonMatchFields,
  looksLikeStockxOrderNumber,
  normalizeStockxOrderNumberInput,
  resolveStockxBuyForManualGalaxus,
} from "@/decathlon/stx/manualStockxEnrich";
import { writeGalaxusStockxToken } from "@/lib/stockxGalaxusAuth";
import { writeServerStockxToken } from "@/lib/stockxServerToken";
import {
  buildStockxOrderClaimIndex,
  findStockxOrderClaim,
} from "@/app/lib/stockxCrossChannelClaims";
import { reconcileGalaxusOrderProcurement } from "@/galaxus/orders/galaxusProcurementReconcile";
import { isLocalOrManualStockxRef } from "@/galaxus/orders/localStockMatch";
import {
  linkOldestPendingStxUnit,
  reserveStxPurchaseUnitsForOrder,
  resolveSupplierVariantIdForGalaxusLine,
} from "@/galaxus/stx/purchaseUnits";
import { galaxusLineWarehouseStockHint } from "@/galaxus/warehouse/lineInventorySource";

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

function normalizeBearer(raw: unknown): string | null {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/^Bearer\s+/i, "");
  return cleaned || null;
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

    const whHint = galaxusLineWarehouseStockHint(line as any);
    if (whHint === "GOLDEN") {
      return NextResponse.json(
        {
          ok: false,
          error: "GLD/Golden line — do not buy on StockX. Place order on Golden manually.",
          reason: "supplier_GLD_golden",
        },
        { status: 400 }
      );
    }

    const prismaAny = prisma as any;
    const unitIndex = Number(body?.unitIndex ?? 0);
    const existing = await prismaAny.galaxusStockxMatch.findUnique({
      where: { galaxusOrderLineId_unitIndex: { galaxusOrderLineId: line.id, unitIndex } },
    });

    const orderNumberInput = normalizeStockxOrderNumberInput(data.stockxOrderNumber);
    let auto: ReturnType<typeof applyStockxDetailsToDecathlonMatchFields> | null = null;
    let stockxEnrich: { attempted: boolean; ok: boolean; reason?: string } = {
      attempted: false,
      ok: false,
    };

    if (enrichFromStockx && orderNumberInput && looksLikeStockxOrderNumber(orderNumberInput)) {
      stockxEnrich.attempted = true;
      try {
        const overrideToken = normalizeBearer(body?.stockxToken);
        if (overrideToken) {
          await writeGalaxusStockxToken(overrideToken).catch(() => undefined);
          await writeServerStockxToken(overrideToken).catch(() => undefined);
        }
        const resolved = await resolveStockxBuyForManualGalaxus(orderNumberInput, {
          overrideToken,
        });
        if (resolved.ok) {
          auto = applyStockxDetailsToDecathlonMatchFields(resolved.listNode, resolved.details, {
            matchReasons: ["MANUAL_STOCKX_ORDER_LOOKUP_GALAXUS"],
          });
          stockxEnrich = { attempted: true, ok: true };
        } else {
          stockxEnrich = { attempted: true, ok: false, reason: resolved.reason };
        }
      } catch (error: any) {
        stockxEnrich = {
          attempted: true,
          ok: false,
          reason: `lookup_failed:${String(error?.message ?? "").trim() || "unknown"}`,
        };
      }
    } else if (orderNumberInput && !looksLikeStockxOrderNumber(orderNumberInput)) {
      stockxEnrich = { attempted: false, ok: false, reason: "manual_reference_only" };
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

    // StockX-looking order # must not save as MANUAL with empty cost (Cornelia / Cloud5 bug).
    // Same as auto-link: either enrich fills amount, user types cost, or refuse.
    if (
      looksLikeStockxOrderNumber(orderNumberInput) &&
      (resolvedCost == null || !Number.isFinite(resolvedCost))
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            stockxEnrich.attempted && !stockxEnrich.ok
              ? `StockX enrich failed (${stockxEnrich.reason ?? "unknown"}) — enter Supplier Cost below and save, or Save token in StockX tools then retry.`
              : "StockX order # requires cost (auto-fill failed or empty). Enter supplier cost, then save.",
          stockxEnrich,
        },
        { status: 422 }
      );
    }

    const stockxOrderNumberFinal =
      orderNumberInput ||
      normalizeStockxOrderNumberInput(a.stockxOrderNumber) ||
      normalizeStockxOrderNumberInput(existing?.stockxOrderNumber) ||
      `MANUAL-${order.galaxusOrderId}-${line.lineNumber ?? 1}`;
    const stockxOrderIdFinal =
      trimStr(data.stockxOrderId) || trimStr(a.stockxOrderId) || trimStr(existing?.stockxOrderId) || null;

    // LOCAL-/MANUAL- refs are not real StockX buys — skip cross-channel claim gate.
    const claimableRef =
      !isLocalOrManualStockxRef(stockxOrderNumberFinal) &&
      (Boolean(stockxOrderIdFinal) || looksLikeStockxOrderNumber(stockxOrderNumberFinal));
    if (claimableRef) {
      const claimIndex = await buildStockxOrderClaimIndex({
        stockxOrderIds: [stockxOrderIdFinal],
        stockxOrderNumbers: [stockxOrderNumberFinal],
      });
      const claim = findStockxOrderClaim(claimIndex, stockxOrderIdFinal, stockxOrderNumberFinal);
      if (claim) {
        const sameGalaxusMatch =
          claim.channel === "galaxus" &&
          !claim.matchId.startsWith("stx_unit:") &&
          claim.matchId === String(existing?.id ?? "");
        const sameGalaxusUnit =
          claim.channel === "galaxus" &&
          claim.matchId.startsWith("stx_unit:") &&
          stockxOrderIdFinal
            ? await (prisma as any).stxPurchaseUnit
                .findFirst({
                  where: { stockxOrderId: stockxOrderIdFinal, galaxusOrderId: order.galaxusOrderId },
                  select: { id: true },
                })
                .then((u: { id: string } | null) => Boolean(u))
            : false;
        if (!sameGalaxusMatch && !sameGalaxusUnit) {
          let ownerHint: string = claim.channel;
          if (claim.channel === "galaxus" && !claim.matchId.startsWith("stx_unit:")) {
            const owner = await (prisma as any).galaxusStockxMatch
              .findUnique({
                where: { id: claim.matchId },
                select: {
                  galaxusOrderRef: true,
                  galaxusProductName: true,
                  galaxusGtin: true,
                  stockxOrderNumber: true,
                },
              })
              .catch(() => null);
            if (owner) {
              ownerHint = `galaxus order ${owner.galaxusOrderRef ?? "?"} (${owner.galaxusProductName ?? "item"}, GTIN ${owner.galaxusGtin ?? "?"}, ref ${owner.stockxOrderNumber ?? claim.stockxOrderNumber ?? "?"})`;
            }
          } else if (claim.channel === "galaxus" && claim.matchId.startsWith("stx_unit:")) {
            const unitId = claim.matchId.slice("stx_unit:".length);
            const owner = await (prisma as any).stxPurchaseUnit
              .findUnique({
                where: { id: unitId },
                select: { galaxusOrderId: true, gtin: true, stockxOrderNumber: true },
              })
              .catch(() => null);
            if (owner) {
              ownerHint = `galaxus order ${owner.galaxusOrderId} (GTIN ${owner.gtin ?? "?"}, ref ${owner.stockxOrderNumber ?? claim.stockxOrderNumber ?? "?"})`;
            }
          }
          return NextResponse.json(
            {
              ok: false,
              error: `StockX order is already linked on ${ownerHint}. Use a different buy, or leave order # empty for local/manual stock.`,
              claim,
            },
            { status: 409 }
          );
        }
      }
    }

    const payload = {
      galaxusOrderId: order.id,
      galaxusOrderRef: order.galaxusOrderId ?? null,
      galaxusOrderDate: order.orderDate ?? null,
      galaxusOrderLineId: line.id,
      unitIndex,
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
      stockxOrderId: stockxOrderIdFinal,
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
      where: { galaxusOrderLineId_unitIndex: { galaxusOrderLineId: line.id, unitIndex } },
      update: payload,
      create: payload,
    });

    let unitLink: Awaited<ReturnType<typeof linkOldestPendingStxUnit>> | null = null;
    if (stockxOrderIdFinal && looksLikeStockxOrderNumber(stockxOrderNumberFinal)) {
      await reserveStxPurchaseUnitsForOrder(order.galaxusOrderId);
      const supplierVariantId = await resolveSupplierVariantIdForGalaxusLine(line);
      if (supplierVariantId) {
        unitLink = await linkOldestPendingStxUnit({
          galaxusOrderId: order.galaxusOrderId,
          supplierVariantId,
          gtin: line.gtin,
          stockxOrderId: stockxOrderIdFinal,
          stockxOrderNumber: stockxOrderNumberFinal,
          awb: payload.stockxAwb,
          etaMin: payload.stockxEstimatedDelivery,
          etaMax: payload.stockxLatestEstimatedDelivery,
          stockxSettledAmount: resolvedCost,
          stockxSettledCurrency: payload.stockxCurrencyCode,
        });
      }
    }

    await reconcileGalaxusOrderProcurement(order.galaxusOrderId, { skipAutoLink: true }).catch((err) => {
      console.warn("[GALAXUS][STX][MANUAL] procurement reconcile skipped:", err?.message ?? err);
    });

    return NextResponse.json({ ok: true, match, stockxEnrich, unitLink });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Manual entry failed" },
      { status: 500 }
    );
  }
}
