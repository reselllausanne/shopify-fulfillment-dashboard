import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";

const MUTATION = /* GraphQL */ `
mutation SetOrderMetafields($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key type value }
    userErrors { field message }
  }
}
`;

export type SupplierOrderMetafieldsInput = {
  shopifyOrderId: string;
  stockxOrderNumber: string;
  stockxStatus?: string | null;
  estimatedDelivery?: string | Date | null;
  /** Prisma Decimal / number / string OK. */
  supplierCost?: number | string | { toString(): string } | null;
  marginAmount?: number | string | { toString(): string } | null;
  marginPercent?: number | string | { toString(): string } | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  /** Skip OrderMatch claim check (caller already owns the link). */
  skipDuplicateCheck?: boolean;
};

export type SupplierOrderMetafieldsResult = {
  ok: boolean;
  metafieldCount: number;
  error: string | null;
  statusCode?: number;
};

function toDateOnly(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function toDecimalString(value: number | string | { toString(): string } | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value.toString());
  if (!Number.isFinite(n)) return null;
  return String(n);
}

function normalizeTrackingUrl(raw: string | null | undefined): string | null {
  let trackingUrl = raw ? String(raw).trim() : null;
  if (!trackingUrl) return null;
  if (!/^https?:\/\//i.test(trackingUrl)) {
    trackingUrl = `https://${trackingUrl}`;
  }
  try {
    return new URL(trackingUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Push supplier.* order metafields on a Shopify order (StockX #, status, ETA, cost, AWB).
 * Best-effort helper used by save-match, auto-checkout link, and AWB/status cron.
 */
export async function setSupplierOrderMetafields(
  input: SupplierOrderMetafieldsInput
): Promise<SupplierOrderMetafieldsResult> {
  const shopifyOrderId = String(input.shopifyOrderId ?? "").trim();
  const stockxOrderNumber = String(input.stockxOrderNumber ?? "").trim();

  if (!shopifyOrderId || !stockxOrderNumber) {
    return {
      ok: false,
      metafieldCount: 0,
      error: "Missing shopifyOrderId or stockxOrderNumber",
      statusCode: 400,
    };
  }

  if (!input.skipDuplicateCheck) {
    const existingMatch = await prisma.orderMatch.findFirst({
      where: { stockxOrderNumber },
      select: { shopifyOrderId: true, shopifyOrderName: true },
    });
    if (existingMatch && existingMatch.shopifyOrderId !== shopifyOrderId) {
      return {
        ok: false,
        metafieldCount: 0,
        error: `Supplier order ${stockxOrderNumber} already matched to ${existingMatch.shopifyOrderName}`,
        statusCode: 409,
      };
    }
  }

  const estimatedDelivery = toDateOnly(input.estimatedDelivery);
  const stockxStatus = String(input.stockxStatus ?? "").trim() || null;
  const supplierCost = toDecimalString(input.supplierCost);
  const marginAmount = toDecimalString(input.marginAmount);
  const marginPercent = toDecimalString(input.marginPercent);
  const trackingNumber = input.trackingNumber ? String(input.trackingNumber).trim() : null;
  const trackingUrl = normalizeTrackingUrl(input.trackingUrl);
  if (input.trackingUrl && !trackingUrl) {
    return {
      ok: false,
      metafieldCount: 0,
      error: "Invalid trackingUrl for metafield supplier.url_awb",
      statusCode: 400,
    };
  }

  const metafields: Array<{
    ownerId: string;
    namespace: string;
    key: string;
    type: string;
    value: string;
  }> = [
    {
      ownerId: shopifyOrderId,
      namespace: "supplier",
      key: "order_number",
      type: "single_line_text_field",
      value: stockxOrderNumber,
    },
  ];

  if (stockxStatus) {
    metafields.push({
      ownerId: shopifyOrderId,
      namespace: "supplier",
      key: "status",
      type: "single_line_text_field",
      value: stockxStatus,
    });
  }

  if (supplierCost != null) {
    metafields.push({
      ownerId: shopifyOrderId,
      namespace: "supplier",
      key: "total_cost",
      type: "number_decimal",
      value: supplierCost,
    });
  }

  if (marginAmount != null) {
    metafields.push({
      ownerId: shopifyOrderId,
      namespace: "supplier",
      key: "margin_amount",
      type: "number_decimal",
      value: marginAmount,
    });
  }

  if (marginPercent != null) {
    metafields.push({
      ownerId: shopifyOrderId,
      namespace: "supplier",
      key: "margin_percent",
      type: "number_decimal",
      value: marginPercent,
    });
  }

  if (estimatedDelivery) {
    metafields.push({
      ownerId: shopifyOrderId,
      namespace: "supplier",
      key: "estimated_delivery",
      type: "date",
      value: estimatedDelivery,
    });
  }

  if (trackingNumber) {
    metafields.push({
      ownerId: shopifyOrderId,
      namespace: "supplier",
      key: "tracking_number",
      type: "single_line_text_field",
      value: trackingNumber,
    });
  }

  if (trackingUrl) {
    metafields.push({
      ownerId: shopifyOrderId,
      namespace: "supplier",
      key: "url_awb",
      type: "url",
      value: trackingUrl,
    });
  }

  try {
    const { data, errors } = await shopifyGraphQL<{
      metafieldsSet: {
        metafields: unknown[];
        userErrors: { field: string[] | null; message: string }[];
      };
    }>(MUTATION, { metafields });

    if (errors?.length) {
      return {
        ok: false,
        metafieldCount: 0,
        error: errors.map((e) => e.message).join("; ") || "Shopify GraphQL errors",
        statusCode: 500,
      };
    }

    const userErrors = data?.metafieldsSet?.userErrors ?? [];
    if (userErrors.length) {
      return {
        ok: false,
        metafieldCount: 0,
        error: userErrors.map((e) => e.message).join("; "),
        statusCode: 400,
      };
    }

    return {
      ok: true,
      metafieldCount: data?.metafieldsSet?.metafields?.length ?? metafields.length,
      error: null,
    };
  } catch (err: any) {
    return {
      ok: false,
      metafieldCount: 0,
      error: err?.message || "Unknown error",
      statusCode: 500,
    };
  }
}

/** Mark OrderMatch row after a successful Shopify metafield push. */
export async function markOrderMatchMetafieldsSynced(matchId: string): Promise<void> {
  await prisma.orderMatch.update({
    where: { id: matchId },
    data: { shopifyMetafieldsSynced: true, shopifyMetafieldsSetAt: new Date() },
  });
}
