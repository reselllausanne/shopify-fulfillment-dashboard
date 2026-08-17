// app/api/shopify/orders/route.ts
import { NextResponse } from "next/server";
import {
  shopifyGraphQL,
  extractEUSize,
  sleepForShopifyQueryCost,
  type ShopifyGraphQLResult,
} from "@/lib/shopifyAdmin";
import { formatInTimeZone } from "date-fns-tz";
import {
  lineFulfillableQuantity,
  shouldSkipOrderForFulfillmentMatching,
} from "@/app/lib/shopifyOrderFulfillmentFilters";
import { normalizeOrderRisk } from "@/app/lib/shopifyOrderRisk";
import {
  mergeLineItemCustomAttributes,
  parseShopifyLineItemDelivery,
} from "@/app/lib/shopifyLineItemDelivery";
import { parseShopifyOrderPickup } from "@/app/lib/shopifyOrderPickup";
import {
  buildPhysicalStockByGtinMap,
  resolvePhysicalStockForGtin,
} from "@/shopify/inventory/orderLinePhysicalStock";
import {
  buildPhysicalStockFromFulfillmentOrders,
  coalescePhysicalStock,
} from "@/shopify/inventory/fulfillmentAssignedPhysicalStock";
import { isPackageProtectionShopifyLine } from "@/app/utils/matching";
import { upsertPackageProtectionMatches } from "@/shopify/protection/upsertPackageProtectionMatches";

export const runtime = "nodejs";

const SHOP_TIMEZONE = "Europe/Zurich";
/** Paginate headers cheaply; line items fetched in separate low-cost batches. */
const SHOPIFY_ORDERS_PAGE_SIZE = 50;
const SHOPIFY_ORDERS_LINE_ITEMS_BATCH = 50;
/** Cap for matching UI load — paginated + cost-throttled (see sleepForShopifyQueryCost). */
const SHOPIFY_ORDERS_MAX_FIRST = 250;
const SHOPIFY_ORDER_HEADERS_ESTIMATED_COST = 140;
const SHOPIFY_ORDER_LINE_ITEMS_ESTIMATED_COST = 60;

type OrderHeadersGraphQL = {
  orders: {
    edges: { node: any }[];
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
  };
};

type OrderLineItemsGraphQL = {
  nodes: Array<{ id?: string; lineItems?: any } | null>;
};

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function fetchShopifyOrderEdges(
  orderQuery: string | null,
  totalWanted: number
): Promise<{ edges: { node: any }[]; errors?: any[] }> {
  const headerEdges: { node: any }[] = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (headerEdges.length < totalWanted && hasNextPage) {
    const pageSize = Math.min(SHOPIFY_ORDERS_PAGE_SIZE, totalWanted - headerEdges.length);
    const headersResponse: ShopifyGraphQLResult<OrderHeadersGraphQL> = await shopifyGraphQL<OrderHeadersGraphQL>(
      ORDER_HEADERS_QUERY,
      { first: pageSize, after, orderQuery },
      { estimatedQueryCost: SHOPIFY_ORDER_HEADERS_ESTIMATED_COST }
    );
    const { data, errors, extensions } = headersResponse;

    if (errors?.length) {
      return { edges: headerEdges, errors };
    }

    const pageEdges = data?.orders?.edges ?? [];
    headerEdges.push(...pageEdges);

    hasNextPage = Boolean(data?.orders?.pageInfo?.hasNextPage);
    after = data?.orders?.pageInfo?.endCursor ?? null;
    if (!hasNextPage || !after || pageEdges.length === 0) break;

    if (headerEdges.length < totalWanted) {
      await sleepForShopifyQueryCost(extensions);
    }
  }

  const trimmedHeaders = headerEdges.slice(0, totalWanted);
  const orderIds = trimmedHeaders.map((edge) => edge.node.id).filter(Boolean);
  const lineItemsByOrderId = new Map<string, any>();

  for (const idBatch of chunkArray(orderIds, SHOPIFY_ORDERS_LINE_ITEMS_BATCH)) {
    const lineItemsResponse: ShopifyGraphQLResult<OrderLineItemsGraphQL> =
      await shopifyGraphQL<OrderLineItemsGraphQL>(
        ORDER_LINE_ITEMS_BY_IDS_QUERY,
        { ids: idBatch },
        { estimatedQueryCost: SHOPIFY_ORDER_LINE_ITEMS_ESTIMATED_COST }
      );
    const { data, errors, extensions } = lineItemsResponse;

    if (errors?.length) {
      return { edges: trimmedHeaders, errors };
    }

    for (const node of data?.nodes ?? []) {
      if (node?.id) {
        lineItemsByOrderId.set(node.id, node.lineItems ?? { edges: [] });
      }
    }

    await sleepForShopifyQueryCost(extensions);
  }

  const edges = trimmedHeaders.map((edge) => ({
    node: {
      ...edge.node,
      lineItems: lineItemsByOrderId.get(edge.node.id) ?? { edges: [] },
    },
  }));

  return { edges };
}

