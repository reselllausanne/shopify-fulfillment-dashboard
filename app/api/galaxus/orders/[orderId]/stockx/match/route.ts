import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { DEFAULT_QUERY, DEFAULT_VARIABLES } from "@/app/lib/constants";
import {
  matchShopifyToSupplier,
  type NormalizedSupplierOrder,
  type ShopifyLineItem,
} from "@/app/utils/matching";
import { extractAwbFromTrackingUrl } from "@/app/utils/format";
import {
  galaxusLineWarehouseStockHint,
  isGalaxusStxSupplierLine,
} from "@/galaxus/warehouse/lineInventorySource";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STOCKX_ENDPOINT = "https://stockx.com/api/graphql";
const STOCKX_HEADERS = {
  "content-type": "application/json",
  origin: "https://stockx.com",
  referer: "https://stockx.com/buying/orders",
  "apollographql-client-name": "Iron",
  "apollographql-client-version": "2026.01.11.01",
  "app-platform": "Iron",
  "app-version": "2026.01.11.01",
  "user-agent": "Mozilla/5.0 (compatible; ResellLausanneBot/1.0; +https://resell-lausanne.ch)",
};

const GET_BUY_ORDER_TRACKING_QUERY = `
  query GET_BUY_ORDER(
    $chainId: String
    $orderId: String
    $country: String
    $market: String
    $isShipByDateEnabled: Boolean!
    $isDFSUpdatesEnabled: Boolean!
  ) {
    viewer {
      order(chainId: $chainId, orderId: $orderId) {
        ... on BuyOrder {
          status
          currentStatus { key }
          checkoutType
          states {
            title
            subtitle
            status
            progress
            meta
            sourceType
          }
          estimatedDeliveryDateRange {
            estimatedDeliveryDate
            latestEstimatedDeliveryDate
          }
          shipping {
            shipment {
              trackingUrl
            }
          }
        }
      }
    }
  }
`;

async function stockxRequest(params: {
  token: string;
  operationName: string;
  query: string;
  variables: Record<string, any>;
}) {
  const res = await fetch(STOCKX_ENDPOINT, {
    method: "POST",
    headers: {
      ...STOCKX_HEADERS,
      authorization: `Bearer ${params.token}`,
    },
    body: JSON.stringify({
      operationName: params.operationName,
      query: params.query,
      variables: params.variables,
    }),
  });
  const raw = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data, raw };
}

async function fetchStockxBuyingOrders(token: string, maxPages = 6) {
  const out: any[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const variables = {
      ...DEFAULT_VARIABLES,
      after: cursor,
    };
    const res = await stockxRequest({
      token,
      operationName: "Buying",
      query: DEFAULT_QUERY,
      variables,
    });
    if (!res.ok || res.data?.errors?.length) {
      throw new Error(`StockX buying query failed (${res.status})`);
    }
    const edges = res.data?.data?.viewer?.buying?.edges ?? [];
    const nodes = edges.map((edge: any) => edge?.node).filter(Boolean);
    out.push(...nodes);
    const pageInfo = res.data?.data?.viewer?.buying?.pageInfo ?? null;
    if (!pageInfo?.hasNextPage || !pageInfo?.endCursor) break;
    cursor = pageInfo.endCursor;
  }
  return out;
}

function normalizeStockxOrder(node: any): NormalizedSupplierOrder {
  const product = node?.productVariant?.product ?? {};
  const variant = node?.productVariant ?? {};
  const size =
    node?.localizedSizeTitle ??
    variant?.traits?.size ??
    variant?.sizeChart?.baseSize ??
    null;
  return {
    supplierOrderNumber: node?.orderNumber ?? "",
    chainId: node?.chainId ?? "",
    orderId: node?.orderId ?? "",
    purchaseDate: node?.purchaseDate ?? node?.creationDate ?? "",
    offerAmount: node?.amount ?? null,
    totalTTC: null,
    productTitle: product?.title ?? product?.name ?? "Item",
    productName: product?.name ?? product?.title ?? null,
    skuKey: product?.styleId ?? product?.model ?? "",
    sizeEU: size,
    statusKey: node?.state?.statusKey ?? null,
    statusTitle: node?.state?.statusTitle ?? null,
    currencyCode: node?.currencyCode ?? null,
    estimatedDeliveryDate: node?.estimatedDeliveryDateRange?.estimatedDeliveryDate ?? null,
    latestEstimatedDeliveryDate: node?.estimatedDeliveryDateRange?.latestEstimatedDeliveryDate ?? null,
    productVariantId: variant?.id ?? null,
  };
}

