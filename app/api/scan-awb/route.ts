import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import {
  awbLookupCandidates,
  findStockxInboundHomeRouteByCode,
  findStockxInboundHomeRouteByShopifyOrderName,
  normalizeInboundHomeAwb,
} from "@/app/lib/stockxInboundHomeRoutes";
import { fetchOrderShippingInfo } from "@/lib/shopifyFulfillment";
import { getStxLinkStatusForOrder } from "@/galaxus/stx/purchaseUnits";
import { buildScanDemoScanPayload, resolveScanDemoChannel } from "@/lib/scanFulfillmentDemo";
import {
  recordWarehouseScanMiss,
  WAREHOUSE_SCAN_MISS_RETENTION_DAYS,
} from "@/lib/warehouseScanMiss";
import { resolveGtinFallback } from "@/app/api/scan-awb/gtinFallback";
import {
  isShopifyOrderMatchFresh,
  shopifyMatchMinCreatedAt,
} from "@/app/lib/shopifyMatchEligibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ScanStatus = "FOUND" | "NOT_FOUND" | "UNMATCHED" | "ERROR";

async function enrichOrderMatchFromShopify(match: {
  shopifyOrderId: string;
  shopifyLineItemId: string | null;
  shopifyProductTitle: string | null;
  shopifySizeEU: string | null;
  shopifySku: string | null;
}) {
  try {
    const orderInfo = await fetchOrderShippingInfo(match.shopifyOrderId);
    if (!orderInfo) return null;

    const addr = orderInfo.shippingAddress;
    const labelAddr = orderInfo.labelShippingAddress ?? null;
    const composedName =
      [orderInfo.customer?.firstName, orderInfo.customer?.lastName].filter(Boolean).join(" ").trim() ||
      String(orderInfo.customer?.displayName ?? "").trim() ||
      [addr?.firstName, addr?.lastName].filter(Boolean).join(" ").trim() ||
      (addr?.name || "").trim() ||
      null;

    const lineNodes = orderInfo.lineItems?.nodes ?? [];
    const targetId = match.shopifyLineItemId;
    const li =
      (targetId ? lineNodes.find((n) => n.id === targetId) : undefined) || lineNodes[0] || null;

    const toAddrPayload = (a: typeof addr) =>
      a
        ? {
            address1: a.address1 ?? null,
            address2: a.address2 ?? null,
            zip: a.zip ?? null,
            city: a.city ?? null,
            province: a.province ?? null,
            country: (a.country || a.countryCodeV2) ?? null,
            company: a.company ?? null,
            name: a.name ?? null,
          }
        : null;

    return {
      customer: {
        name: composedName,
        email: orderInfo.email ?? null,
        phone: orderInfo.phone || addr?.phone || null,
        shippingAddress: toAddrPayload(addr),
      },
      shipToStore: Boolean(orderInfo.shipToStore),
      isStorePickup: Boolean(orderInfo.isStorePickup),
      pickupLabel: orderInfo.pickup?.label ?? null,
      pickupLocation: orderInfo.pickup?.locationName ?? null,
      labelShippingAddress: toAddrPayload(labelAddr),
      lineItem: li
        ? {
            title: li.title,
            variantTitle: li.variantTitle,
            sku: li.sku || li.variantSku || null,
            quantity: li.quantity,
          }
        : {
            title: match.shopifyProductTitle,
            variantTitle: match.shopifySizeEU,
            sku: match.shopifySku,
            quantity: 1,
          },
      shopifyOrder: {
        name: orderInfo.name,
        customerLocale: orderInfo.customerLocale ?? null,
        paymentGatewayNames: orderInfo.paymentGatewayNames ?? [],
        shippingLines: (orderInfo.shippingLines || [])
          .filter((s) => !s.isRemoved)
          .map((s) => `${s.title} (${s.amount} ${s.currencyCode})`),
        lineItems: lineNodes.map((n) => ({
          id: n.id,
          title: n.title,
          name: n.name ?? null,
          quantity: n.quantity,
          sku: n.sku || n.variantSku || null,
          variantTitle: n.variantTitle,
        })),
      },
    };
  } catch (err) {
    console.error("[SCAN-AWB] Shopify enrich failed:", err);
    return null;
  }
}

