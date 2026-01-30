import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ComparisonRow {
  orderId: string;
  orderName: string;
  createdAt: string;
  shopifySalePrice: number | null;
  currency: string;
  shopify: {
    stockxOrderNumber: string | null;
    status: string | null;
    supplierCost: number | null;
    marginAmount: number | null;
    marginPercent: number | null;
  };
  db: {
    salePrice: number | null;
    stockxOrderNumber: string | null;
    status: string | null;
    supplierCost: number | null;
    marginAmount: number | null;
    marginPercent: number | null;
    matchType: string | null;
    manualCostOverride: number | null;
  } | null;
  match: "synced" | "metafields_only" | "manual_cost" | "db_only";
}

const SHOPIFY_QUERY = /* GraphQL */ `
      query getOrders($first: Int!, $namespace: String!) {
        orders(first: $first, reverse: true) {
          edges {
            node {
              id
              name
              createdAt
              currentTotalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              stockxOrderNumber: metafield(namespace: $namespace, key: "order_number") {
                value
              }
              status: metafield(namespace: $namespace, key: "status") {
                value
              }
              supplierCost: metafield(namespace: $namespace, key: "total_cost") {
                value
              }
              marginAmount: metafield(namespace: $namespace, key: "margin_amount") {
                value
              }
              marginPercent: metafield(namespace: $namespace, key: "margin_percent") {
                value
              }
            }
          }
        }
      }
    `;

type ShopifyMoney = {
  amount: string;
  currencyCode: string;
};

type ShopifyNode = {
  id: string;
  name: string;
  createdAt: string;
  currentTotalPriceSet?: {
    shopMoney?: ShopifyMoney;
  };
  stockxOrderNumber?: { value?: string };
  status?: { value?: string };
  supplierCost?: { value?: string };
  marginAmount?: { value?: string };
  marginPercent?: { value?: string };
};

type ShopifyOrderEdge = {
  node: ShopifyNode;
};

const metafieldValue = (value: string | null | undefined) =>
  value ? Number.parseFloat(value) : null;

const decimalToNumber = (
  value: Prisma.Decimal | string | number | null | undefined
): number | null => (value !== null && value !== undefined ? Number(value) : null);