function buildLineItem(order: any, line: any): ShopifyLineItem {
  const orderDate =
    typeof order.orderDate === "string"
      ? order.orderDate
      : order.orderDate
      ? new Date(order.orderDate).toISOString()
      : new Date().toISOString();
  return {
    shopifyOrderId: order.id,
    orderName: order.orderNumber ?? order.galaxusOrderId,
    createdAt: orderDate,
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: null,
    customerEmail: order.customerEmail ?? null,
    customerName: order.customerName ?? null,
    customerFirstName: null,
    customerLastName: null,
    shippingCountry: order.customerCountry ?? null,
    shippingCity: order.customerCity ?? null,
    lineItemId: line.id,
    title: line.productName ?? "Item",
    sku: line.supplierSku ?? line.supplierVariantId ?? line.providerKey ?? null,
    variantTitle: line.size ?? null,
    quantity: Number(line.quantity ?? 0),
    price: String(line.unitNetPrice ?? "0"),
    totalPrice: String(line.lineNetAmount ?? "0"),
    currencyCode: order.currencyCode ?? "CHF",
    sizeEU: line.size ?? null,
    lineItemImageUrl: null,
  };
}

function parseDateMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function computeTimeDiffHours(orderDate: string, purchaseDate: string): number | null {
  const orderMs = parseDateMs(orderDate);
  const purchaseMs = parseDateMs(purchaseDate);
  if (orderMs == null || purchaseMs == null) return null;
  return Math.abs((purchaseMs - orderMs) / (1000 * 60 * 60));
}

async function fetchTrackingDetails(token: string, chainId: string, orderId: string) {
  const res = await stockxRequest({
    token,
    operationName: "GET_BUY_ORDER",
    query: GET_BUY_ORDER_TRACKING_QUERY,
    variables: {
      chainId,
      orderId,
      country: "CH",
      market: "CH",
      isShipByDateEnabled: true,
      isDFSUpdatesEnabled: true,
    },
  });
  if (!res.ok || res.data?.errors?.length) {
    return null;
  }
  const order = res.data?.data?.viewer?.order ?? null;
  if (!order) return null;
  const trackingUrl = order?.shipping?.shipment?.trackingUrl ?? null;
  return {
    trackingUrl,
    awb: extractAwbFromTrackingUrl(trackingUrl),
    stockxStatus: order?.currentStatus?.key ?? order?.status ?? null,
    checkoutType: order?.checkoutType ?? null,
    states: order?.states ?? null,
    estimatedDelivery: order?.estimatedDeliveryDateRange?.estimatedDeliveryDate ?? null,
    latestEstimatedDelivery: order?.estimatedDeliveryDateRange?.latestEstimatedDeliveryDate ?? null,
  };
}

