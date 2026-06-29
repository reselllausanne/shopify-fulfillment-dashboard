// app/api/shopify/order-by-name/route.ts
import { NextResponse } from "next/server";
import { shopifyGraphQL, extractEUSize } from "@/lib/shopifyAdmin";
import {
  lineFulfillableQuantity,
  shouldSkipOrderForFulfillmentMatching,
} from "@/app/lib/shopifyOrderFulfillmentFilters";
import { normalizeOrderRisk } from "@/app/lib/shopifyOrderRisk";
import { parseShopifyLineItemDelivery } from "@/app/lib/shopifyLineItemDelivery";

export const runtime = "nodejs";

const QUERY = /* GraphQL */ `
query OrderByName($first: Int!, $query: String!) {
  orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
    edges {
      node {
        id
        name
        createdAt
        cancelledAt
        displayFinancialStatus
        displayFulfillmentStatus
        customer { displayName }
        risk {
          recommendation
          assessments {
            riskLevel
          }
        }
        lineItems(first: 50) {
          edges {
            node {
              id
              title
              sku
              quantity
              fulfillableQuantity
              variantTitle
              customAttributes {
                key
                value
              }
              variant {
                expressAvailable: metafield(namespace: "custom", key: "express_available") {
                  value
                }
                expressPrice: metafield(namespace: "custom", key: "express_price") {
                  value
                }
              }
              originalUnitPriceSet { shopMoney { amount currencyCode } }
              discountedTotalSet { shopMoney { amount currencyCode } }
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

    // Shopify search supports name:
    const search = `name:${orderName}`;

    console.log(`[SHOPIFY] Fetching order by name: ${search}`);

    const { data, errors } = await shopifyGraphQL<{
      orders: { edges: { node: any }[] };
    }>(QUERY, { first: 1, query: search });

    if (errors?.length) {
      console.error("[SHOPIFY] GraphQL errors:", errors);
      return NextResponse.json({ error: "Shopify GraphQL errors", details: errors }, { status: 500 });
    }

    const node = data?.orders?.edges?.[0]?.node;
    if (!node) {
      console.log(`[SHOPIFY] Order not found: ${orderName}`);
      return NextResponse.json({ lineItems: [] });
    }

    if (shouldSkipOrderForFulfillmentMatching(node)) {
      console.log(`[SHOPIFY] Order skipped (cancelled / void / refunded): ${orderName}`);
      return NextResponse.json({ lineItems: [] });
    }

    const riskNorm = normalizeOrderRisk(node.risk);

    const liEdges = (node.lineItems?.edges ?? []).filter((liE: any) => lineFulfillableQuantity(liE?.node) > 0);
    const lineItems = liEdges.map((liE: any) => {
      const li = liE.node;
      const unit = li.originalUnitPriceSet?.shopMoney;
      const total = li.discountedTotalSet?.shopMoney;
      const currencyCode = total?.currencyCode || unit?.currencyCode || "CHF";
      const totalAmount = total?.amount ?? "0";
      const qty = lineFulfillableQuantity(li);
      const unitAmount =
        unit?.amount ??
        (qty > 0 ? String(Number(totalAmount) / qty) : "0");

      const variantTitle = li.variantTitle ?? null;
      const sizeEU = extractEUSize(variantTitle) ?? extractEUSize(li.title);

      const deliveryInfo = parseShopifyLineItemDelivery({
        customAttributes: li.customAttributes ?? [],
        expressAvailableMetafield: li?.variant?.expressAvailable?.value ?? null,
        expressPriceMetafield: li?.variant?.expressPrice?.value ?? null,
      });

      return {
        shopifyOrderId: node.id,
        orderId: node.id,
        orderName: node.name,
        createdAt: node.createdAt,
        displayFinancialStatus: node.displayFinancialStatus ?? null,
        displayFulfillmentStatus: node.displayFulfillmentStatus ?? null,
        customerName: node.customer?.displayName ?? null,
        lineItemId: li.id,
        title: li.title ?? "—",
        sku: li.sku ?? null,
        variantTitle,
        sizeEU,
        quantity: qty,
        price: String(unitAmount),
        totalPrice: String(totalAmount),
        currencyCode,
        fraudRiskLevel: riskNorm.fraudRiskLevel,
        fraudRecommendation: riskNorm.fraudRecommendation,
        fraudSummaryLabel: riskNorm.fraudSummaryLabel,
        deliveryMode: deliveryInfo.deliveryMode,
        deliveryModeLabel: deliveryInfo.deliveryModeLabel,
        deliveryEstimate: deliveryInfo.deliveryEstimate,
        expressAvailable: deliveryInfo.expressAvailable,
        expressPrice: deliveryInfo.expressPrice,
        variantExpressPrice: deliveryInfo.variantExpressPrice,
      };
    });

    console.log(`[SHOPIFY] Found order ${orderName} with ${lineItems.length} line items`);

    return NextResponse.json({ lineItems });
  } catch (err: any) {
    console.error("[/api/shopify/order-by-name] error:", err);
    return NextResponse.json(
      { error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
