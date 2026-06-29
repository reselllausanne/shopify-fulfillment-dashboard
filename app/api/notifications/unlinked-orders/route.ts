import { NextResponse } from "next/server";
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import {
  isInStockEssentialLine,
  isLiquidationShopifyTitle,
  isShopifyFinancialRefunded,
} from "@/app/utils/matching";
import {
  lineFulfillableQuantity,
  shouldSkipOrderForFulfillmentMatching,
} from "@/app/lib/shopifyOrderFulfillmentFilters";

export const runtime = "nodejs";

const SHOP_TIMEZONE = "Europe/Zurich";
const ORDER_LIMIT = 50;

const RECENT_ORDERS_QUERY = /* GraphQL */ `
query RecentOrdersForUnlinked($first: Int!) {
  orders(first: $first, sortKey: CREATED_AT, reverse: true) {
    edges {
      node {
        id
        name
        createdAt
        cancelledAt
        displayFinancialStatus
        displayFulfillmentStatus
        lineItems(first: 50) {
          edges {
            node {
              id
              name
              title
              sku
              quantity
              fulfillableQuantity
            }
          }
        }
      }
    }
  }
}
`;

function convertToShopTimezone(utcTimestamp: string): string {
  return formatInTimeZone(new Date(utcTimestamp), SHOP_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function isExcludedLine(sku: string | null, title: string) {
  if (isInStockEssentialLine(sku, title)) return true;
  if (isLiquidationShopifyTitle(title)) return true;
  return false;
}

export async function GET() {
  try {
    const { data, errors } = await shopifyGraphQL<{
      orders: { edges: { node: any }[] };
    }>(RECENT_ORDERS_QUERY, { first: ORDER_LIMIT });

    if (errors?.length) {
      return NextResponse.json(
        { ok: false, error: "Shopify GraphQL errors", details: errors },
        { status: 500 }
      );
    }

    const candidateLines: {
      shopifyOrderId: string;
      shopifyOrderName: string;
      shopifyLineItemId: string;
      shopifyProductTitle: string;
      shopifySku: string | null;
      shopifyCreatedAt: string;
      displayFulfillmentStatus: string | null;
      fulfillableQuantity: number;
    }[] = [];

    for (const edge of data?.orders?.edges ?? []) {
      const order = edge?.node;
      if (!order) continue;
      if (shouldSkipOrderForFulfillmentMatching(order)) continue;
      if (isShopifyFinancialRefunded(order.displayFinancialStatus)) continue;

      const orderId = order.id;
      const orderName = order.name;
      const createdAt = convertToShopTimezone(order.createdAt);

      for (const liEdge of order.lineItems?.edges ?? []) {
        const li = liEdge?.node;
        if (!li?.id) continue;

        const title = li.name ?? li.title ?? "—";
        const sku = li.sku ?? null;
        if (isExcludedLine(sku, title)) continue;

        const fulfillable = lineFulfillableQuantity(li);
        if (fulfillable <= 0) continue;

        candidateLines.push({
          shopifyOrderId: orderId,
          shopifyOrderName: orderName,
          shopifyLineItemId: li.id,
          shopifyProductTitle: title,
          shopifySku: sku,
          shopifyCreatedAt: createdAt,
          displayFulfillmentStatus: order.displayFulfillmentStatus ?? null,
          fulfillableQuantity: fulfillable,
        });
      }
    }

    const lineItemIds = candidateLines.map((l) => l.shopifyLineItemId);
    const existingMatches =
      lineItemIds.length > 0
        ? await prisma.orderMatch.findMany({
            where: { shopifyLineItemId: { in: lineItemIds } },
            select: {
              shopifyLineItemId: true,
              stockxOrderNumber: true,
              stockxAwb: true,
              stockxTrackingUrl: true,
              matchType: true,
            },
          })
        : [];
    const matchByLineId = new Map(existingMatches.map((m) => [m.shopifyLineItemId, m]));

    const now = Date.now();
    const items = candidateLines
      .filter((line) => !matchByLineId.has(line.shopifyLineItemId))
      .map((line) => {
        const createdMs = new Date(line.shopifyCreatedAt).getTime();
        const ageDays = Number.isFinite(createdMs)
          ? Math.floor((now - createdMs) / (1000 * 60 * 60 * 24))
          : null;
        return { ...line, ageDays };
      })
      .sort((a, b) => {
        const aMs = new Date(a.shopifyCreatedAt).getTime();
        const bMs = new Date(b.shopifyCreatedAt).getTime();
        return bMs - aMs;
      });

    return NextResponse.json({
      ok: true,
      count: items.length,
      orderLimit: ORDER_LIMIT,
      items,
    });
  } catch (error: any) {
    console.error("[UNLINKED_ORDERS] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to load unlinked orders" },
      { status: 500 }
    );
  }
}