async function resolveOrderId(orderIdOrRef: string) {
  const byId = await prisma.galaxusOrder.findUnique({
    where: { id: orderIdOrRef },
    include: { lines: true },
  });
  if (byId) return byId;
  return prisma.galaxusOrder.findUnique({
    where: { galaxusOrderId: orderIdOrRef },
    include: { lines: true },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const body = await request.json().catch(() => ({}));
    const token = String(body?.token ?? "").trim();
    if (!token) {
      return NextResponse.json({ ok: false, error: "StockX token is required" }, { status: 400 });
    }

    const order = await resolveOrderId(orderId);
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    const stockxOrdersRaw = await fetchStockxBuyingOrders(token);
    const normalizedOrders = stockxOrdersRaw.map(normalizeStockxOrder);

    const existingMatches = await (prisma as any).galaxusStockxMatch.findMany({
      select: { stockxOrderNumber: true },
    });
    const usedSupplierNumbers = new Set<string>(
      existingMatches
        .map((m: any) => String(m.stockxOrderNumber ?? "").trim())
        .filter((v: string) => Boolean(v))
    );
    const availableSupplier = normalizedOrders.filter(
      (order) => !usedSupplierNumbers.has(order.supplierOrderNumber)
    );

    const results: any[] = [];

    for (const line of order.lines) {
      const qty = Math.max(Number(line.quantity ?? 1), 1);
      const whSkip = galaxusLineWarehouseStockHint(line);
      if (whSkip && isGalaxusStxSupplierLine(line)) {
        for (let unitIndex = 0; unitIndex < qty; unitIndex++) {
          results.push({
            lineId: line.id,
            unitIndex,
            status: "skipped",
            reason: whSkip === "MAISON" ? "supplier_sku_THE_" : "supplier_sku_NER_",
          });
        }
        continue;
      }
      for (let unitIndex = 0; unitIndex < qty; unitIndex++) {
        const supplierVariantId = String(line?.supplierVariantId ?? "").trim();
        const variantId = supplierVariantId.startsWith("stx_")
          ? supplierVariantId.replace(/^stx_/, "")
          : null;
        const candidates = variantId
          ? availableSupplier.filter(
              (s) =>
                s.productVariantId === variantId &&
                !usedSupplierNumbers.has(s.supplierOrderNumber)
            )
          : [];

        let match = null as any;
        if (candidates.length > 0) {
          const orderDate =
            typeof order.orderDate === "string"
              ? order.orderDate
              : order.orderDate
              ? new Date(order.orderDate).toISOString()
              : new Date().toISOString();
          const scored = candidates
            .map((c) => ({
              order: c,
              timeDiff: computeTimeDiffHours(orderDate, c.purchaseDate),
            }))
            .filter((c) => c.timeDiff != null)
            .sort((a, b) => (a.timeDiff ?? 0) - (b.timeDiff ?? 0));
          if (scored.length > 0) {
            match = {
              supplierOrder: scored[0].order,
              score: 999,
              confidence: "high",
              reasons: ["VARIANT_ID"],
              timeDiffHours: scored[0].timeDiff ?? null,
            };
          }
        }

        if (!match) {
          const item = buildLineItem(order, line);
          const result = matchShopifyToSupplier(item, availableSupplier, usedSupplierNumbers);
          match = result.bestMatch;
        }

        if (!match?.supplierOrder?.supplierOrderNumber) {
          results.push({ lineId: line.id, unitIndex, status: "unmatched" });
          continue;
        }

        usedSupplierNumbers.add(match.supplierOrder.supplierOrderNumber);

        const tracking =
          match.supplierOrder.chainId && match.supplierOrder.orderId
            ? await fetchTrackingDetails(token, match.supplierOrder.chainId, match.supplierOrder.orderId)
            : null;

        const matchReasons = Array.isArray(match.reasons) ? match.reasons : [];
        const matchType = matchReasons.includes("VARIANT_ID") ? "VARIANT_ID" : "NAME_SIZE_TIME";

        const payload = {
          galaxusOrderId: order.id,
          galaxusOrderRef: order.galaxusOrderId ?? null,
          galaxusOrderDate: order.orderDate ? new Date(order.orderDate) : null,
          galaxusOrderLineId: line.id,
          unitIndex,
          galaxusLineNumber: line.lineNumber ?? null,
          galaxusProductName: line.productName ?? "Item",
          galaxusDescription: line.description ?? null,
          galaxusSize: line.size ?? null,
          galaxusGtin: line.gtin ?? null,
          galaxusProviderKey: line.providerKey ?? null,
          galaxusSupplierSku: line.supplierSku ?? null,
          galaxusQuantity: qty,
          galaxusUnitNetPrice: line.unitNetPrice,
          galaxusLineNetAmount: line.lineNetAmount,
          galaxusVatRate: line.vatRate,
          galaxusCurrencyCode: order.currencyCode ?? "CHF",
          stockxChainId: match.supplierOrder.chainId || null,
          stockxOrderId: match.supplierOrder.orderId || null,
          stockxOrderNumber: match.supplierOrder.supplierOrderNumber,
          stockxVariantId: match.supplierOrder.productVariantId || null,
          stockxProductName: match.supplierOrder.productTitle || null,
          stockxSkuKey: match.supplierOrder.skuKey || null,
          stockxSizeEU: match.supplierOrder.sizeEU || null,
          stockxPurchaseDate: match.supplierOrder.purchaseDate
            ? new Date(match.supplierOrder.purchaseDate)
            : null,
          stockxAmount: match.supplierOrder.offerAmount ?? null,
          stockxCurrencyCode: match.supplierOrder.currencyCode ?? null,
          stockxStatus: tracking?.stockxStatus ?? match.supplierOrder.statusKey ?? null,
          stockxEstimatedDelivery: tracking?.estimatedDelivery
            ? new Date(tracking.estimatedDelivery)
            : null,
          stockxLatestEstimatedDelivery: tracking?.latestEstimatedDelivery
            ? new Date(tracking.latestEstimatedDelivery)
            : null,
          stockxAwb: tracking?.awb ?? null,
          stockxTrackingUrl: tracking?.trackingUrl ?? null,
          stockxCheckoutType: tracking?.checkoutType ?? match.supplierOrder.stockxCheckoutType ?? null,
          stockxStates: tracking?.states ?? match.supplierOrder.stockxStates ?? null,
          matchConfidence: match.confidence ?? null,
          matchScore: match.score ?? null,
          matchType,
          matchReasons: JSON.stringify(matchReasons),
          timeDiffHours: match.timeDiffHours ?? null,
        };

        const saved = await (prisma as any).galaxusStockxMatch.upsert({
          where: { galaxusOrderLineId_unitIndex: { galaxusOrderLineId: line.id, unitIndex } },
          update: {
            ...payload,
            updatedAt: new Date(),
          },
          create: payload,
        });

        results.push({
          lineId: line.id,
          unitIndex,
          status: "matched",
          stockxOrderNumber: saved.stockxOrderNumber,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      galaxusOrderId: order.galaxusOrderId,
      matched: results.filter((r) => r.status === "matched").length,
      unmatched: results.filter((r) => r.status !== "matched").length,
      results,
    });
  } catch (error: any) {
    console.error("[GALAXUS][STX][MATCH] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Match failed" }, { status: 500 });
  }
}
