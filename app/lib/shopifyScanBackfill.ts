/**
 * Link a scanned parcel to an open Shopify line that has no OrderMatch yet.
 *
 * fulfill-from-awb resolves the line through OrderMatch (by AWB, or by line
 * id for GTIN), so a scan-confirmed line needs a row. Existing rows only get
 * the AWB written when empty. New rows are placeholders: supplier cost is
 * unknown (0) and flagged so the StockX matching flow can overwrite it later
 * via save-match.
 */

import crypto from "node:crypto";
import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { toShopifyOrderGid } from "@/app/lib/swissPostCustomerTracking";
import { toShopifyCreatedAtStorage } from "@/app/utils/shopifySellDate";
import type { OpenShopifyLineCandidate } from "@/app/lib/shopifyAwbFallback";

export const SCAN_BACKFILL_MATCH_TYPE = "scan_backfill";
export const SCAN_BACKFILL_STATUS = "SCAN_BACKFILL";

const LINE_DETAILS_QUERY = /* GraphQL */ `
  query ScanBackfillLine($orderId: ID!, $lineId: ID!) {
    order(id: $orderId) {
      id
      name
      createdAt
      email
      customer { firstName lastName email }
    }
    line: node(id: $lineId) {
      ... on LineItem {
        id
        title
        sku
        variantTitle
        image { url }
        discountedTotalSet { shopMoney { amount currencyCode } }
      }
    }
  }
`;

type LineDetails = {
  order: {
    id: string;
    name: string;
    createdAt: string;
    email: string | null;
    customer: { firstName: string | null; lastName: string | null; email: string | null } | null;
  } | null;
  line: {
    id: string;
    title: string;
    sku: string | null;
    variantTitle: string | null;
    image: { url: string | null } | null;
    discountedTotalSet: { shopMoney: { amount: string; currencyCode: string } } | null;
  } | null;
};

export async function ensureOrderMatchForScannedLine(params: {
  candidate: OpenShopifyLineCandidate;
  awb: string | null;
  reason: string;
  stockx?: {
    orderNumber?: string | null;
    productName?: string | null;
    sizeEU?: string | null;
    sku?: string | null;
    purchaseDate?: string | Date | null;
  } | null;
}) {
  const { candidate, reason } = params;
  const awb = String(params.awb ?? "").trim() || null;
  const lineId = candidate.shopifyLineItemId;

  const existing = await prisma.orderMatch.findUnique({ where: { shopifyLineItemId: lineId } });
  if (existing) {
    if (awb && !String(existing.stockxAwb ?? "").trim()) {
      await prisma.orderMatch.updateMany({
        where: { shopifyLineItemId: lineId, OR: [{ stockxAwb: null }, { stockxAwb: "" }] },
        data: { stockxAwb: awb },
      });
      return prisma.orderMatch.findUnique({ where: { shopifyLineItemId: lineId } });
    }
    return existing;
  }

  const { data, errors } = await shopifyGraphQL<LineDetails>(LINE_DETAILS_QUERY, {
    orderId: toShopifyOrderGid(candidate.shopifyOrderId),
    lineId,
  });
  if (errors?.length || !data?.order || !data?.line) {
    throw new Error(
      `Shopify line lookup failed: ${errors?.map((e: any) => e.message).join("; ") || "not found"}`
    );
  }
  const { order, line } = data;
  const revenue = Number(line.discountedTotalSet?.shopMoney?.amount ?? 0) || 0;
  const purchaseDate = params.stockx?.purchaseDate ? new Date(params.stockx.purchaseDate) : null;
  const stockxOrderNumber =
    String(params.stockx?.orderNumber ?? "").trim() || `SAVED-${lineId}`;

  return prisma.orderMatch.create({
    data: {
      shopifyOrderId: toShopifyOrderGid(order.id),
      shopifyOrderName: order.name,
      shopifyLineItemId: lineId,
      shopifyProductTitle: line.title,
      shopifySku: line.sku ?? candidate.shopifySku ?? null,
      shopifySizeEU: line.variantTitle ?? candidate.shopifySizeEU ?? null,
      shopifyTotalPrice: revenue,
      shopifyCurrencyCode: line.discountedTotalSet?.shopMoney?.currencyCode || "CHF",
      shopifyCreatedAt: toShopifyCreatedAtStorage(new Date(order.createdAt)),
      shopifyCustomerEmail: order.customer?.email ?? order.email ?? null,
      shopifyCustomerFirstName: order.customer?.firstName ?? null,
      shopifyCustomerLastName: order.customer?.lastName ?? null,
      shopifyLineItemImageUrl: line.image?.url ?? null,
      supplierSource: "STOCKX",
      stockxOrderNumber,
      stockxProductName: params.stockx?.productName || line.title,
      stockxSizeEU: params.stockx?.sizeEU ?? null,
      stockxSkuKey: params.stockx?.sku ?? null,
      stockxPurchaseDate:
        purchaseDate && !Number.isNaN(purchaseDate.getTime()) ? purchaseDate : null,
      stockxAwb: awb,
      matchConfidence: "low",
      matchScore: 0,
      matchType: SCAN_BACKFILL_MATCH_TYPE,
      matchReasons: JSON.stringify([reason, "supplier_cost_unknown"]),
      stockxStatus: SCAN_BACKFILL_STATUS,
      supplierCost: 0,
      marginAmount: 0,
      marginPercent: 0,
      customerTrackingToken: crypto.randomUUID(),
    },
  });
}