type ShopifyLineItem = {
  shopifyOrderId: string;
  orderId: string;
  orderName: string;
  createdAt: string; // Zurich-local ISO string (preserves exact time, adjusted to shop timezone)
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  customerEmail: string | null;
  customerName: string | null;
  customerFirstName: string | null;
  customerLastName: string | null;
  shippingCountry: string | null;
  shippingCity: string | null;
  lineItemId: string;
  title: string;
  sku: string | null;
  variantTitle: string | null;
  sizeEU: string | null;
  lineItemImageUrl: string | null;
  quantity: number;
  price: string;      // unit price AFTER discounts
  totalPrice: string; // line total AFTER discounts
  currencyCode: string;
  fraudRiskLevel: string | null;
  fraudRecommendation: string | null;
  fraudSummaryLabel: string;
  deliveryMode: "express" | "standard" | null;
  deliveryModeLabel: string | null;
  deliveryEstimate: string | null;
  expressAvailable: boolean | null;
  expressPrice: string | null;
  variantExpressPrice: string | null;
  gtin: string | null;
  physicalStockQty: number | null;
  physicalStockLocation: string | null;
  isStorePickup: boolean;
  pickupLocation: string | null;
  pickupLabel: string | null;
};

/**
 * Convert UTC timestamp to shop timezone (Europe/Zurich)
 * Returns an ISO string that carries the +01:00/+02:00 offset so clients
 * can interpret it without applying additional offsets.
 */
