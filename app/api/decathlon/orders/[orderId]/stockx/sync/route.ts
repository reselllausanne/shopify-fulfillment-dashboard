import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { leanBuyOrder } from "@/galaxus/stx/leanBuyOrder";
import {
  extractStockxVariantId,
  fetchRecentStockxBuyingOrders,
  fetchStockxBuyOrderDetailsFull,
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

const DECATHLON_STX_DETAIL_GAP_MS = Math.max(
  120,
  Number(process.env.STOCKX_DECATHLON_DETAIL_GAP_MS ?? "280")
);

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    const desiredCount = Math.min(140, Math.max(28, pendingCount * 5));
    const pageSize = Math.min(100, Math.max(40, pendingCount * 4));
    const maxPages = Math.min(8, Math.max(2, Math.ceil(desiredCount / pageSize)));

    let orders: any[] = [];
    let stockxListFetchError: string | null = null;
    try {
      orders = await fetchRecentStockxBuyingOrders(token, {
        first: pageSize,
        maxPages,
        state: "PENDING",
      });
    } catch (error: any) {
      stockxListFetchError = error?.message ?? "failed_to_fetch_stockx_buying_orders";
    }
    if (stockxListFetchError) {
      const status = await getDecathlonStxLinkStatusForOrder(order.id);
      return NextResponse.json(
        {
          ok: false,
          error: `StockX buying list request failed: ${stockxListFetchError}`,
          orderId: order.orderId,
          decathlonOrderDbId: order.id,
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
            errors: 1,
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
        },
        { status: 502 }
      );
    }
    const ordersToInspect = (orders as any[]).slice(0, desiredCount);

    const getOrderKey = (listNode: any): string => {
      const chainId = typeof listNode?.chainId === "string" ? listNode.chainId.trim() : "";
      const orderId = typeof listNode?.orderId === "string" ? listNode.orderId.trim() : "";
      return chainId && orderId ? `${chainId}::${orderId}` : "";
    };

    const candidateByKey = new Map<string, any>();
    const unknownVariantCandidates: any[] = [];
    for (const listNode of ordersToInspect) {
      const key = getOrderKey(listNode);
      if (!key) continue;
      const fastVariant = extractStockxVariantId(listNode, null);
      if (fastVariant) {
        if (pendingSupplierVariantIds.has(`stx_${fastVariant}`)) {
          candidateByKey.set(key, listNode);
        }
        continue;
      }
      unknownVariantCandidates.push(listNode);
    }
    if (candidateByKey.size < unmatchedTargets.length && unknownVariantCandidates.length > 0) {
      const unknownLimit = Math.min(36, Math.max(8, unmatchedTargets.length * 3));
      for (const listNode of unknownVariantCandidates.slice(0, unknownLimit)) {
        const key = getOrderKey(listNode);
        if (key) candidateByKey.set(key, listNode);
      }
    }
    if (candidateByKey.size === 0) {
      for (const listNode of ordersToInspect.slice(0, Math.min(24, ordersToInspect.length))) {
        const key = getOrderKey(listNode);
        if (key) candidateByKey.set(key, listNode);
      }
    }
    const ordersForLinking = Array.from(candidateByKey.values());
    const stockxListWarning =
      ordersToInspect.length === 0
        ? "StockX returned 0 rows for state=PENDING. Buy list may be empty for this account/session."
        : ordersForLinking.length === 0
          ? "StockX rows fetched but no candidate rows could be prepared for linking."
          : null;

    const detailsCache = new Map<
      string,
      Awaited<ReturnType<typeof fetchStockxBuyOrderDetailsFull>> | null
    >();
    const fetchDetailsCached = async (
      chainId: string,
      orderId: string
    ): Promise<Awaited<ReturnType<typeof fetchStockxBuyOrderDetailsFull>> | null> => {
      const key = `${chainId}::${orderId}`;
      if (detailsCache.has(key)) {
        return detailsCache.get(key) ?? null;
      }
      try {
        const details = await fetchStockxBuyOrderDetailsFull(token, { chainId, orderId });
        detailsCache.set(key, details);
        return details;
      } catch {
        detailsCache.set(key, null);
        return null;
      }
    };

    const queue = [...unmatchedTargets];
    const takeNextLineForVariant = (supplierVariantId: string) => {
      const idx = queue.findIndex((t) => t.supplierVariantId === supplierVariantId);
      if (idx < 0) return null;
      const [t] = queue.splice(idx, 1);
      return t;
    };

    let inspectedOrders = 0;
    let linked = 0;
    let alreadyLinked = 0;
    let noPendingUnit = 0;
    let missingEta = 0;
    let skippedNoVariant = 0;
    let skippedNotPendingVariant = 0;
    let errors = 0;
    const stockxBuyingOrdersEnriched: Array<Record<string, unknown>> = [];
    const maxEnrichedRows = Math.min(30, Math.max(10, ordersForLinking.length));
    const pushEnrichedRow = (row: Record<string, unknown>) => {
      if (stockxBuyingOrdersEnriched.length >= maxEnrichedRows) return;
      stockxBuyingOrdersEnriched.push(row);
    };

    for (const listNode of ordersForLinking) {
      const stockxOrderId = typeof listNode?.orderId === "string" ? listNode.orderId.trim() : "";
      const chainId = typeof listNode?.chainId === "string" ? listNode.chainId.trim() : "";
      if (!stockxOrderId || !chainId) {
        pushEnrichedRow({
          orderId: stockxOrderId || null,
          chainId: chainId || null,
          orderNumber: String(listNode?.orderNumber ?? "").trim() || null,
          purchaseDate: listNode?.purchaseDate ?? null,
          localizedSizeTitle: listNode?.localizedSizeTitle ?? null,
          details: null,
          enrichmentError: "missing_order_id",
        });
        continue;
      }

      const fastVariant = extractStockxVariantId(listNode, null);
      if (fastVariant && !pendingSupplierVariantIds.has(`stx_${fastVariant}`)) {
        skippedNotPendingVariant += 1;
        continue;
      }

      inspectedOrders += 1;
      const details = await fetchDetailsCached(chainId, stockxOrderId);
      if (DECATHLON_STX_DETAIL_GAP_MS > 0) {
        await sleepMs(DECATHLON_STX_DETAIL_GAP_MS);
      }
      if (!details) {
        errors += 1;
        pushEnrichedRow({
          orderId: stockxOrderId,
          chainId,
          orderNumber: String(listNode?.orderNumber ?? "").trim() || null,
          purchaseDate: listNode?.purchaseDate ?? null,
          localizedSizeTitle: listNode?.localizedSizeTitle ?? null,
          details: null,
          enrichmentError: "details_failed",
        });
        continue;
      }

      const variantId = extractStockxVariantId(listNode, details.order);
      if (!variantId) {
        skippedNoVariant += 1;
        pushEnrichedRow({
          orderId: stockxOrderId,
          chainId,
          orderNumber: String(listNode?.orderNumber ?? "").trim() || null,
          purchaseDate: listNode?.purchaseDate ?? null,
          localizedSizeTitle: listNode?.localizedSizeTitle ?? null,
          details: {
            awb: details.awb ?? null,
            etaMin: details.etaMin ? details.etaMin.toISOString() : null,
            etaMax: details.etaMax ? details.etaMax.toISOString() : null,
            order: leanBuyOrder(details.order),
          },
          enrichmentError: "missing_variant_id",
        });
        continue;
      }
      const resolvedSupplierVariantId = `stx_${variantId}`;
      if (!pendingSupplierVariantIds.has(resolvedSupplierVariantId)) {
        skippedNotPendingVariant += 1;
        continue;
      }

      const existingStx = await prisma.decathlonStockxMatch.findFirst({
        where: { stockxOrderId },
        select: { id: true },
      });
      if (existingStx) {
        alreadyLinked += 1;
        pushEnrichedRow({
          orderId: stockxOrderId,
          chainId,
          orderNumber: String(listNode?.orderNumber ?? "").trim() || null,
          purchaseDate: listNode?.purchaseDate ?? null,
          localizedSizeTitle: listNode?.localizedSizeTitle ?? null,
          details: {
            awb: details.awb ?? null,
            etaMin: details.etaMin ? details.etaMin.toISOString() : null,
            etaMax: details.etaMax ? details.etaMax.toISOString() : null,
            order: leanBuyOrder(details.order),
          },
          enrichmentError: "already_linked_order",
        });
        continue;
      }

      const target = takeNextLineForVariant(resolvedSupplierVariantId);
      if (!target) {
        noPendingUnit += 1;
        continue;
      }

      const normalizedEtaMin = details.etaMin ?? details.etaMax ?? null;
      const normalizedEtaMax = details.etaMax ?? details.etaMin ?? null;
      if (!normalizedEtaMin || !normalizedEtaMax) {
        missingEta += 1;
      }

      const lineRow = order.lines.find((l: { id: string }) => l.id === target.lineId);
      const detailVariant = details?.order?.product?.variant ?? null;
      const detailProduct = detailVariant?.product ?? details?.order?.product ?? null;
      const size =
        listNode?.localizedSizeTitle ??
        listNode?.productVariant?.traits?.size ??
        details?.order?.product?.localizedSize?.title ??
        detailVariant?.traits?.size ??
        null;
      const payload = {
        decathlonOrderId: order.id,
        decathlonOrderDate: order.orderDate ?? null,
        decathlonOrderLineId: target.lineId,
        decathlonLineNumber: lineRow?.lineNumber ?? null,
        decathlonProductName:
          String(
            listNode?.productVariant?.product?.title ??
              detailProduct?.title ??
              detailProduct?.primaryTitle ??
              ""
          ).trim() || null,
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
        stockxChainId: String(chainId).trim() || null,
        stockxOrderId: stockxOrderId,
        stockxOrderNumber:
          String(listNode?.orderNumber ?? details?.order?.orderNumber ?? "").trim() ||
          `STX-${order.orderId}`,
        stockxVariantId: String(variantId ?? "").trim() || null,
        stockxProductName:
          String(
            listNode?.productVariant?.product?.title ??
              detailProduct?.title ??
              detailProduct?.primaryTitle ??
              ""
          ).trim() || null,
        stockxSkuKey:
          String(
            listNode?.productVariant?.product?.styleId ??
              detailProduct?.styleId ??
              detailProduct?.id ??
              detailProduct?.urlKey ??
              ""
          ).trim() || null,
        stockxSizeEU: String(size ?? "").trim() || null,
        stockxPurchaseDate: details?.order?.created ? new Date(details.order.created) : null,
        stockxAmount: details?.order?.payment?.settledAmount?.value ?? null,
        stockxCurrencyCode: details?.order?.payment?.settledAmount?.currency ?? null,
        stockxStatus: details?.order?.status ?? null,
        stockxEstimatedDelivery: normalizedEtaMin,
        stockxLatestEstimatedDelivery: normalizedEtaMax,
        stockxAwb: details?.awb ?? null,
        stockxTrackingUrl: details?.order?.shipping?.shipment?.trackingUrl ?? null,
        stockxCheckoutType: details?.order?.checkoutType ?? null,
        stockxStates: details?.order?.states ?? null,
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
      pushEnrichedRow({
        orderId: stockxOrderId,
        chainId,
        orderNumber: String(listNode?.orderNumber ?? "").trim() || null,
        purchaseDate: listNode?.purchaseDate ?? null,
        localizedSizeTitle: listNode?.localizedSizeTitle ?? null,
        details: {
          awb: details.awb ?? null,
          etaMin: details.etaMin ? details.etaMin.toISOString() : null,
          etaMax: details.etaMax ? details.etaMax.toISOString() : null,
          order: leanBuyOrder(details.order),
        },
      });
    }

    const status = await getDecathlonStxLinkStatusForOrder(order.id);

    return NextResponse.json({
      ok: true,
      orderId: order.orderId,
      decathlonOrderDbId: order.id,
      stockxBuyingOrders: ordersToInspect,
      stockxBuyingOrdersEnriched,
      stockxListWarning,
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
