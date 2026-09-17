import {
  fetchOrderFulfillmentMap,
  fetchOrderShippingInfo,
} from "@/lib/shopifyFulfillment";

export type OpenSiblingLine = {
  lineItemId: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  remainingQuantity: number;
};

type OrderLineItemLike = {
  id: string;
  title: string;
  variantTitle?: string | null;
  sku?: string | null;
  variantSku?: string | null;
  variantId?: string | null;
  variant?: { id?: string | null; sku?: string | null } | null;
};

type FulfillmentOrderLike = {
  status?: string | null;
  lineItems?: {
    nodes?: Array<{
      remainingQuantity?: number | null;
      variant?: { id?: string | null; sku?: string | null } | null;
    }> | null;
  } | null;
};

function lineVariantKey(line: {
  variantId?: string | null;
  variantSku?: string | null;
  sku?: string | null;
  variant?: { id?: string | null; sku?: string | null } | null;
}): string | null {
  const variantId = line.variant?.id?.trim() || line.variantId?.trim() || null;
  if (variantId) return `variant:${variantId}`;
  const sku = line.variant?.sku?.trim() || line.variantSku?.trim() || line.sku?.trim() || null;
  if (sku) return `sku:${sku}`;
  return null;
}

/** Open order lines (other products) still awaiting fulfillment. */
export function listOpenSiblingLines(params: {
  orderLineItems: OrderLineItemLike[];
  fulfillmentOrders: FulfillmentOrderLike[];
  scannedLineItemId: string | null;
}): OpenSiblingLine[] {
  const remainingByKey = new Map<string, number>();
  for (const fo of params.fulfillmentOrders) {
    if (String(fo.status || "").toUpperCase() === "CLOSED") continue;
    for (const foLine of fo.lineItems?.nodes || []) {
      const remaining = Math.max(0, Number(foLine.remainingQuantity ?? 0));
      if (remaining <= 0) continue;
      const key = lineVariantKey(foLine);
      if (!key) continue;
      remainingByKey.set(key, (remainingByKey.get(key) ?? 0) + remaining);
    }
  }

  const siblings: OpenSiblingLine[] = [];
  for (const orderLine of params.orderLineItems) {
    if (params.scannedLineItemId && orderLine.id === params.scannedLineItemId) continue;
    const key = lineVariantKey(orderLine);
    const remainingQuantity = key ? remainingByKey.get(key) ?? 0 : 0;
    if (remainingQuantity <= 0) continue;
    siblings.push({
      lineItemId: orderLine.id,
      title: orderLine.title,
      variantTitle: orderLine.variantTitle ?? null,
      sku: orderLine.sku || orderLine.variantSku || orderLine.variant?.sku || null,
      remainingQuantity,
    });
  }

  return siblings;
}

export async function fetchOpenSiblingLines(
  shopifyOrderId: string,
  scannedLineItemId: string | null
): Promise<OpenSiblingLine[]> {
  const [map, orderInfo] = await Promise.all([
    fetchOrderFulfillmentMap(shopifyOrderId),
    fetchOrderShippingInfo(shopifyOrderId),
  ]);
  if (!map.order || !orderInfo) return [];
  return listOpenSiblingLines({
    orderLineItems: orderInfo.lineItems.nodes,
    fulfillmentOrders: map.order.fulfillmentOrders.nodes,
    scannedLineItemId,
  });
}