const normalizeCode = (code?: string | null) => normalizeInboundHomeAwb(code);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const list = searchParams.get("list");
    const misses = searchParams.get("misses");
    const limit = Math.min(Number(searchParams.get("limit") || 500), 2000);

    if (misses === "1") {
      const daysRaw = Number(searchParams.get("days") || WAREHOUSE_SCAN_MISS_RETENTION_DAYS);
      const days = Number.isFinite(daysRaw)
        ? Math.min(WAREHOUSE_SCAN_MISS_RETENTION_DAYS, Math.max(1, Math.floor(daysRaw)))
        : WAREHOUSE_SCAN_MISS_RETENTION_DAYS;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const take = Math.min(Number(searchParams.get("limit") || 200), 500);

      const rows = await prisma.warehouseScanMiss.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take,
        select: {
          id: true,
          rawCode: true,
          normalizedAwb: true,
          lookupCandidates: true,
          status: true,
          errorMessage: true,
          scanSessionKey: true,
          createdAt: true,
        },
      });

      return NextResponse.json({
        ok: true,
        days,
        retentionDays: WAREHOUSE_SCAN_MISS_RETENTION_DAYS,
        count: rows.length,
        items: rows,
      });
    }

    if (list !== "1") {
      return NextResponse.json(
        { error: "Missing list=1 or misses=1 parameter" },
        { status: 400 }
      );
    }

    const rows = await prisma.orderMatch.findMany({
      where: {
        stockxAwb: { not: null },
      },
      select: {
        stockxAwb: true,
        stockxTrackingUrl: true,
        shopifyOrderName: true,
        shopifyOrderId: true,
        shopifyCreatedAt: true,
      },
      orderBy: {
        
        shopifyCreatedAt: "desc",
      },
      take: limit,
    });

    type AwbRow = {
      stockxAwb: string | null;
      stockxTrackingUrl: string | null;
      shopifyOrderName: string;
      shopifyOrderId: string;
      shopifyCreatedAt: Date | null;
    };

    const items = (rows as AwbRow[])
      .filter((r: AwbRow) => r.stockxAwb)
      .map((r: AwbRow) => ({
        awb: r.stockxAwb as string,
        shopifyOrderName: r.shopifyOrderName,
        shopifyOrderId: r.shopifyOrderId,
        shopifyCreatedAt: r.shopifyCreatedAt,
        trackingUrl: r.stockxTrackingUrl || null,
      }));

    return NextResponse.json({ ok: true, count: items.length, items });
  } catch (error: any) {
    console.error("[SCAN-AWB] List error:", error);
    return NextResponse.json(
      { error: "Failed to fetch AWB list", details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  let rawCleanForLog = "";
  let scanSessionKeyForLog: string | null = null;
  const userAgent = req.headers.get("user-agent");

  try {
    const body = await req.json().catch(() => ({}));
    const rawCode = body?.code;
    const scanSessionKey = String(body?.scanSessionKey ?? "").trim() || null;
    scanSessionKeyForLog = scanSessionKey;
    const rawClean = String(rawCode ?? "").trim();
    rawCleanForLog = rawClean;
    // Include DHL JJD→10-digit AWB variants; StockX stores the short AWB, scanners often send JJD…
    const awbCandidates = awbLookupCandidates(rawClean);
    const awb = normalizeCode(rawClean) || awbCandidates[0] || "";
    const trackingUrlFilters = awbCandidates.map((candidate) => ({
      stockxTrackingUrl: { contains: candidate, mode: "insensitive" as const },
    }));
    const stockxOrderFilters = awbCandidates.map((candidate) => ({
      stockxOrderNumber: { contains: candidate, mode: "insensitive" as const },
    }));

    if (!awb) {
      if (rawClean) {
        void recordWarehouseScanMiss({
          rawCode: rawClean,
          normalizedAwb: null,
          lookupCandidates: awbCandidates,
          status: "UNMATCHED",
          errorMessage: "Missing code",
          scanSessionKey,
          userAgent,
        });
      }
      return NextResponse.json(
        { ok: false, status: "UNMATCHED", awb: "", match: null, error: { message: "Missing code" } },
        { status: 400 }
      );
    }

    const demoChannel = resolveScanDemoChannel(rawClean || awb);
    if (demoChannel) {
      return NextResponse.json(buildScanDemoScanPayload(demoChannel), { status: 200 });
    }

    let inboundHomeRoute = await findStockxInboundHomeRouteByCode(rawClean || awb);

    // Look for a match by AWB / StockX order # / tracking URL.
    // Also search warehouse shipments (Galaxus + Decathlon) so a scanned Swiss Post
    // AWB still tells us which order the parcel belongs to even when there is no
    // StockX match on the direct-delivery tables.
    // Also check StxPurchaseUnit so we can identify AWBs that are inbound StockX
    // parcels destined for a Galaxus warehouse pair — those must NOT trigger
    // Shopify auto-fulfill (would print a wrong customer label from a stale
    // OrderMatch row that shares the same AWB).
    const [
      match,
      decathlonMatch,
      galaxusMatch,
      galaxusWarehouseShipment,
      decathlonWarehouseShipment,
      stxInboundBuyUnit,
    ] = await Promise.all([
      prisma.orderMatch.findFirst({
        where: {
          AND: [
            {
              OR: [
                { stockxAwb: { in: awbCandidates } },
                ...trackingUrlFilters,
                ...stockxOrderFilters,
              ],
            },
            { shopifyCreatedAt: { gte: shopifyMatchMinCreatedAt() } },
          ],
        },
        select: {
          shopifyOrderId: true,
          shopifyOrderName: true,
          shopifyLineItemId: true,
          matchConfidence: true,
          matchScore: true,
          stockxAwb: true,
          stockxTrackingUrl: true,
          shopifyProductTitle: true,
          shopifySizeEU: true,
          shopifySku: true,
          shopifyTotalPrice: true,
          shopifyCreatedAt: true,
        },
      }),
      prisma.decathlonStockxMatch.findFirst({
        where: {
          OR: [
            { stockxAwb: { in: awbCandidates } },
            ...trackingUrlFilters,
            ...stockxOrderFilters,
          ],
        },
        select: {
          id: true,
          decathlonOrderId: true,
          decathlonOrderLineId: true,
          decathlonQuantity: true,
          line: {
            select: {
              id: true,
              orderLineId: true,
            },
          },
          order: {
            select: {
              id: true,
              orderId: true,
              orderNumber: true,
              orderState: true,
            },
          },
        },
      }),
      prisma.galaxusStockxMatch.findFirst({
        where: {
          OR: [
            { stockxAwb: { in: awbCandidates } },
            ...trackingUrlFilters,
            ...stockxOrderFilters,
          ],
        },
        select: {
          id: true,
          galaxusOrderId: true,
          order: {
            select: {
              id: true,
              galaxusOrderId: true,
              orderNumber: true,
              deliveryType: true,
              shipments: {
                select: {
                  id: true,
                  delrSentAt: true,
                  delrStatus: true,
                  trackingNumber: true,
                },
              },
            },
          },
        },
      }),
      prisma.shipment.findFirst({
        where: {
          trackingNumber: { in: awbCandidates },
        },
        select: {
          id: true,
          orderId: true,
          trackingNumber: true,
          status: true,
          deliveryType: true,
          packageType: true,
          shippedAt: true,
          delrStatus: true,
          delrSentAt: true,
          carrierFinal: true,
          carrierRaw: true,
          labelPdfUrl: true,
          order: {
            select: {
              id: true,
              galaxusOrderId: true,
              orderNumber: true,
              deliveryType: true,
              recipientName: true,
              recipientCity: true,
              recipientPostalCode: true,
              recipientCountryCode: true,
              shipments: {
                select: {
                  id: true,
                  delrSentAt: true,
                  delrStatus: true,
                  trackingNumber: true,
                },
              },
            },
          },
        },
      }),
      prisma.decathlonShipment.findFirst({
        where: {
          trackingNumber: { in: awbCandidates },
        },
        select: {
          id: true,
          orderId: true,
          trackingNumber: true,
          carrierRaw: true,
          carrierFinal: true,
          shippedAt: true,
          labelGeneratedAt: true,
          partnerKey: true,
          order: {
            select: {
              id: true,
              orderId: true,
              orderNumber: true,
              orderState: true,
            },
          },
        },
      }),
      prisma.stxPurchaseUnit.findFirst({
        where: {
          cancelledAt: null,
          OR: [
            { awb: { in: awbCandidates } },
            ...awbCandidates.map((candidate) => ({
              manualTrackingRaw: { contains: candidate, mode: "insensitive" as const },
            })),
          ],
        },
        select: {
          id: true,
          galaxusOrderId: true,
          gtin: true,
          supplierVariantId: true,
          stockxOrderNumber: true,
          awb: true,
          etaMin: true,
          etaMax: true,
        },
      }),
    ]);

    if (!inboundHomeRoute && match?.shopifyOrderName) {
      inboundHomeRoute = await findStockxInboundHomeRouteByShopifyOrderName(match.shopifyOrderName);
    }

    // If the scanned AWB belongs to a StockX buy that funds a still-open Galaxus
    // warehouse order, load the parent order so we can (a) tell the operator
    // where the incoming parcel is going and (b) suppress Shopify auto-fulfill
    // driven by any stale `OrderMatch` row that happens to share the same AWB.
    let stxInboundBuy: {
      unitId: string;
      galaxusOrderDbId: string | null;
      galaxusOrderId: string | null;
      galaxusOrderNumber: string | null;
      stockxOrderNumber: string | null;
      awb: string | null;
      deliveryType: string | null;
      isDirectDelivery: boolean;
      isWarehouse: boolean;
      orderCancelledAt: string | null;
    } | null = null;
    if (stxInboundBuyUnit) {
      const parent = await prisma.galaxusOrder.findFirst({
        where: { galaxusOrderId: stxInboundBuyUnit.galaxusOrderId },
        select: {
          id: true,
          galaxusOrderId: true,
          orderNumber: true,
          deliveryType: true,
          cancelledAt: true,
        },
      });
      const deliveryTypeRaw = String(parent?.deliveryType ?? "").toLowerCase();
      const isDirect = deliveryTypeRaw === "direct_delivery";
      stxInboundBuy = {
        unitId: stxInboundBuyUnit.id,
        galaxusOrderDbId: parent?.id ?? null,
        galaxusOrderId: parent?.galaxusOrderId ?? stxInboundBuyUnit.galaxusOrderId ?? null,
        galaxusOrderNumber: parent?.orderNumber ?? null,
        stockxOrderNumber: stxInboundBuyUnit.stockxOrderNumber ?? null,
        awb: stxInboundBuyUnit.awb ?? null,
        deliveryType: parent?.deliveryType ?? null,
        isDirectDelivery: isDirect,
        isWarehouse: !isDirect && Boolean(parent),
        orderCancelledAt: parent?.cancelledAt ? parent.cancelledAt.toISOString() : null,
      };
    }

    // Suppress the Shopify OrderMatch when the AWB is really an inbound StockX
    // parcel for a Galaxus buy. Otherwise a stale OrderMatch row sharing the AWB
    // would auto-fulfill the wrong Shopify order.
    let shouldSuppressShopifyMatch = Boolean(
      stxInboundBuy && !stxInboundBuy.orderCancelledAt
    );
    // Also drop fulfilled / too-old Shopify OrderMatches (AWB reuse / stale links).
    if (!shouldSuppressShopifyMatch && match?.shopifyOrderId) {
      if (!isShopifyOrderMatchFresh(match.shopifyCreatedAt)) {
        shouldSuppressShopifyMatch = true;
      } else {
        const [alreadyFulfilled, cancelled] = await Promise.all([
          prisma.shopifyFulfillmentRecord.findFirst({
            where: { shopifyOrderId: match.shopifyOrderId },
            select: { shopifyOrderId: true },
          }),
          prisma.shopifyOrder.findFirst({
            where: { shopifyOrderId: match.shopifyOrderId, cancelledAt: { not: null } },
            select: { shopifyOrderId: true },
          }),
        ]);
        if (alreadyFulfilled || cancelled) shouldSuppressShopifyMatch = true;
      }
    }
    const effectiveMatch = shouldSuppressShopifyMatch ? null : match;

    const hasShipmentMatch = Boolean(
      effectiveMatch ||
        decathlonMatch ||
        galaxusMatch ||
        inboundHomeRoute ||
        galaxusWarehouseShipment ||
        decathlonWarehouseShipment ||
        stxInboundBuy
    );

    // GTIN fallback: product barcode on the box (8–14 digit EAN/UPC/ITF14)
    // instead of shipping AWB. Parallel lookup across Galaxus + Shopify +
    // Decathlon — only runs on AWB miss so the hot path stays fast.
    const gtinCandidates = Array.from(
      new Set(
        awbCandidates.filter(
          (candidate) => /^\d{8,14}$/.test(candidate) && candidate.length >= 8
        )
      )
    );

    const gtinFallback =
      !hasShipmentMatch && gtinCandidates.length > 0
        ? await resolveGtinFallback(gtinCandidates)
        : null;

    const hasAnyMatch = hasShipmentMatch || Boolean(gtinFallback);
    const status: ScanStatus = hasAnyMatch ? "FOUND" : "NOT_FOUND";

    let shopifyMatchPayload: Record<string, unknown> | null = null;
    if (effectiveMatch) {
      const match = effectiveMatch;
      const base = {
        shopifyOrderId: match.shopifyOrderId,
        shopifyOrderName: match.shopifyOrderName,
        shopifyLineItemId: match.shopifyLineItemId,
        matchConfidence: match.matchConfidence,
        matchScore: match.matchScore ? Number(match.matchScore) : null,
        customer: {
          name: null as string | null,
          email: null as string | null,
          phone: null as string | null,
          shippingAddress: {
            address1: null as string | null,
            address2: null as string | null,
            zip: null as string | null,
            city: null as string | null,
            province: null as string | null,
            country: null as string | null,
          },
        },
        lineItem: {
          title: match.shopifyProductTitle,
          variantTitle: match.shopifySizeEU,
          sku: match.shopifySku,
          quantity: 1,
        },
        trackingUrl: match.stockxTrackingUrl || null,
      };

      const enriched = await enrichOrderMatchFromShopify(match);
      if (enriched) {
        shopifyMatchPayload = {
          ...base,
          customer: enriched.customer,
          lineItem: enriched.lineItem,
          shopifyOrder: enriched.shopifyOrder,
          shipToStore: enriched.shipToStore,
          isStorePickup: enriched.isStorePickup,
          pickupLabel: enriched.pickupLabel,
          pickupLocation: enriched.pickupLocation,
          labelShippingAddress: enriched.labelShippingAddress,
        };
      } else {
        shopifyMatchPayload = base;
      }
    }

    let galaxusPayload: Record<string, unknown> | null = null;
    if (galaxusMatch) {
      const galaxusOrder = galaxusMatch.order;
      const linkStatus = galaxusOrder?.id
        ? await getStxLinkStatusForOrder(galaxusOrder.id).catch(() => null)
        : null;
      const shipments = galaxusOrder?.shipments ?? [];
      const alreadyFulfilled = shipments.some(
        (s) => Boolean(s.delrSentAt) || String(s.delrStatus ?? "").toUpperCase() === "UPLOADED"
      );
      const deliveryType = String(galaxusOrder?.deliveryType ?? "").toLowerCase();
      galaxusPayload = {
        matchId: galaxusMatch.id,
        orderId: galaxusOrder?.galaxusOrderId ?? null,
        orderDbId: galaxusOrder?.id ?? galaxusMatch.galaxusOrderId ?? null,
        orderNumber: galaxusOrder?.orderNumber ?? null,
        deliveryType: galaxusOrder?.deliveryType ?? null,
        isDirectDelivery: deliveryType === "direct_delivery",
        allLinked: linkStatus?.allLinked ?? null,
        alreadyFulfilled,
        trackingNumber:
          shipments.find((s) => String(s.trackingNumber ?? "").trim())?.trackingNumber ?? null,
        source: "galaxus_stockx_match" as const,
      };
    } else if (galaxusWarehouseShipment) {
      // Fallback: no StockX match, but the AWB is stored on a Galaxus warehouse
      // Shipment. Return the parent order so the operator can locate the parcel.
      const galaxusOrder = galaxusWarehouseShipment.order;
      const linkStatus = galaxusOrder?.id
        ? await getStxLinkStatusForOrder(galaxusOrder.id).catch(() => null)
        : null;
      const shipments = galaxusOrder?.shipments ?? [];
      const alreadyFulfilled = shipments.some(
        (s) => Boolean(s.delrSentAt) || String(s.delrStatus ?? "").toUpperCase() === "UPLOADED"
      );
      const deliveryType = String(galaxusOrder?.deliveryType ?? "").toLowerCase();
      galaxusPayload = {
        matchId: null,
        orderId: galaxusOrder?.galaxusOrderId ?? null,
        orderDbId: galaxusOrder?.id ?? galaxusWarehouseShipment.orderId ?? null,
        orderNumber: galaxusOrder?.orderNumber ?? null,
        deliveryType: galaxusOrder?.deliveryType ?? null,
        isDirectDelivery: deliveryType === "direct_delivery",
        allLinked: linkStatus?.allLinked ?? null,
        alreadyFulfilled,
        trackingNumber: galaxusWarehouseShipment.trackingNumber ?? null,
        source: "galaxus_warehouse_shipment" as const,
        warehouseShipment: {
          shipmentId: galaxusWarehouseShipment.id,
          status: galaxusWarehouseShipment.status ?? null,
          packageType: galaxusWarehouseShipment.packageType ?? null,
          shipmentDeliveryType: galaxusWarehouseShipment.deliveryType ?? null,
          shippedAt: galaxusWarehouseShipment.shippedAt ?? null,
          delrStatus: galaxusWarehouseShipment.delrStatus ?? null,
          delrSentAt: galaxusWarehouseShipment.delrSentAt ?? null,
          carrierFinal: galaxusWarehouseShipment.carrierFinal ?? null,
          carrierRaw: galaxusWarehouseShipment.carrierRaw ?? null,
          labelPdfUrl: galaxusWarehouseShipment.labelPdfUrl ?? null,
          recipient: {
            name: galaxusOrder?.recipientName ?? null,
            city: galaxusOrder?.recipientCity ?? null,
            postalCode: galaxusOrder?.recipientPostalCode ?? null,
            countryCode: galaxusOrder?.recipientCountryCode ?? null,
          },
        },
      };
    }

    // Prefer DB-canonical AWB so fulfill-from-awb exact lookup matches (UPS scanners often
    // return spaced / prefixed 1Z payloads that still matched via loose candidates).
    const canonicalAwb =
      (typeof match?.stockxAwb === "string" && match.stockxAwb.trim()) ||
      (typeof inboundHomeRoute?.stockxAwb === "string" && inboundHomeRoute.stockxAwb.trim()) ||
      (typeof galaxusWarehouseShipment?.trackingNumber === "string" &&
        galaxusWarehouseShipment.trackingNumber.trim()) ||
      (typeof decathlonWarehouseShipment?.trackingNumber === "string" &&
        decathlonWarehouseShipment.trackingNumber.trim()) ||
      awb;

    const response = {
      ok: hasAnyMatch,
      status,
      awb: canonicalAwb,
      match: shopifyMatchPayload,
      decathlon: decathlonMatch
        ? {
            matchId: decathlonMatch.id,
            orderId: decathlonMatch.order?.orderId ?? null,
            orderDbId: decathlonMatch.order?.id ?? decathlonMatch.decathlonOrderId ?? null,
            orderNumber: decathlonMatch.order?.orderNumber ?? null,
            orderState: decathlonMatch.order?.orderState ?? null,
            lineId: decathlonMatch.line?.id ?? decathlonMatch.decathlonOrderLineId ?? null,
            miraklOrderLineId: decathlonMatch.line?.orderLineId ?? null,
            quantity: Number(decathlonMatch.decathlonQuantity ?? 0) || 0,
            source: "decathlon_stockx_match" as const,
          }
        : decathlonWarehouseShipment
          ? {
              matchId: null,
              orderId: decathlonWarehouseShipment.order?.orderId ?? null,
              orderDbId:
                decathlonWarehouseShipment.order?.id ??
                decathlonWarehouseShipment.orderId ??
                null,
              orderNumber: decathlonWarehouseShipment.order?.orderNumber ?? null,
              orderState: decathlonWarehouseShipment.order?.orderState ?? null,
              lineId: null,
              miraklOrderLineId: null,
              quantity: 0,
              source: "decathlon_warehouse_shipment" as const,
              warehouseShipment: {
                shipmentId: decathlonWarehouseShipment.id,
                trackingNumber: decathlonWarehouseShipment.trackingNumber ?? null,
                carrierRaw: decathlonWarehouseShipment.carrierRaw ?? null,
                carrierFinal: decathlonWarehouseShipment.carrierFinal ?? null,
                shippedAt: decathlonWarehouseShipment.shippedAt ?? null,
                labelGeneratedAt: decathlonWarehouseShipment.labelGeneratedAt ?? null,
                partnerKey: decathlonWarehouseShipment.partnerKey ?? null,
              },
            }
          : null,
      galaxus: galaxusPayload,
      inboundHome: inboundHomeRoute
        ? {
            routeId: inboundHomeRoute.id,
            stockxOrderNumber: inboundHomeRoute.stockxOrderNumber,
            stockxAwb: inboundHomeRoute.stockxAwb,
            stockxTrackingUrl: inboundHomeRoute.stockxTrackingUrl,
          }
        : null,
      gtin: gtinFallback,
      stxInboundBuy,
      shopifyMatchSuppressed: shouldSuppressShopifyMatch,
    };

    if (!hasAnyMatch) {
      void recordWarehouseScanMiss({
        rawCode: rawClean,
        normalizedAwb: awb,
        lookupCandidates: awbCandidates,
        status,
        scanSessionKey,
        userAgent,
      });
    }

    return NextResponse.json(response, { status: 200 });
  } catch (error: any) {
    console.error("[SCAN-AWB] Error:", error);
    if (rawCleanForLog) {
      void recordWarehouseScanMiss({
        rawCode: rawCleanForLog,
        status: "ERROR",
        errorMessage: error?.message || "Internal error",
        scanSessionKey: scanSessionKeyForLog,
        userAgent,
      });
    }
    return NextResponse.json(
      {
        ok: false,
        status: "ERROR",
        awb: "",
        match: null,
        error: { message: error.message || "Internal error" },
      },
      { status: 500 }
    );
  }
}

