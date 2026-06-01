// app/api/shopify/order-exchange-by-name/route.ts
import { NextResponse } from "next/server";
import { formatInTimeZone } from "date-fns-tz";
import { shopifyGraphQL, extractEUSize } from "@/lib/shopifyAdmin";
import { shouldSkipOrderForFulfillmentMatching } from "@/app/lib/shopifyOrderFulfillmentFilters";
import { normalizeOrderRisk } from "@/app/lib/shopifyOrderRisk";

export const runtime = "nodejs";

const SHOP_TIMEZONE = "Europe/Zurich";

function convertToShopTimezone(utcTimestamp: string): string {
  return formatInTimeZone(new Date(utcTimestamp), SHOP_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function isShopifyReturnName(name: string): boolean {
  return /^#\d+-R\d+$/i.test(name.trim());
}

/** Shopify return names like #5816-R1 — not searchable as orders; use parent #5816. */
function resolveOrderNameForExchangeLookup(orderName: string): string {
  const trimmed = orderName.trim();
  const parentMatch = trimmed.match(/^(#\d+)-R\d+$/i);
  if (parentMatch) return parentMatch[1];
  return trimmed;
}

const ORDER_ID_QUERY = /* GraphQL */ `
query OrderIdByName($first: Int!, $query: String!) {
  orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
    edges {
      node {
        id
        name
      }
    }
  }
}
`;

const ORDER_EXCHANGE_QUERY = /* GraphQL */ `
query OrderExchangeById($orderId: ID!) {
  order(id: $orderId) {
    id
    name
    createdAt
    cancelledAt
    displayFinancialStatus
    displayFulfillmentStatus
    email
    risk {
      recommendation
      assessments {
        riskLevel
      }
    }
    customer {
      displayName
      firstName
      lastName
      defaultEmailAddress { emailAddress }
    }
    shippingAddress { country city }
    lineItems(first: 100) {
      nodes {
        id
        title
        sku
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
      }
    }
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
              returnLineItems(first: 50) {
                edges {
                  node {
                    ... on ReturnLineItem {
                      id
                      quantity
                      returnReason
                      fulfillmentLineItem {
                        lineItem {
                          id
                          name
                          sku
                          originalUnitPriceSet {
                            shopMoney { amount currencyCode }
                          }
                        }
                      }
                    }
                  }
                }
              }
              exchangeLineItems(first: 50) {
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
    let orderName = String(body?.orderName ?? "").trim();

    if (!orderName) {
      return NextResponse.json({ error: "Missing orderName" }, { status: 400 });
    }

    if (!orderName.startsWith("#")) orderName = `#${orderName}`;
    const lookupName = resolveOrderNameForExchangeLookup(orderName);
    const search = `name:${lookupName}`;

    const orderIdRes = await shopifyGraphQL<{
      orders: { edges: { node: { id: string; name: string } }[] };
    }>(ORDER_ID_QUERY, { first: 1, query: search });

    if (orderIdRes.errors?.length) {
      return NextResponse.json(
        { error: "Shopify GraphQL errors", details: orderIdRes.errors },
        { status: 500 }
      );
    }

    const orderNode = orderIdRes.data?.orders?.edges?.[0]?.node;
    if (!orderNode) {
      return NextResponse.json({
        lineItems: [],
        hint:
          lookupName !== orderName
            ? `No order for ${orderName}; parent ${lookupName} also not found.`
            : `No order found for ${orderName}.`,
      });
    }

    const { data, errors } = await shopifyGraphQL<{ order: any }>(
      ORDER_EXCHANGE_QUERY,
      { orderId: orderNode.id }
    );

    if (errors?.length) {
      return NextResponse.json(
        { error: "Shopify exchange GraphQL errors", details: errors },
        { status: 500 }
      );
    }

    const order = data?.order;
    if (!order) return NextResponse.json({ lineItems: [] });

    if (shouldSkipOrderForFulfillmentMatching(order)) {
      return NextResponse.json({ lineItems: [] });
    }

    const riskNorm = normalizeOrderRisk(order.risk);

    const customerName = order.customer?.displayName ?? null;
    const customerFirstName = order.customer?.firstName ?? null;
    const customerLastName = order.customer?.lastName ?? null;
    const customerEmail =
      order.customer?.defaultEmailAddress?.emailAddress ?? order.email ?? null;
    const shippingCountry = order.shippingAddress?.country ?? null;
    const shippingCity = order.shippingAddress?.city ?? null;

    const lineItemMeta = new Map<string, { variantTitle: string | null; imageUrl: string | null }>();
    for (const li of order.lineItems?.nodes ?? []) {
      let imageUrl = null;
      const variantMediaNode = li?.variant?.media?.nodes?.find(
        (node: any) => node?.__typename === "MediaImage"
      );
      if (variantMediaNode?.image?.url) {
        imageUrl = variantMediaNode.image.url;
      } else if (li?.variant?.product?.featuredMedia?.__typename === "MediaImage") {
        imageUrl = li?.variant?.product?.featuredMedia?.image?.url ?? null;
      }
      lineItemMeta.set(li.id, { variantTitle: li.variantTitle ?? null, imageUrl });
    }

    const filterReturnName = isShopifyReturnName(orderName) ? orderName : null;
    const agreements = order.agreements?.edges ?? [];
    const exchangeLineItems: {
      exchangeLineItemId: string | null;
      lineItem: any;
      returnHappenedAt: string | null;
      returnName: string | null;
    }[] = [];
    const returnedLineItems: {
      lineItemId: string;
      title: string;
      sku: string | null;
      quantity: number;
      totalPrice: string;
      currencyCode: string;
      returnName: string | null;
      shopifyReturnReason: string | null;
    }[] = [];
    const seenReturnedLineIds = new Set<string>();

    for (const edge of agreements) {
      const node = edge?.node;
      if (node?.__typename !== "ReturnAgreement") continue;
      const returnName = node?.return?.name ?? null;
      if (filterReturnName && returnName !== filterReturnName) continue;
      const returnHappenedAt = node?.happenedAt ?? null;

      const returnEdges = node?.return?.returnLineItems?.edges ?? [];
      for (const retEdge of returnEdges) {
        const retNode = retEdge?.node;
        const li = retNode?.fulfillmentLineItem?.lineItem;
        if (!li?.id || seenReturnedLineIds.has(li.id)) continue;
        seenReturnedLineIds.add(li.id);
        const unit = li.originalUnitPriceSet?.shopMoney;
        const qty = Number(retNode?.quantity ?? li.quantity ?? 1);
        const unitAmount = unit?.amount ?? "0";
        const totalAmount =
          qty > 0 ? String(Number(unitAmount) * qty) : unitAmount;
        returnedLineItems.push({
          lineItemId: li.id,
          title: li.name ?? "—",
          sku: li.sku ?? null,
          quantity: qty,
          totalPrice: totalAmount,
          currencyCode: unit?.currencyCode || "CHF",
          returnName,
          shopifyReturnReason: retNode?.returnReason ?? null,
        });
      }

      const exchangeEdges = node?.return?.exchangeLineItems?.edges ?? [];
      for (const exEdge of exchangeEdges) {
        const exNode = exEdge?.node;
        const exLineItems = exNode?.lineItems ?? [];
        for (const li of exLineItems) {
          exchangeLineItems.push({
            exchangeLineItemId: exNode?.id ?? null,
            lineItem: li,
            returnHappenedAt,
            returnName,
          });
        }
      }
    }

    const lineItems = exchangeLineItems.map((entry: (typeof exchangeLineItems)[number]) => {
      const li = entry.lineItem;
      const qty = Number(li.quantity ?? 0);
      const unit = li.originalUnitPriceSet?.shopMoney;
      const total = li.discountedTotalSet?.shopMoney ?? li.originalUnitPriceSet?.shopMoney;
      const currencyCode = total?.currencyCode || unit?.currencyCode || "CHF";
      const totalAmount = total?.amount ?? "0";
      const unitAmount =
        unit?.amount ?? (qty > 0 ? String(Number(totalAmount) / qty) : "0");

      const meta = lineItemMeta.get(li.id) || { variantTitle: null, imageUrl: null };
      const sizeEU = extractEUSize(meta.variantTitle) ?? extractEUSize(li.name) ?? null;
      const eventAt = entry.returnHappenedAt || order.createdAt;
      const createdAt = convertToShopTimezone(eventAt);

      return {
        shopifyOrderId: order.id,
        orderId: order.id,
        orderName: order.name,
        returnName: entry.returnName,
        createdAt,
        displayFinancialStatus: order.displayFinancialStatus ?? null,
        displayFulfillmentStatus: order.displayFulfillmentStatus ?? null,
        customerEmail,
        customerName,
        customerFirstName,
        customerLastName,
        shippingCountry,
        shippingCity,
        lineItemId: li.id,
        title: li.name ?? "—",
        sku: li.sku ?? null,
        variantTitle: meta.variantTitle,
        sizeEU,
        lineItemImageUrl: meta.imageUrl,
        quantity: qty,
        price: String(unitAmount),
        totalPrice: String(totalAmount),
        currencyCode,
        fraudRiskLevel: riskNorm.fraudRiskLevel,
        fraudRecommendation: riskNorm.fraudRecommendation,
        fraudSummaryLabel: riskNorm.fraudSummaryLabel,
      };
    });

    return NextResponse.json({
      lineItems,
      returnedLineItems,
      resolvedFromReturnName: lookupName !== orderName ? orderName : null,
      orderName: order.name,
    });
  } catch (err: any) {
    console.error("[/api/shopify/order-exchange-by-name] error:", err);
    return NextResponse.json(
      { error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}


