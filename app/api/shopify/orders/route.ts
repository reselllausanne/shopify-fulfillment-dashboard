// app/api/shopify/orders/route.ts
import { NextResponse } from "next/server";
import { shopifyGraphQL, extractEUSize } from "@/lib/shopifyAdmin";
import { formatInTimeZone } from "date-fns-tz";

export const runtime = "nodejs";

const SHOP_TIMEZONE = "Europe/Zurich";

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

const ORDERS_QUERY = /* GraphQL */ `
query LastOrders($first: Int!, $orderQuery: String) {
  orders(first: $first, query: $orderQuery, sortKey: CREATED_AT, reverse: true) {
    edges {
      node {
        id
        name
        createdAt
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

        currentSubtotalPriceSet {
          shopMoney { amount currencyCode }
        }
        currentTotalDiscountsSet {
          shopMoney { amount currencyCode }
        }
        currentTotalPriceSet {
          shopMoney { amount currencyCode }
        }

        lineItems(first: 50) {
          edges {
            node {
              id
              name
              title
              sku
              quantity
              variantTitle
              variant {
                media(first: 1) {
                  nodes {
                    __typename
                    ... on MediaImage {
                      image { url }
                    }
                  }
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
    const requestedFirst = Number(body?.first) > 0 ? Number(body.first) : 100;
    const first = Math.min(100, requestedFirst);
    const orderQuery = typeof body?.orderQuery === "string" ? body.orderQuery : null;
    const includeReturns = Boolean(body?.includeExchanges);

    console.log(`[SHOPIFY] Fetching last ${first} orders...`);

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

    const graphQuery = includeReturns ? ORDERS_WITH_EXCHANGE_QUERY : ORDERS_QUERY;
    const { data, errors } = await shopifyGraphQL<{
      orders: { edges: { node: any }[] };
    }>(graphQuery, { first, orderQuery });

    if (errors?.length) {
      console.error("[SHOPIFY] GraphQL errors:", errors);
      return NextResponse.json(
        { error: "Shopify GraphQL errors", details: errors },
        { status: 500 }
      );
    }

    if (includeReturns) {
      return NextResponse.json({
        success: true,
        orders: data?.orders?.edges ?? [],
      });
    }

    const edges = data?.orders?.edges ?? [];
    const lineItems: ShopifyLineItem[] = [];
    const seenLineItemIds = new Set<string>();

    for (const e of edges) {
      const o = e.node;
      
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

      const liEdges = o.lineItems?.edges ?? [];
      const lineItemCount = liEdges.length;

      // Calculate line item sum for proportional allocation (multi-item orders only)
      let lineItemTotalSum = 0;
      if (lineItemCount > 1) {
        for (const liE of liEdges) {
          const liTotal = liE.node.discountedTotalSet?.shopMoney?.amount;
          lineItemTotalSum += liTotal ? parseFloat(liTotal) : 0;
        }
      }

      // Process each line item
      for (const liE of liEdges) {
        const li = liE.node;
        if (li?.id) {
          seenLineItemIds.add(li.id);
        }
        const qty = Number(li.quantity ?? 0);
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
        const variantMediaNode = li?.variant?.media?.nodes?.find(
          (node: any) => node?.__typename === "MediaImage"
        );
        if (variantMediaNode?.image?.url) {
          lineItemImageUrl = variantMediaNode.image.url;
        } else if (li?.variant?.product?.featuredMedia?.__typename === "MediaImage") {
          lineItemImageUrl = li?.variant?.product?.featuredMedia?.image?.url ?? null;
        }

        lineItems.push({
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
        });
      }

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