async function fetchShopifyOrders(namespace: string, first = 50): Promise<ShopifyOrderEdge[]> {
  const shopifyAccessToken = process.env.ACCESS_TOKEN_SHOPIFY;
  const shopifyShopDomain = process.env.SHOP_NAME_SHOPIFY;
  const shopifyApiVersion = process.env.API_VERSION_SHOPIFY || "2025-01";

  if (!shopifyAccessToken || !shopifyShopDomain) {
    throw new Error("Shopify credentials not configured");
  }

  const res = await fetch(
      `https://${shopifyShopDomain}/admin/api/${shopifyApiVersion}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": shopifyAccessToken,
        },
        body: JSON.stringify({
        query: SHOPIFY_QUERY,
        variables: { first, namespace },
        }),
      }
    );

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.errors?.[0]?.message || "Shopify GraphQL failed");
  }
  return payload?.data?.orders?.edges || [];
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const daysParam = parseInt(searchParams.get("days") || "30");
    const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 30;

    // Get DB data
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days);

    const dbMatches = await prisma.orderMatch.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
      },
      select: {
        shopifyOrderId: true,
        shopifyOrderName: true,
        stockxOrderNumber: true,
        shopifyTotalPrice: true,
        supplierCost: true,
        marginAmount: true,
        marginPercent: true,
        stockxStatus: true,
        shopifyCurrencyCode: true,
        createdAt: true,
        matchType: true,
        manualCostOverride: true,
        shopifyMetafieldsSynced: true,
      },
    });

    const shopifyOrders = await fetchShopifyOrders("supplier", 50);

    const comparison: ComparisonRow[] = [];
    
    for (const edge of shopifyOrders) {
      const node = edge.node;
      const orderId = node.id;
      
      const shopifySalePrice = node.currentTotalPriceSet?.shopMoney?.amount
        ? Number.parseFloat(node.currentTotalPriceSet.shopMoney.amount)
        : null;
      const currency =
        node.currentTotalPriceSet?.shopMoney?.currencyCode || "CHF";
      const stockxOrderNumber = node.stockxOrderNumber?.value || null;
      const status = node.status?.value || null;
      const supplierCost = metafieldValue(node.supplierCost?.value);
      const marginAmount = metafieldValue(node.marginAmount?.value);
      const marginPercent = metafieldValue(node.marginPercent?.value);

      const dbMatch = dbMatches.find((m) => m.shopifyOrderId === orderId);

      if (!dbMatch && !stockxOrderNumber) continue;

        const isManualCost = dbMatch?.matchType === "MANUAL_COST";
      const matchStatus: ComparisonRow["match"] = !dbMatch
          ? "metafields_only" 
          : isManualCost 
          ? "manual_cost" 
          : dbMatch.shopifyMetafieldsSynced 
          ? "synced" 
          : "db_only";

        comparison.push({
          orderId,
        orderName: node.name,
        createdAt: node.createdAt,
        shopifySalePrice,
        currency,
          shopify: {
            stockxOrderNumber,
            status,
            supplierCost,
            marginAmount,
            marginPercent,
          },
          db: dbMatch
            ? {
              salePrice: decimalToNumber(dbMatch.shopifyTotalPrice),
                stockxOrderNumber: dbMatch.stockxOrderNumber,
                status: dbMatch.stockxStatus,
              supplierCost: decimalToNumber(dbMatch.supplierCost),
              marginAmount: decimalToNumber(dbMatch.marginAmount),
              marginPercent: decimalToNumber(dbMatch.marginPercent),
              matchType: dbMatch.matchType,
              manualCostOverride: decimalToNumber(dbMatch.manualCostOverride),
              }
            : null,
          match: matchStatus,
        });
    }

    const shopifyOrderIds = new Set(shopifyOrders.map((edge) => edge.node.id));
    for (const dbMatch of dbMatches) {
      if (shopifyOrderIds.has(dbMatch.shopifyOrderId)) continue;
        comparison.push({
          orderId: dbMatch.shopifyOrderId,
          orderName: dbMatch.shopifyOrderName,
        createdAt: dbMatch.createdAt.toISOString(),
        shopifySalePrice: decimalToNumber(dbMatch.shopifyTotalPrice),
          currency: dbMatch.shopifyCurrencyCode,
          shopify: {
            stockxOrderNumber: null,
            status: null,
            supplierCost: null,
            marginAmount: null,
            marginPercent: null,
          },
          db: {
          salePrice: decimalToNumber(dbMatch.shopifyTotalPrice),
            stockxOrderNumber: dbMatch.stockxOrderNumber,
            status: dbMatch.stockxStatus,
          supplierCost: decimalToNumber(dbMatch.supplierCost),
          marginAmount: decimalToNumber(dbMatch.marginAmount),
          marginPercent: decimalToNumber(dbMatch.marginPercent),
            matchType: dbMatch.matchType,
          manualCostOverride: decimalToNumber(dbMatch.manualCostOverride),
          },
          match: dbMatch.matchType === "MANUAL_COST" ? "manual_cost" : "db_only",
        });
    }

    const summary = {
        total: comparison.length,
        synced: comparison.filter((c) => c.match === "synced").length,
        metafieldsOnly: comparison.filter((c) => c.match === "metafields_only").length,
        manualCost: comparison.filter((c) => c.match === "manual_cost").length,
        dbOnly: comparison.filter((c) => c.match === "db_only").length,
    };

    return NextResponse.json({
      comparison,
      summary,
    });
  } catch (error: any) {
    console.error("[SHOPIFY COMPARISON] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch comparison data", details: error?.message || String(error) },
      { status: 500 }
    );
  }
}