function convertToShopTimezone(utcTimestamp: string): string {
  const utcDate = new Date(utcTimestamp);
  return formatInTimeZone(utcDate, SHOP_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/** When no custom `orderQuery`, narrow to open fulfillment + not cancelled + date window. */
function buildDefaultOrdersSearchQuery(sinceDays: number): string | null {
  if (!Number.isFinite(sinceDays) || sinceDays <= 0) return null;
  const capped = Math.min(365, Math.floor(sinceDays));
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - capped);
  const ymd = d.toISOString().slice(0, 10);
  return `(fulfillment_status:unfulfilled OR fulfillment_status:partial) -status:cancelled created:>=${ymd}`;
}

/**
 * Calculate proportional line item pricing from order total
 * Ensures line items sum to exact order total (accounting for discounts)
 */
function calculateLineItemPricing(
  orderTotalAmount: number,
  lineItemCount: number,
  lineDiscountedAmount: number,
  lineItemTotalSum: number,
  quantity: number
): { unitPrice: string; totalPrice: string } {
  let realLineTotal: number;
  
  if (lineItemCount === 1) {
    // Single item: use full order total
    realLineTotal = orderTotalAmount;
  } else {
    // Multiple items: proportional allocation
    const proportion = lineItemTotalSum > 0 ? lineDiscountedAmount / lineItemTotalSum : 0;
    realLineTotal = orderTotalAmount * proportion;
  }
  
  const totalPrice = realLineTotal.toFixed(2);
  const unitPrice = quantity > 0 ? (realLineTotal / quantity).toFixed(2) : totalPrice;
  
  return { unitPrice, totalPrice };
}

const ORDER_HEADERS_QUERY = /* GraphQL */ `
query OrderHeaders($first: Int!, $after: String, $orderQuery: String) {
  orders(first: $first, after: $after, query: $orderQuery, sortKey: CREATED_AT, reverse: true) {
    pageInfo {
      hasNextPage
      endCursor
    }
    edges {
      node {
        id
        name
        createdAt
        cancelledAt
        displayFinancialStatus
        displayFulfillmentStatus
        email
        customer {
          displayName
          firstName
          lastName
          defaultEmailAddress { emailAddress }
        }
        shippingAddress { country city }

        shippingLines(first: 5) {
          edges {
            node {
              title
              isRemoved
            }
          }
        }

        fulfillmentOrders(first: 5) {
          nodes {
            status
            deliveryMethod {
              methodType
              presentedName
            }
            assignedLocation {
              name
              location { id name }
            }
            lineItems(first: 50) {
              nodes {
                remainingQuantity
                totalQuantity
                lineItem { id }
              }
            }
          }
        }

        currentSubtotalPriceSet {
          shopMoney { amount currencyCode }
        }
        currentTotalDiscountsSet {
          shopMoney { amount currencyCode }
        }
        currentTotalPriceSet {
          shopMoney { amount currencyCode }
        }

        risk {
          recommendation
          assessments {
            riskLevel
          }
        }
      }
    }
  }
}
`;

const ORDER_LINE_ITEMS_BY_IDS_QUERY = /* GraphQL */ `
query OrderLineItemsByIds($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Order {
      id
      lineItems(first: 20) {
        edges {
          node {
            id
            name
            title
            sku
            quantity
            fulfillableQuantity
            variantTitle
            customAttributes {
              key
              value
            }
            lineItemGroup {
              customAttributes {
                key
                value
              }
            }
            variant {
              barcode
              expressAvailable: metafield(namespace: "custom", key: "express_available") {
                value
              }
              expressPrice: metafield(namespace: "custom", key: "express_price") {
                value
              }
              product {
                featuredMedia {
                  __typename
                  ... on MediaImage {
                    image { url }
                  }
                }
              }
            }
            discountedTotalSet {
              shopMoney { amount currencyCode }
            }
          }
        }
      }
    }
  }
}
`;

const ORDERS_WITH_EXCHANGE_QUERY = /* GraphQL */ `
query OrdersWithExchangeLineItems($first: Int!, $orderQuery: String) {
  orders(first: $first, query: $orderQuery, sortKey: CREATED_AT, reverse: true) {
    edges {
      node {
        id
        name
        agreements(first: 10) {
          edges {
            node {
              __typename
              ... on ReturnAgreement {
                id
                happenedAt
                return {
                  id
                  name
                  exchangeLineItems(first: 10) {
                    edges {
                      node {
                        id
                        quantity
                        processableQuantity
                        processedQuantity
                        unprocessedQuantity
                        lineItems {
                          id
                          name
                          sku
                          quantity
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
`;

const ORDER_EXCHANGE_QUERY = /* GraphQL */ `
query OrderExchangeLineItems($orderId: ID!) {
  order(id: $orderId) {
    id
    name
    agreements(first: 20) {
      edges {
        node {
          __typename
          ... on ReturnAgreement {
            id
            happenedAt
            return {
              id
              name
              exchangeLineItems(first: 20) {
                edges {
                  node {
                    id
                    quantity
                    processableQuantity
                    processedQuantity
                    unprocessedQuantity
                    lineItems {
                      id
                      name
                      sku
                      quantity
                      originalUnitPriceSet {
                        shopMoney { amount currencyCode }
                      }
                      originalTotalSet {
                        shopMoney { amount currencyCode }
                      }
                      discountedTotalSet {
                        shopMoney { amount currencyCode }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
`;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const requestedFirst = Number(body?.first) > 0 ? Number(body.first) : SHOPIFY_ORDERS_MAX_FIRST;
    const first = Math.min(SHOPIFY_ORDERS_MAX_FIRST, requestedFirst);
    const customOrderQuery = typeof body?.orderQuery === "string" && body.orderQuery.trim() ? String(body.orderQuery).trim() : null;
    const sinceDaysRaw = Number(body?.sinceDays);
    const orderQuery =
      customOrderQuery ||
      (Number.isFinite(sinceDaysRaw) && sinceDaysRaw > 0 ? buildDefaultOrdersSearchQuery(sinceDaysRaw) : null);
    const includeReturns = Boolean(body?.includeExchanges);
    const includePhysicalStock = Boolean(body?.physicalStock);

    console.log(`[SHOPIFY] Fetching last ${first} orders...`, {
      orderQuery: orderQuery ?? "(none)",
      includePhysicalStock,
    });

    if (body?.orderExchange) {
      const orderId = body.orderId || "12560147906946";
      const { data, errors } = await shopifyGraphQL<{ order: any }>(ORDER_EXCHANGE_QUERY, {
        orderId,
      });

      if (errors?.length) {
        console.error("[SHOPIFY] Order exchange GraphQL errors:", errors);
        return NextResponse.json(
          { error: "Shopify exchange GraphQL errors", details: errors },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true, order: data.order });
    }

    if (includeReturns) {
      const { data, errors } = await shopifyGraphQL<{
        orders: { edges: { node: any }[] };
      }>(ORDERS_WITH_EXCHANGE_QUERY, { first, orderQuery });
      if (errors?.length) {
        console.error("[SHOPIFY] GraphQL errors:", errors);
        return NextResponse.json(
          { error: "Shopify GraphQL errors", details: errors },
          { status: 500 }
        );
      }
      return NextResponse.json({
        success: true,
        orders: data?.orders?.edges ?? [],
      });
    }

    const fetched = await fetchShopifyOrderEdges(orderQuery, first);
    if (fetched.errors?.length) {
      console.error("[SHOPIFY] GraphQL errors:", fetched.errors);
      return NextResponse.json(
        { error: "Shopify GraphQL errors", details: fetched.errors },
        { status: 500 }
      );
    }

    const edges = fetched.edges;
    const lineGtinsForStock: string[] = [];
    if (includePhysicalStock) {
      for (const e of edges) {
        const o = e.node;
        if (shouldSkipOrderForFulfillmentMatching(o)) continue;
        for (const liE of o.lineItems?.edges ?? []) {
          const li = liE?.node;
          if (lineFulfillableQuantity(li) <= 0) continue;
          const barcode = String(li?.variant?.barcode ?? "").trim();
          if (barcode) lineGtinsForStock.push(barcode);
        }
      }
    }
    const physicalStockByGtin = includePhysicalStock
      ? await buildPhysicalStockByGtinMap(lineGtinsForStock)
      : new Map();

    const lineItems: ShopifyLineItem[] = [];
    const seenLineItemIds = new Set<string>();
    const protectionToPersist: Parameters<typeof upsertPackageProtectionMatches>[0] = [];

    for (const e of edges) {
      const o = e.node;

      if (shouldSkipOrderForFulfillmentMatching(o)) {
        continue;
      }

      // Extract order-level data
      const orderId = o.id;
      const orderName = o.name;
      const createdAt = convertToShopTimezone(o.createdAt);
      const displayFinancialStatus = o.displayFinancialStatus ?? null;
      const displayFulfillmentStatus = o.displayFulfillmentStatus ?? null;
      const customerName = o.customer?.displayName ?? null;
      const customerFirstName = o.customer?.firstName ?? null;
      const customerLastName = o.customer?.lastName ?? null;
      const customerEmail =
        o.customer?.defaultEmailAddress?.emailAddress ?? o.email ?? null;
      const shippingCountry = o.shippingAddress?.country ?? null;
      const shippingCity = o.shippingAddress?.city ?? null;

      // Extract order total (what customer actually pays)
      const orderTotal = o.currentTotalPriceSet?.shopMoney;
      const orderTotalAmount = orderTotal?.amount ? parseFloat(orderTotal.amount) : 0;
      const orderCurrency = orderTotal?.currencyCode || "CHF";

      const riskNorm = normalizeOrderRisk(o.risk);

      const orderShippingLines = (o.shippingLines?.edges ?? [])
        .map((edge: any) => edge?.node)
        .filter(Boolean)
        .map((node: any) => ({
          title: node.title ?? null,
          isRemoved: Boolean(node.isRemoved),
        }));
      const foNodes = o.fulfillmentOrders?.nodes ?? [];
      const orderFulfillmentOrders = foNodes.map((node: any) => ({
        deliveryMethod: node.deliveryMethod ?? null,
        assignedLocation: node.assignedLocation ?? null,
      }));
      const pickupInfo = parseShopifyOrderPickup({
        shippingLines: orderShippingLines,
        fulfillmentOrders: orderFulfillmentOrders,
      });
      // Per lineItemId only — never stamp first physical FO on whole order.
      const foPhysicalByLine = includePhysicalStock
        ? buildPhysicalStockFromFulfillmentOrders(foNodes)
        : new Map();

      const liEdgesAll = o.lineItems?.edges ?? [];
      const liEdges = liEdgesAll.filter((liE: any) => lineFulfillableQuantity(liE?.node) > 0);
      const lineItemCount = liEdges.length;
      if (lineItemCount === 0) {
        continue;
      }

      // Calculate line item sum for proportional allocation (multi-item orders only)
      let lineItemTotalSum = 0;
      if (lineItemCount > 1) {
        for (const liE of liEdges) {
          const liTotal = liE.node.discountedTotalSet?.shopMoney?.amount;
          lineItemTotalSum += liTotal ? parseFloat(liTotal) : 0;
        }
      }

      // Process each line item (only rows still fulfillable — refunds/exchanges often go to 0)
      for (const liE of liEdges) {
        const li = liE.node;
        const qty = lineFulfillableQuantity(li);
        if (li?.id) {
          seenLineItemIds.add(li.id);
        }
        const lineDiscountedAmount = li.discountedTotalSet?.shopMoney?.amount 
          ? parseFloat(li.discountedTotalSet.shopMoney.amount) 
          : 0;

        // Calculate pricing (proportional allocation for multi-item orders)
        const { unitPrice, totalPrice } = calculateLineItemPricing(
          orderTotalAmount,
          lineItemCount,
          lineDiscountedAmount,
          lineItemTotalSum,
          qty
        );

        // Extract product info
        const variantTitle = li.variantTitle ?? null;
        const productName = li.name ?? li.title ?? "Unknown Product";
        const sizeEU = extractEUSize(variantTitle) ?? extractEUSize(productName) ?? null;
        let lineItemImageUrl = null;
        if (li?.variant?.product?.featuredMedia?.__typename === "MediaImage") {
          lineItemImageUrl = li?.variant?.product?.featuredMedia?.image?.url ?? null;
        }

        const deliveryInfo = parseShopifyLineItemDelivery({
          customAttributes: mergeLineItemCustomAttributes(
            li.customAttributes ?? [],
            li.lineItemGroup?.customAttributes ?? []
          ),
          expressAvailableMetafield: li?.variant?.expressAvailable?.value ?? null,
          expressPriceMetafield: li?.variant?.expressPrice?.value ?? null,
        });

        const gtin = String(li?.variant?.barcode ?? "").trim() || null;
        const mirrorPhysical =
          includePhysicalStock && gtin ? resolvePhysicalStockForGtin(gtin, physicalStockByGtin) : null;
        const foPhysical =
          includePhysicalStock && li?.id ? foPhysicalByLine.get(li.id) ?? null : null;
        const physicalStock = coalescePhysicalStock(mirrorPhysical, foPhysical);

        const row = {
          shopifyOrderId: orderId,
          orderId,
          orderName,
          createdAt,
          displayFinancialStatus,
          displayFulfillmentStatus,
          customerEmail,
          customerName,
          customerFirstName,
          customerLastName,
          shippingCountry,
          shippingCity,
          lineItemId: li.id,
          title: productName,
          sku: li.sku ?? null,
          variantTitle,
          sizeEU,
          lineItemImageUrl,
          quantity: qty,
          price: unitPrice,
          totalPrice,
          currencyCode: orderCurrency,
          fraudRiskLevel: riskNorm.fraudRiskLevel,
          fraudRecommendation: riskNorm.fraudRecommendation,
          fraudSummaryLabel: riskNorm.fraudSummaryLabel,
          deliveryMode: deliveryInfo.deliveryMode,
          deliveryModeLabel: deliveryInfo.deliveryModeLabel,
          deliveryEstimate: deliveryInfo.deliveryEstimate,
          expressAvailable: deliveryInfo.expressAvailable,
          expressPrice: deliveryInfo.expressPrice,
          variantExpressPrice: deliveryInfo.variantExpressPrice,
          gtin,
          physicalStockQty: physicalStock?.qty ?? null,
          physicalStockLocation: physicalStock?.locationName ?? null,
          isStorePickup: pickupInfo.isStorePickup,
          pickupLocation: pickupInfo.locationName,
          pickupLabel: pickupInfo.label,
        };

        // Persist for margin; never surface on matching UI.
        if (isPackageProtectionShopifyLine(productName, li.sku ?? null)) {
          protectionToPersist.push({
            shopifyOrderId: orderId,
            shopifyOrderName: orderName,
            shopifyLineItemId: li.id,
            shopifyProductTitle: productName,
            shopifySku: li.sku ?? null,
            shopifyTotalPrice: Number(totalPrice) || Number(lineDiscountedAmount) || 0,
            shopifyCurrencyCode: orderCurrency,
            shopifyCreatedAt: createdAt,
            shopifyCustomerEmail: customerEmail,
            shopifyCustomerFirstName: customerFirstName,
            shopifyCustomerLastName: customerLastName,
          });
          continue;
        }

        lineItems.push(row);
      }

    }

    if (protectionToPersist.length > 0) {
      await upsertPackageProtectionMatches(protectionToPersist).catch((err) => {
        console.warn("[SHOPIFY] package protection upsert failed", err);
      });
    }

    console.log(
      `[SHOPIFY] Fetched ${lineItems.length} line items from ${edges.length} orders`
    );
    
    return NextResponse.json({ 
      lineItems,
      metadata: {
        totalOrders: edges.length,
        lineItemsCount: lineItems.length,
      }
    });
  } catch (err: any) {
    console.error("[/api/shopify/orders] error:", err);
    return NextResponse.json(
      { error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}