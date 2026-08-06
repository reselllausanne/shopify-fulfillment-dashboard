// app/api/shopify/order-by-name/route.ts
import { NextResponse } from "next/server";
import { shopifyGraphQL, extractEUSize } from "@/lib/shopifyAdmin";
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
        shippingLines(first: 5) {
          edges {
            node {
              title
              isRemoved
            }
          }
        }
        fulfillmentOrders(first: 10) {
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

    const orderShippingLines = (node.shippingLines?.edges ?? [])
      .map((edge: any) => edge?.node)
      .filter(Boolean)
      .map((nodeLine: any) => ({
        title: nodeLine.title ?? null,
        isRemoved: Boolean(nodeLine.isRemoved),
      }));
    const foNodes = node.fulfillmentOrders?.nodes ?? [];
    const orderFulfillmentOrders = foNodes.map((fo: any) => ({
      deliveryMethod: fo.deliveryMethod ?? null,
      assignedLocation: fo.assignedLocation ?? null,
    }));
    const pickupInfo = parseShopifyOrderPickup({
      shippingLines: orderShippingLines,
      fulfillmentOrders: orderFulfillmentOrders,
    });
    const foPhysicalByLine = buildPhysicalStockFromFulfillmentOrders(foNodes);

    const liEdges = (node.lineItems?.edges ?? []).filter((liE: any) => lineFulfillableQuantity(liE?.node) > 0);
    const physicalStockByGtin = await buildPhysicalStockByGtinMap(
      liEdges.map((liE: any) => String(liE?.node?.variant?.barcode ?? "").trim()).filter(Boolean)
    );
    const protectionToPersist: Parameters<typeof upsertPackageProtectionMatches>[0] = [];
    const lineItems = [];
    for (const liE of liEdges) {
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
      const title = li.title ?? "—";
      const sizeEU = extractEUSize(variantTitle) ?? extractEUSize(title);

      if (isPackageProtectionShopifyLine(title, li.sku ?? null)) {
        protectionToPersist.push({
          shopifyOrderId: node.id,
          shopifyOrderName: node.name,
          shopifyLineItemId: li.id,
          shopifyProductTitle: title,
          shopifySku: li.sku ?? null,
          shopifyTotalPrice: Number.parseFloat(String(totalAmount)) || 0,
          shopifyCurrencyCode: currencyCode,
          shopifyCreatedAt: node.createdAt,
          shopifyCustomerEmail: null,
          shopifyCustomerFirstName: null,
          shopifyCustomerLastName: null,
        });
        continue;
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
      const mirrorPhysical = gtin ? resolvePhysicalStockForGtin(gtin, physicalStockByGtin) : null;
      const foPhysical = li?.id ? foPhysicalByLine.get(li.id) ?? null : null;
      const physicalStock = coalescePhysicalStock(mirrorPhysical, foPhysical);

      lineItems.push({
        shopifyOrderId: node.id,
        orderId: node.id,
        orderName: node.name,
        createdAt: node.createdAt,
        displayFinancialStatus: node.displayFinancialStatus ?? null,
        displayFulfillmentStatus: node.displayFulfillmentStatus ?? null,
        customerName: node.customer?.displayName ?? null,
        lineItemId: li.id,
        title,
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
        gtin,
        physicalStockQty: physicalStock?.qty ?? null,
        physicalStockLocation: physicalStock?.locationName ?? null,
        isStorePickup: pickupInfo.isStorePickup,
        pickupLocation: pickupInfo.locationName,
        pickupLabel: pickupInfo.label,
      });
    }

    if (protectionToPersist.length > 0) {
      await upsertPackageProtectionMatches(protectionToPersist).catch((err) => {
        console.warn("[SHOPIFY] package protection upsert failed", err);
      });
    }

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
