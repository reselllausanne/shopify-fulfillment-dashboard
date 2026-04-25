import { NextResponse } from "next/server";
import { createLimiter } from "@/galaxus/jobs/bulkSql";
import { prisma } from "@/app/lib/prisma";
import {
  extractStockxVariantId,
  fetchRecentStockxBuyingOrders,
} from "@/galaxus/stx/stockxClient";
import {
  GALAXUS_STOCKX_SESSION_FILE,
  GALAXUS_STOCKX_TOKEN_FILE,
  readGalaxusStockxToken,
} from "@/lib/stockxGalaxusAuth";
import {
  buildDecathlonStxLineTargets,
  getDecathlonStxLinkStatusForOrder,
} from "@/decathlon/stx/linkStatus";
import { refreshDecathlonStockxMatchesBySavedOrderNumber } from "@/decathlon/stx/orderNumberRefresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveOrder(orderIdOrRef: string) {
  return (
    (await prisma.decathlonOrder.findUnique({
      where: { id: orderIdOrRef },
      include: { lines: true },
    })) ??
    (await prisma.decathlonOrder.findUnique({
      where: { orderId: orderIdOrRef },
      include: { lines: true },
    }))
  );
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const order = await resolveOrder(orderId);
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    // Same StockX account + token files as Galaxus direct-delivery.
    const token = await readGalaxusStockxToken();
    if (!token) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing StockX token (use Galaxus token file)",
          hint: {
            sessionFile: GALAXUS_STOCKX_SESSION_FILE,
            tokenFile: GALAXUS_STOCKX_TOKEN_FILE,
            setup:
              "StockX login from Galaxus Direct Delivery or POST /api/galaxus/stx/token with the same token.",
          },
        },
        { status: 409 }
      );
    }

    const targets = await buildDecathlonStxLineTargets(order);

    /** AWB + full buy payload from the StockX order # / chain id already on each match (manual modal or prior sync). */
    const orderNumberRefresh = await refreshDecathlonStockxMatchesBySavedOrderNumber(token, order.id);

    const existingMatches = await prisma.decathlonStockxMatch.findMany({
      where: { decathlonOrderId: order.id },
      select: { decathlonOrderLineId: true, stockxOrderId: true, stockxOrderNumber: true },
    });
    const linkedLineIds = new Set(
      existingMatches
        .filter(
          (m) =>
            String(m.stockxOrderNumber ?? "").trim().length > 0 ||
            String(m.stockxOrderId ?? "").trim().length > 0
        )
        .map((m) => m.decathlonOrderLineId)
    );

    const unmatchedTargets = targets.filter((t) => !linkedLineIds.has(t.lineId));
    const pendingSupplierVariantIds = new Set(unmatchedTargets.map((t) => t.supplierVariantId));

    if (pendingSupplierVariantIds.size === 0) {
      const status = await getDecathlonStxLinkStatusForOrder(order.id);
      return NextResponse.json({
        ok: true,
        orderId: order.orderId,
        decathlonOrderDbId: order.id,
        stockxBuyingOrders: [],
        stockxBuyingOrdersEnriched: [],
        sync: {
          fetchedOrders: 0,
          inspectedOrders: 0,
          linked: 0,
          alreadyLinked: 0,
          noPendingUnit: 0,
          missingEta: 0,
          etaBackfilled: 0,
          skippedNoVariant: 0,
          skippedNotPendingVariant: 0,
          errors: 0,
          orderNumberRefresh,
        },
        status: {
          miraklOrderId: status.miraklOrderId,
          hasStxItems: status.hasStxItems,
          allLinked: status.allLinked,
          allEtaPresent: status.allEtaPresent,
          allAwbPresent: status.allAwbPresent,
          buckets: status.buckets,
        },
      });
    }

    const pendingCount = pendingSupplierVariantIds.size;
    const desiredCount = Math.min(60, Math.max(12, pendingCount * 4));
    const pageSize = Math.min(50, Math.max(15, pendingCount * 3));
    const maxPages = Math.min(6, Math.max(2, Math.ceil(desiredCount / pageSize)));
    const orders = await fetchRecentStockxBuyingOrders(token, {
      first: pageSize,
      maxPages,
      state: "PENDING",
    });
    const ordersToInspect = orders.slice(0, desiredCount);

    const stockxBuyingOrdersEnriched = (ordersToInspect as any[]).slice(0, 40).map((listNode) => ({
      orderId: String(listNode?.orderId ?? "").trim() || null,
      chainId: String(listNode?.chainId ?? "").trim() || null,
      orderNumber: (listNode as any)?.orderNumber ?? null,
      purchaseDate: (listNode as any)?.purchaseDate ?? null,
      localizedSizeTitle: (listNode as any)?.localizedSizeTitle ?? null,
      details: {
        awb: null,
        etaMin: listNode?.estimatedDeliveryDateRange?.estimatedDeliveryDate ?? null,
        etaMax: listNode?.estimatedDeliveryDateRange?.latestEstimatedDeliveryDate ?? null,
        order: listNode ?? null,
      },
    }));

    const queue = [...unmatchedTargets];
    const takeNextLineForVariant = (supplierVariantId: string) => {
      const idx = queue.findIndex((t) => t.supplierVariantId === supplierVariantId);
      if (idx < 0) return null;
      const [t] = queue.splice(idx, 1);
      return t;
    };

    // Serialize link attempts so two parallel workers cannot grab the same Decathlon line.
    const limiter = createLimiter(1);
    let inspectedOrders = 0;
    let linked = 0;
    let alreadyLinked = 0;
    let noPendingUnit = 0;
    let missingEta = 0;
    let skippedNoVariant = 0;
    let skippedNotPendingVariant = 0;
    let errors = 0;

    await Promise.all(
      ordersToInspect.map((listNode: any) =>
        limiter(async () => {
          const stockxOrderId = typeof listNode.orderId === "string" ? listNode.orderId.trim() : "";
          const chainId = typeof listNode.chainId === "string" ? listNode.chainId.trim() : "";
          if (!stockxOrderId || !chainId) return;

          // Buying list often omits productVariant.id; variant exists on order details (same as enrich path).
          const fastVariant = extractStockxVariantId(listNode, null);
          if (fastVariant) {
            const sid = `stx_${fastVariant}`;
            if (!pendingSupplierVariantIds.has(sid)) {
              skippedNotPendingVariant += 1;
              return;
            }
          }

          inspectedOrders += 1;
          const variantId = extractStockxVariantId(listNode, null);
          if (!variantId) {
            skippedNoVariant += 1;
            return;
          }
          const resolvedSupplierVariantId = `stx_${variantId}`;
          if (!pendingSupplierVariantIds.has(resolvedSupplierVariantId)) {
            skippedNotPendingVariant += 1;
            return;
          }

          const existingStx = await prisma.decathlonStockxMatch.findFirst({
            where: { stockxOrderId },
            select: { id: true },
          });
          if (existingStx) {
            alreadyLinked += 1;
            return;
          }

          const target = takeNextLineForVariant(resolvedSupplierVariantId);
          if (!target) {
            noPendingUnit += 1;
            return;
          }

          const etaMinRaw = listNode?.estimatedDeliveryDateRange?.estimatedDeliveryDate ?? null;
          const etaMaxRaw = listNode?.estimatedDeliveryDateRange?.latestEstimatedDeliveryDate ?? null;
          const normalizedEtaMin = etaMinRaw ?? etaMaxRaw ?? null;
          const normalizedEtaMax = etaMaxRaw ?? etaMinRaw ?? null;
          if (!normalizedEtaMin || !normalizedEtaMax) {
            missingEta += 1;
          }

          const lineRow = order.lines.find((l: { id: string }) => l.id === target.lineId);
          const size =
            listNode?.localizedSizeTitle ?? listNode?.productVariant?.traits?.size ?? null;
          const payload = {
            decathlonOrderId: order.id,
            decathlonOrderDate: order.orderDate ?? null,
            decathlonOrderLineId: target.lineId,
            decathlonLineNumber: lineRow?.lineNumber ?? null,
            decathlonProductName: listNode?.productVariant?.product?.title ?? null,
            decathlonDescription: lineRow?.description ?? null,
            decathlonSize: size,
            decathlonGtin: target.gtin,
            decathlonProviderKey: lineRow?.providerKey ?? null,
            decathlonSupplierSku: lineRow?.supplierSku ?? null,
            decathlonQuantity: target.qty,
            decathlonUnitNetPrice: lineRow?.unitPrice ?? null,
            decathlonLineNetAmount: lineRow?.lineTotal ?? null,
            decathlonVatRate: null,
            decathlonCurrencyCode: order.currencyCode ?? "CHF",
            stockxChainId: String(listNode?.chainId ?? "").trim() || null,
            stockxOrderId: stockxOrderId,
            stockxOrderNumber: String(listNode?.orderNumber ?? "").trim() || `STX-${order.orderId}`,
            stockxVariantId: String(variantId ?? "").trim() || null,
            stockxProductName: String(listNode?.productVariant?.product?.title ?? "").trim() || null,
            stockxSkuKey: String(listNode?.productVariant?.product?.styleId ?? "").trim() || null,
            stockxSizeEU: String(size ?? "").trim() || null,
            stockxPurchaseDate: listNode?.purchaseDate
              ? new Date(listNode.purchaseDate)
              : listNode?.creationDate
              ? new Date(listNode.creationDate)
              : null,
            stockxAmount: listNode?.amount ?? null,
            stockxCurrencyCode: listNode?.currencyCode ?? null,
            stockxStatus: listNode?.status ?? listNode?.state?.statusTitle ?? null,
            stockxEstimatedDelivery: normalizedEtaMin,
            stockxLatestEstimatedDelivery: normalizedEtaMax,
            stockxAwb: null,
            stockxTrackingUrl: null,
            stockxCheckoutType: null,
            stockxStates: listNode?.state ?? null,
            matchConfidence: "high",
            matchScore: 1,
            matchType: "SYNC",
            matchReasons: JSON.stringify(["STOCKX_SYNC_DECATHLON"]),
            timeDiffHours: null,
          };

          await prisma.decathlonStockxMatch.upsert({
            where: { decathlonOrderLineId: target.lineId },
            update: payload,
            create: payload,
          });
          linked += 1;
        })
      )
    );

    const status = await getDecathlonStxLinkStatusForOrder(order.id);

    return NextResponse.json({
      ok: true,
      orderId: order.orderId,
      decathlonOrderDbId: order.id,
      stockxBuyingOrders: ordersToInspect,
      stockxBuyingOrdersEnriched,
      sync: {
        fetchedOrders: ordersToInspect.length,
        inspectedOrders,
        linked,
        alreadyLinked,
        noPendingUnit,
        missingEta,
        etaBackfilled: 0,
        skippedNoVariant,
        skippedNotPendingVariant,
        errors,
        orderNumberRefresh,
      },
      status: {
        miraklOrderId: status.miraklOrderId,
        hasStxItems: status.hasStxItems,
        allLinked: status.allLinked,
        allEtaPresent: status.allEtaPresent,
        allAwbPresent: status.allAwbPresent,
        buckets: status.buckets,
      },
    });
  } catch (error: any) {
    console.error("[DECATHLON][STX][SYNC] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Sync StockX orders failed" },
      { status: 500 }
    );
  }
}
