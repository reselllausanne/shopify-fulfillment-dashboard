import { NextResponse } from "next/server";
import { createLimiter } from "@/galaxus/jobs/bulkSql";
import {
  getStxLinkStatusForOrder,
  linkOldestPendingStxUnit,
  reserveStxPurchaseUnitsForOrder,
} from "@/galaxus/stx/purchaseUnits";
import {
  extractStockxVariantId,
  fetchRecentStockxBuyingOrders,
  fetchStockxBuyOrderDetails,
  fetchStockxBuyOrderDetailsFull,
} from "@/galaxus/stx/stockxClient";
import {
  GALAXUS_STOCKX_SESSION_FILE,
  GALAXUS_STOCKX_TOKEN_FILE,
  readGalaxusStockxToken,
} from "@/lib/stockxGalaxusAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const leanBuyOrder = (order: any) => {
      if (!order) return null;
      return {
        id: order?.id ?? null,
        chainId: order?.chainId ?? null,
        orderNumber: order?.orderNumber ?? null,
        created: order?.created ?? null,
        status: order?.status ?? null,
        currentStatus: order?.currentStatus
          ? {
              key: order.currentStatus.key ?? null,
              completionStatus: order.currentStatus.completionStatus ?? null,
            }
          : null,
        estimatedDeliveryDateRange: order?.estimatedDeliveryDateRange
          ? {
              estimatedDeliveryDate: order.estimatedDeliveryDateRange.estimatedDeliveryDate ?? null,
              latestEstimatedDeliveryDate: order.estimatedDeliveryDateRange.latestEstimatedDeliveryDate ?? null,
              estimatedDeliveryStatus: order.estimatedDeliveryDateRange.estimatedDeliveryStatus ?? null,
            }
          : null,
        checkoutType: order?.checkoutType ?? null,
        shipping: order?.shipping
          ? {
              shipment: order.shipping.shipment
                ? {
                    trackingUrl: order.shipping.shipment.trackingUrl ?? null,
                    deliveryDate: order.shipping.shipment.deliveryDate ?? null,
                  }
                : null,
            }
          : null,
        product: order?.product
          ? {
              localizedSize: order.product.localizedSize
                ? { title: order.product.localizedSize.title ?? null }
                : null,
              variant: order.product.variant
                ? {
                    id: order.product.variant.id ?? null,
                    product: order.product.variant.product
                      ? {
                          id: order.product.variant.product.id ?? null,
                          title: order.product.variant.product.title ?? null,
                          brand: order.product.variant.product.brand ?? null,
                          urlKey: order.product.variant.product.urlKey ?? null,
                          media: order.product.variant.product.media
                            ? {
                                thumbUrl: order.product.variant.product.media.thumbUrl ?? null,
                                imageUrl: order.product.variant.product.media.imageUrl ?? null,
                              }
                            : null,
                        }
                      : null,
                  }
                : null,
            }
          : null,
        payment: order?.payment
          ? {
              settledAmount: order.payment.settledAmount
                ? {
                    value: order.payment.settledAmount.value ?? null,
                    currency: order.payment.settledAmount.currency ?? null,
                  }
                : null,
              authorizedAmount: order.payment.authorizedAmount
                ? {
                    value: order.payment.authorizedAmount.value ?? null,
                    currency: order.payment.authorizedAmount.currency ?? null,
                  }
                : null,
            }
          : null,
      };
    };

    const { orderId } = await params;
    const reservation = await reserveStxPurchaseUnitsForOrder(orderId);
    const initialStatus = reservation.status;
    console.info("[GALAXUS][STX][SYNC] Start", {
      galaxusOrderId: reservation.galaxusOrderId,
      buckets: initialStatus.buckets?.map((bucket) => ({
        gtin: bucket.gtin,
        supplierVariantId: bucket.supplierVariantId,
        needed: bucket.needed,
        reserved: bucket.reserved,
        linked: bucket.linked,
        linkedWithEta: bucket.linkedWithEta,
      })),
    });
    const pendingSupplierVariantIds = new Set(
      initialStatus.buckets
        .filter((bucket) => bucket.linked < bucket.needed)
        .map((bucket) => bucket.supplierVariantId)
    );

    if (pendingSupplierVariantIds.size === 0) {
      return NextResponse.json({
        ok: true,
        galaxusOrderId: reservation.galaxusOrderId,
        reserve: reservation,
        sync: {
          fetchedOrders: 0,
          inspectedOrders: 0,
          linked: 0,
          alreadyLinked: 0,
          noPendingUnit: 0,
          skippedNoVariant: 0,
          skippedNotPendingVariant: 0,
          errors: 0,
        },
        status: initialStatus,
      });
    }

    const token = await readGalaxusStockxToken();
    if (!token) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing Galaxus StockX token file",
          hint: {
            sessionFile: GALAXUS_STOCKX_SESSION_FILE,
            tokenFile: GALAXUS_STOCKX_TOKEN_FILE,
            setup:
              "Call /api/stockx/playwright with {\"sessionFile\":\".data/stockx-session-galaxus.json\",\"tokenFile\":\".data/stockx-token-galaxus.json\",\"forceLogin\":true}",
          },
          reserve: reservation,
          status: initialStatus,
        },
        { status: 409 }
      );
    }

    // We want actual buy orders for the account token; "PENDING" is the most useful for linking.
    const orders = await fetchRecentStockxBuyingOrders(token, { first: 50, maxPages: 8, state: "PENDING" });
    console.info("[GALAXUS][STX][SYNC] StockX buying orders fetched", {
      count: orders.length,
      sample: orders.slice(0, 3).map((node: any) => ({
        chainId: node?.chainId ?? null,
        orderId: node?.orderId ?? null,
        orderNumber: node?.orderNumber ?? null,
        purchaseDate: node?.purchaseDate ?? null,
        statusKey: node?.state?.statusKey ?? null,
        size: node?.localizedSizeTitle ?? node?.productVariant?.traits?.size ?? null,
        productTitle: node?.productVariant?.product?.title ?? node?.productVariant?.product?.name ?? null,
        styleId: node?.productVariant?.product?.styleId ?? null,
        variantId: node?.productVariant?.id ?? null,
      })),
    });
    for (const node of orders as any[]) {
      console.info("[GALAXUS][STX][SYNC][STOCKX_ORDER]", {
        chainId: node?.chainId ?? null,
        orderId: node?.orderId ?? null,
        orderNumber: node?.orderNumber ?? null,
        purchaseDate: node?.purchaseDate ?? null,
        statusKey: node?.state?.statusKey ?? null,
        statusTitle: node?.state?.statusTitle ?? null,
        amount: node?.amount ?? null,
        currencyCode: node?.currencyCode ?? null,
        estimatedDeliveryDate: node?.estimatedDeliveryDateRange?.estimatedDeliveryDate ?? null,
        latestEstimatedDeliveryDate: node?.estimatedDeliveryDateRange?.latestEstimatedDeliveryDate ?? null,
        localizedSizeTitle: node?.localizedSizeTitle ?? null,
        localizedSizeType: node?.localizedSizeType ?? null,
        baseSize: node?.productVariant?.sizeChart?.baseSize ?? null,
        baseType: node?.productVariant?.sizeChart?.baseType ?? null,
        traitSize: node?.productVariant?.traits?.size ?? null,
        product: {
          title: node?.productVariant?.product?.title ?? null,
          name: node?.productVariant?.product?.name ?? null,
          model: node?.productVariant?.product?.model ?? null,
          styleId: node?.productVariant?.product?.styleId ?? null,
          category: node?.productVariant?.product?.productCategory ?? null,
          primaryCategory: node?.productVariant?.product?.primaryCategory ?? null,
        },
        productVariantId: node?.productVariant?.id ?? null,
      });
    }
    // Enrich all fetched account orders (A+B) for UI log output.
    const enrichLimiter = createLimiter(4);
    const stockxBuyingOrdersEnriched = await Promise.all(
      (orders as any[]).map((listNode) =>
        enrichLimiter(async () => {
          const stockxOrderId = typeof listNode.orderId === "string" ? listNode.orderId.trim() : "";
          const chainId = typeof listNode.chainId === "string" ? listNode.chainId.trim() : "";
          if (!stockxOrderId || !chainId) {
            return {
              orderId: stockxOrderId || null,
              chainId: chainId || null,
              orderNumber: (listNode as any)?.orderNumber ?? null,
              purchaseDate: (listNode as any)?.purchaseDate ?? null,
              localizedSizeTitle: (listNode as any)?.localizedSizeTitle ?? null,
              details: null,
              enrichmentError: "missing_order_id",
            };
          }
          try {
            const details = await fetchStockxBuyOrderDetailsFull(token, { chainId, orderId: stockxOrderId });
            return {
              orderId: stockxOrderId,
              chainId,
              orderNumber: (listNode as any)?.orderNumber ?? null,
              purchaseDate: (listNode as any)?.purchaseDate ?? null,
              localizedSizeTitle: (listNode as any)?.localizedSizeTitle ?? null,
              details: {
                awb: details.awb ?? null,
                etaMin: details.etaMin ? details.etaMin.toISOString() : null,
                etaMax: details.etaMax ? details.etaMax.toISOString() : null,
                order: leanBuyOrder(details.order),
              },
            };
          } catch (error: any) {
            return {
              orderId: stockxOrderId,
              chainId,
              orderNumber: (listNode as any)?.orderNumber ?? null,
              purchaseDate: (listNode as any)?.purchaseDate ?? null,
              localizedSizeTitle: (listNode as any)?.localizedSizeTitle ?? null,
              details: null,
              enrichmentError: error?.message ?? "details_failed",
            };
          }
        })
      )
    );

    const limiter = createLimiter(4);

    let inspectedOrders = 0;
    let linked = 0;
    let alreadyLinked = 0;
    let noPendingUnit = 0;
    let skippedNoVariant = 0;
    let skippedNotPendingVariant = 0;
    let errors = 0;

    await Promise.all(
      orders.map((listNode) =>
        limiter(async () => {
          const stockxOrderId = typeof listNode.orderId === "string" ? listNode.orderId.trim() : "";
          const chainId = typeof listNode.chainId === "string" ? listNode.chainId.trim() : "";
          if (!stockxOrderId || !chainId) return;

          const fastVariant = extractStockxVariantId(listNode, null);
          if (!fastVariant) {
            skippedNoVariant += 1;
            console.info("[GALAXUS][STX][SYNC][SKIP] No variant id", {
              chainId,
              orderId: stockxOrderId,
              orderNumber: (listNode as any)?.orderNumber ?? null,
            });
            return;
          }
          const supplierVariantId = `stx_${fastVariant}`;
          if (!pendingSupplierVariantIds.has(supplierVariantId)) {
            skippedNotPendingVariant += 1;
            console.info("[GALAXUS][STX][SYNC][SKIP] Not pending variant", {
              chainId,
              orderId: stockxOrderId,
              orderNumber: (listNode as any)?.orderNumber ?? null,
              supplierVariantId,
            });
            return;
          }

          inspectedOrders += 1;
          let details: Awaited<ReturnType<typeof fetchStockxBuyOrderDetails>>;
          try {
            details = await fetchStockxBuyOrderDetails(token, {
              chainId,
              orderId: stockxOrderId,
            });
          } catch {
            errors += 1;
            console.error("[GALAXUS][STX][SYNC][ERROR] Failed to fetch order details", {
              chainId,
              orderId: stockxOrderId,
              orderNumber: (listNode as any)?.orderNumber ?? null,
            });
            return;
          }

          const variantId = extractStockxVariantId(listNode, details.order);
          if (!variantId) {
            skippedNoVariant += 1;
            console.info("[GALAXUS][STX][SYNC][SKIP] No variant id after details", {
              chainId,
              orderId: stockxOrderId,
              orderNumber: (listNode as any)?.orderNumber ?? null,
            });
            return;
          }
          const linkResult = await linkOldestPendingStxUnit({
            galaxusOrderId: reservation.galaxusOrderId,
            supplierVariantId: `stx_${variantId}`,
            stockxOrderId,
            awb: details.awb ?? null,
            etaMin: details.etaMin ?? null,
            etaMax: details.etaMax ?? null,
            checkoutType:
              typeof details.order?.checkoutType === "string" ? details.order.checkoutType : null,
          });

          console.info("[GALAXUS][STX][SYNC][LINK_ATTEMPT]", {
            galaxusOrderId: reservation.galaxusOrderId,
            chainId,
            orderId: stockxOrderId,
            orderNumber: (listNode as any)?.orderNumber ?? null,
            supplierVariantId: `stx_${variantId}`,
            awb: details.awb ?? null,
            etaMin: details.etaMin ? details.etaMin.toISOString() : null,
            etaMax: details.etaMax ? details.etaMax.toISOString() : null,
            checkoutType: typeof details.order?.checkoutType === "string" ? details.order.checkoutType : null,
            result: linkResult,
          });

          if (linkResult.status === "linked") linked += 1;
          else if (linkResult.status === "already_linked") alreadyLinked += 1;
          else if (linkResult.status === "no_pending_unit") noPendingUnit += 1;
        })
      )
    );

    const status = await getStxLinkStatusForOrder(reservation.galaxusOrderId);
    return NextResponse.json({
      ok: true,
      galaxusOrderId: reservation.galaxusOrderId,
      // Return StockX account orders so the UI can show them in Ops Log.
      stockxBuyingOrders: orders,
      stockxBuyingOrdersEnriched,
      sync: {
        fetchedOrders: orders.length,
        inspectedOrders,
        linked,
        alreadyLinked,
        noPendingUnit,
        skippedNoVariant,
        skippedNotPendingVariant,
        errors,
      },
      status,
    });
  } catch (error: any) {
    console.error("[GALAXUS][STX][SYNC] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Sync StockX orders failed" },
      { status: 500 }
    );
  }
}

