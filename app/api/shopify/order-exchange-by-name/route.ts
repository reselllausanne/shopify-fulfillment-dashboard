// app/api/shopify/order-exchange-by-name/route.ts
import { NextResponse } from "next/server";
import { shopifyGraphQL, extractEUSize } from "@/lib/shopifyAdmin";

export const runtime = "nodejs";

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
    const search = `name:${orderName}`;

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
      return NextResponse.json({ lineItems: [] });
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

    const agreements = order.agreements?.edges ?? [];
    const exchangeLineItems: any[] = [];
    for (const edge of agreements) {
      const node = edge?.node;
      if (node?.__typename !== "ReturnAgreement") continue;
      const exchangeEdges = node?.return?.exchangeLineItems?.edges ?? [];
      for (const exEdge of exchangeEdges) {
        const exNode = exEdge?.node;
        const exLineItems = exNode?.lineItems ?? [];
        for (const li of exLineItems) {
          exchangeLineItems.push({
            exchangeLineItemId: exNode?.id ?? null,
            lineItem: li,
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

      return {
        shopifyOrderId: order.id,
        orderId: order.id,
        orderName: order.name,
        createdAt: order.createdAt,
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
      };
    });

    return NextResponse.json({ lineItems });
  } catch (err: any) {
    console.error("[/api/shopify/order-exchange-by-name] error:", err);
    return NextResponse.json(
      { error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}


