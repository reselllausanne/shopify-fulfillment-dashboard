import { extractEUSize, shopifyGraphQL } from "@/lib/shopifyAdmin";

export type DbFulfillmentItem = {
  sku?: string | null;
  variantId?: string | null;
  title?: string | null;
  sizeEU?: string | null;
  quantity?: number;
  sourceId?: string | null;
};

export type FulfillmentOrderLineItemNode = {
  id: string;
  totalQuantity: number;
  remainingQuantity: number;
  inventoryItemId?: string | null;
  variant?: { id?: string | null; sku?: string | null } | null;
};

export type FulfillmentOrderNode = {
  id: string;
  status: string;
  requestStatus: string;
  supportedActions: { action: string }[];
  lineItems: { nodes: FulfillmentOrderLineItemNode[] };
};

export type OrderLineItemSummary = {
  id: string;
  title: string;
  name?: string | null;
  sku?: string | null;
  variantTitle?: string | null;
  quantity: number;
  variantId?: string | null;
  variantSku?: string | null;
};

export type ShippingLineInfo = {
  id: string;
  title: string;
  amount: string;
  currencyCode: string;
  isRemoved: boolean;
};

export type OrderShippingInfo = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  shippingAddress?: {
    firstName?: string | null;
    lastName?: string | null;
    name?: string | null;
    company?: string | null;
    address1?: string | null;
    address2?: string | null;
    zip?: string | null;
    city?: string | null;
    province?: string | null;
    country?: string | null;
    countryCodeV2?: string | null;
    phone?: string | null;
  } | null;
  lineItems: { nodes: OrderLineItemSummary[] };
  shippingLines?: ShippingLineInfo[];
};

export type OrderFulfillmentMap = {
  order: {
    id: string;
    name: string;
    fulfillmentOrders: { nodes: FulfillmentOrderNode[] };
  } | null;
};

export type FulfillmentOrderLineItemInput = {
  id: string;
  quantity: number;
};

export type FulfillmentOrderLineItemsInput = {
  fulfillmentOrderId: string;
  fulfillmentOrderLineItems: FulfillmentOrderLineItemInput[];
};

export type FulfillmentTrackingInput = {
  number?: string | null;
  url?: string | null;
  company?: string | null;
};

export type FulfillmentInput = {
  notifyCustomer?: boolean;
  trackingInfo?: FulfillmentTrackingInput;
  lineItemsByFulfillmentOrder: FulfillmentOrderLineItemsInput[];
};

type ShopifyFulfillmentCreateResponse = {
  fulfillmentCreate: {
    fulfillment: {
      id: string;
      status: string;
      trackingInfo: { company?: string | null; number?: string | null; url?: string | null }[];
    } | null;
    userErrors: { field?: string[] | null; message: string }[];
  };
};

const ORDER_ID_BY_NAME_QUERY = /* GraphQL */ `
query OrderIdByName($query: String!) {
  orders(first: 1, query: $query) {
    nodes {
      id
      name
    }
  }
}
`;

// ✅ Query corrected per Shopify docs (do not change fields)
const ORDER_FULFILLMENT_MAP_QUERY = /* GraphQL */ `
query OrderFulfillmentMap($orderId: ID!) {
  order(id: $orderId) {
    id
    name
    fulfillmentOrders(first: 50) {
      nodes {
        id
        status
        requestStatus
        supportedActions { action }
        lineItems(first: 250) {
          nodes {
            id
            totalQuantity
            remainingQuantity
            inventoryItemId
            variant { id sku }
          }
        }
      }
    }
  }
}
`;

const ORDER_FULFILLMENTS_TRACKING_QUERY = /* GraphQL */ `
query OrderFulfillmentsTracking($orderId: ID!) {
  order(id: $orderId) {
    fulfillments(first: 50) {
      id
      status
      trackingInfo {
        company
        number
        url
      }
    }
  }
}
`;

const FULFILLMENT_CREATE_MUTATION = /* GraphQL */ `
mutation CreateFulfillment($fulfillment: FulfillmentInput!) {
  fulfillmentCreate(fulfillment: $fulfillment) {
    fulfillment {
      id
      status
      trackingInfo(first: 10) { company number url }
    }
    userErrors { field message }
  }
}
`;

const ORDER_SHIPPING_QUERY = /* GraphQL */ `
query OrderShippingInfo($orderId: ID!) {
  order(id: $orderId) {
    id
    name
    email
    phone
    shippingAddress {
      firstName
      lastName
      name
      company
      address1
      address2
      zip
      city
      province
      country
      countryCodeV2
      phone
    }
    shippingLines(first: 10, includeRemovals: true) {
      edges {
        node {
          id
          title
          isRemoved
          originalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
        }
      }
    }
    lineItems(first: 250) {
      nodes {
        id
        name
        title
        quantity
        sku
        variantTitle
        variant {
          id
          sku
        }
      }
    }
  }
}
`;

export async function fetchOrderIdByName(orderName: string) {
  const trimmed = orderName.trim();
  const nameQuery = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  const query = `name:${nameQuery}`;

  const { data, errors } = await shopifyGraphQL<{
    orders: { nodes: { id: string; name: string }[] };
  }>(ORDER_ID_BY_NAME_QUERY, { query });

  if (errors?.length) {
    throw new Error(`Shopify errors: ${JSON.stringify(errors)}`);
  }

  const order = data?.orders?.nodes?.[0];
  return order || null;
}

export async function fetchOrderFulfillmentMap(orderId: string) {
  const { data, errors } = await shopifyGraphQL<OrderFulfillmentMap>(
    ORDER_FULFILLMENT_MAP_QUERY,
    { orderId }
  );

  if (errors?.length) {
    throw new Error(`Shopify errors: ${JSON.stringify(errors)}`);
  }

  return data;
}

export async function orderHasTrackingNumber(orderId: string, trackingNumber: string) {
  const { data, errors } = await shopifyGraphQL<{
    order: {
      fulfillments: { id: string; status: string; trackingInfo: { number?: string | null }[] }[];
    } | null;
  }>(ORDER_FULFILLMENTS_TRACKING_QUERY, { orderId });

  if (errors?.length) {
    throw new Error(`Shopify errors: ${JSON.stringify(errors)}`);
  }

  const fulfillments = data?.order?.fulfillments ?? [];
  for (const fulfillment of fulfillments) {
    for (const info of fulfillment.trackingInfo || []) {
      if ((info?.number || "").trim() === trackingNumber) {
        return true;
      }
    }
  }

  return false;
}

type FulfillmentEventCreateResponse = {
  fulfillmentEventCreate: {
    fulfillmentEvent: { id: string; status: string; message?: string | null } | null;
    userErrors: { field?: string[] | null; message: string }[];
  };
};

const FULFILLMENT_EVENT_CREATE_MUTATION = /* GraphQL */ `
mutation FulfillmentEventCreate($fulfillmentEvent: FulfillmentEventInput!) {
  fulfillmentEventCreate(fulfillmentEvent: $fulfillmentEvent) {
    fulfillmentEvent {
      id
      status
      message
    }
    userErrors {
      field
      message
    }
  }
}
`;

export async function findFulfillmentIdByTrackingNumber(orderId: string, trackingNumber: string) {
  const trimmed = trackingNumber.trim();
  if (!trimmed) return null;
  const { data, errors } = await shopifyGraphQL<{
    order: {
      fulfillments: {
        id: string;
        status: string;
        trackingInfo: { number?: string | null; url?: string | null; company?: string | null }[];
      }[];
    } | null;
  }>(ORDER_FULFILLMENTS_TRACKING_QUERY, { orderId });

  if (errors?.length) {
    throw new Error(`Shopify errors: ${JSON.stringify(errors)}`);
  }

  const fulfillments = data?.order?.fulfillments ?? [];
  for (const fulfillment of fulfillments) {
    for (const info of fulfillment.trackingInfo || []) {
      if ((info?.number || "").trim() === trimmed) {
        return fulfillment.id;
      }
    }
  }

  return null;
}

export async function createFulfillmentEvent(input: {
  fulfillmentId: string;
  status: string;
  message?: string | null;
  happenedAt?: string | null;
  estimatedDeliveryAt?: string | null;
}) {
  const fulfillmentEvent: Record<string, any> = {
    fulfillmentId: input.fulfillmentId,
    status: input.status,
  };
  if (input.message) fulfillmentEvent.message = input.message;
  if (input.happenedAt) fulfillmentEvent.happenedAt = input.happenedAt;
  if (input.estimatedDeliveryAt) fulfillmentEvent.estimatedDeliveryAt = input.estimatedDeliveryAt;

  const { data, errors } = await shopifyGraphQL<FulfillmentEventCreateResponse>(
    FULFILLMENT_EVENT_CREATE_MUTATION,
    { fulfillmentEvent }
  );

  if (errors?.length) {
    throw new Error(`Shopify errors: ${JSON.stringify(errors)}`);
  }

  return data.fulfillmentEventCreate;
}

export function buildLineItemsByFulfillmentOrder(
  fulfillmentOrders: FulfillmentOrderNode[],
  dbItems: DbFulfillmentItem[],
  orderLineItems: OrderLineItemSummary[]
) {
  console.log("DEBUG: buildLineItems dbItems", dbItems);
  console.log("DEBUG: buildLineItems orderLineItems", orderLineItems);
  const unmatched: DbFulfillmentItem[] = [];
  const warnings: string[] = [];

  const requestedByKey = new Map<
    string,
    { remaining: number; items: DbFulfillmentItem[] }
  >();

  const requestedByTitle = new Map<
    string,
    { remaining: number; items: DbFulfillmentItem[]; sizeEU?: string | null }
  >();

  for (const item of dbItems) {
    const variantId = item.variantId?.trim() || null;
    const sku = item.sku?.trim() || null;
    const quantity = Number(item.quantity ?? 1) || 0;
    const key = variantId ? `variant:${variantId}` : sku ? `sku:${sku}` : null;
    const sizeKey = normalizeSize(item.sizeEU) || null;
    const normalizedTitle = normalizeTitle(item.title || "");
    const sizeToken = sizeKey ? normalizeTitle(sizeKey) : "";
    const titleKey =
      sizeToken && normalizedTitle.includes(sizeToken)
        ? normalizedTitle.replace(sizeToken, "").replace(/\s+/g, " ").trim()
        : normalizedTitle;

    if (quantity <= 0) {
      unmatched.push(item);
      continue;
    }

    if (titleKey) {
      const current = requestedByTitle.get(titleKey) || { remaining: 0, items: [], sizeEU: sizeKey };
      current.remaining += quantity;
      current.items.push(item);
      current.sizeEU = current.sizeEU || sizeKey;
      requestedByTitle.set(titleKey, current);
    }

    if (key) {
      const current = requestedByKey.get(key) || { remaining: 0, items: [] };
      current.remaining += quantity;
      current.items.push(item);
      requestedByKey.set(key, current);
    }
  }

  const isFulfillableFO = (fo: FulfillmentOrderNode) => {
    if (String(fo.status || "").toUpperCase() === "CLOSED") return false;
    if (fo.supportedActions?.length) {
      const canCreate = fo.supportedActions.some((a) => a.action === "CREATE_FULFILLMENT");
      if (!canCreate) return false;
    }
    const hasRemaining = (fo.lineItems?.nodes || []).some(
      (li) => Number(li.remainingQuantity ?? 0) > 0
    );
    return hasRemaining;
  };

  const fulfillableFOs = fulfillmentOrders.filter(isFulfillableFO);

  const grouped: Map<string, FulfillmentOrderLineItemInput[]> = new Map();

  const orderLineItemsByKey = new Map<string, OrderLineItemSummary>();
  for (const li of orderLineItems) {
    console.log("DEBUG: orderLineItem", { id: li.id, title: li.title, variantTitle: li.variantTitle, sku: li.sku, variantId: li.variantId, variant: (li as any).variant });
    const variantId = ((li as any).variant?.id?.trim() as string | undefined) || li.variantId?.trim() || null;
    const sku =
      ((li as any).variant?.sku?.trim() as string | undefined) ||
      li.variantSku?.trim() ||
      li.sku?.trim() ||
      null;
    if (variantId) orderLineItemsByKey.set(`variant:${variantId}`, li);
    if (sku) orderLineItemsByKey.set(`sku:${sku}`, li);
  }

  const foLineItemsByKey = new Map<string, FulfillmentOrderLineItemNode>();
  for (const fo of fulfillableFOs) {
    for (const lineItem of fo.lineItems?.nodes || []) {
      console.log("DEBUG: foLineItem", { fulfillmentOrderId: fo.id, lineItemId: lineItem.id, sku: lineItem.variant?.sku, variantId: lineItem.variant?.id, remaining: lineItem.remainingQuantity });
      const variantId = lineItem.variant?.id || null;
      const sku = lineItem.variant?.sku || null;
      if (variantId) foLineItemsByKey.set(`variant:${variantId}`, lineItem);
      if (sku) foLineItemsByKey.set(`sku:${sku}`, lineItem);
    }
  }

  // 1) Match by title + size (preferred)
  for (const [titleKey, request] of requestedByTitle.entries()) {
    if (request.remaining <= 0) continue;
    const sizeKey = request.sizeEU || null;

    const orderCandidates = orderLineItems.filter((li) => {
      const candidateTitle = normalizeTitle(li.title || li.name || "");
      return candidateTitle === titleKey;
    });

    let matchedOrderLine: OrderLineItemSummary | undefined;
    if (orderCandidates.length === 1) {
      matchedOrderLine = orderCandidates[0];
    } else if (orderCandidates.length > 1 && sizeKey) {
      matchedOrderLine = orderCandidates.find((li) => {
        const candidateSize = extractSizeFromOrderLineItem(li);
        return candidateSize === sizeKey;
      });
    }

    if (!matchedOrderLine && orderCandidates.length > 0 && sizeKey) {
      warnings.push(`Title matched but size mismatch for ${titleKey} (${sizeKey})`);
    }

    if (!matchedOrderLine) {
      continue;
    }

    const matchedVariantId =
      ((matchedOrderLine as any).variant?.id?.trim() as string | undefined) ||
      matchedOrderLine.variantId?.trim() ||
      null;
    const matchedSku =
      ((matchedOrderLine as any).variant?.sku?.trim() as string | undefined) ||
      matchedOrderLine.variantSku?.trim() ||
      matchedOrderLine.sku?.trim() ||
      null;
    const key = matchedVariantId ? `variant:${matchedVariantId}` : matchedSku ? `sku:${matchedSku}` : null;
    if (!key) continue;

    const foLineItem = foLineItemsByKey.get(key);
    if (!foLineItem) continue;

    for (const item of request.items) {
      const fo = fulfillableFOs.find((order) =>
        order.lineItems?.nodes?.some((node) => node.id === foLineItem.id)
      );
      if (!fo) continue;

      const remainingQty = Number(foLineItem.remainingQuantity ?? 0);
      if (remainingQty <= 0) continue;

      const qty = Math.min(remainingQty, request.remaining);
      request.remaining -= qty;

      if (qty > 0) {
        const list = grouped.get(fo.id) || [];
        list.push({ id: foLineItem.id, quantity: qty });
        grouped.set(fo.id, list);
      }
    }
  }

  // 2) Fallback to variantId/sku direct matches
  for (const fo of fulfillableFOs) {

    for (const lineItem of fo.lineItems?.nodes || []) {
      const variantId = lineItem.variant?.id || null;
      const sku = lineItem.variant?.sku || null;
      const variantKey = variantId ? `variant:${variantId}` : null;
      const skuKey = sku ? `sku:${sku}` : null;
      if (!variantKey && !skuKey) continue;

      const request =
        (variantKey ? requestedByKey.get(variantKey) : undefined) ||
        (skuKey ? requestedByKey.get(skuKey) : undefined);
      if (!request || request.remaining <= 0) continue;

      const remainingQty = Number(lineItem.remainingQuantity ?? 0);
      if (remainingQty <= 0) continue;

      const quantity = Math.min(remainingQty, request.remaining);
      request.remaining -= quantity;

      if (quantity > 0) {
        const list = grouped.get(fo.id) || [];
        list.push({ id: lineItem.id, quantity });
        grouped.set(fo.id, list);
      }
    }
  }

  for (const [key, req] of requestedByKey.entries()) {
    if (req.remaining > 0) {
      warnings.push(`Unfulfilled quantity for ${key}: ${req.remaining}`);
      unmatched.push(...req.items);
    }
  }

  for (const [key, req] of requestedByTitle.entries()) {
    if (req.remaining > 0) {
      warnings.push(`Unfulfilled quantity for title:${key}: ${req.remaining}`);
      unmatched.push(...req.items);
    }
  }

  const lineItemsByFulfillmentOrder: FulfillmentOrderLineItemsInput[] = [];
  for (const [fulfillmentOrderId, fulfillmentOrderLineItems] of grouped.entries()) {
    if (fulfillmentOrderLineItems.length > 0) {
      lineItemsByFulfillmentOrder.push({
        fulfillmentOrderId,
        fulfillmentOrderLineItems,
      });
    }
  }

  return { lineItemsByFulfillmentOrder, unmatched, warnings, fulfillableFOs };
}

export async function createFulfillment(fulfillment: FulfillmentInput) {
  const { data, errors } = await shopifyGraphQL<ShopifyFulfillmentCreateResponse>(
    FULFILLMENT_CREATE_MUTATION,
    { fulfillment }
  );

  if (errors?.length) {
    throw new Error(`Shopify errors: ${JSON.stringify(errors)}`);
  }

  return data;
}

type OrderShippingGraphQLResponse = {
  order:
    | (OrderShippingInfo & {
        shippingLines?: {
          edges?: Array<{
            node?: {
              id: string;
              title: string;
              isRemoved: boolean;
              originalPriceSet?: {
                shopMoney?: {
                  amount?: string;
                  currencyCode?: string;
                };
              };
            } | null;
          } | null>;
        };
      })
    | null;
};

export async function fetchOrderShippingInfo(orderId: string) {
  const { data, errors } = await shopifyGraphQL<OrderShippingGraphQLResponse>(
    ORDER_SHIPPING_QUERY,
    { orderId }
  );

  if (errors?.length) {
    throw new Error(`Shopify errors: ${JSON.stringify(errors)}`);
  }

  const order = data?.order;
  if (!order) return null;

  const shippingLines: ShippingLineInfo[] = (order.shippingLines?.edges ?? [])
    .map((edge) => edge?.node)
    .filter(
      (node): node is {
        id: string;
        title: string;
        isRemoved: boolean;
        originalPriceSet?: {
          shopMoney?: {
            amount?: string;
            currencyCode?: string;
          };
        };
      } => Boolean(node)
    )
    .map((node) => ({
      id: node.id,
      title: node.title,
      amount: node.originalPriceSet?.shopMoney?.amount || "0",
      currencyCode: node.originalPriceSet?.shopMoney?.currencyCode || "CHF",
      isRemoved: Boolean(node.isRemoved),
    }));

  return {
    ...order,
    shippingLines,
  };
}

function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSize(value?: string | null) {
  if (!value) return null;
  const size = extractEUSize(value);
  if (!size) return null;
  return size.toLowerCase();
}

function extractSizeFromOrderLineItem(li: OrderLineItemSummary) {
  return (
    normalizeSize(li.variantTitle) ||
    normalizeSize(li.name) ||
    normalizeSize(li.title) ||
    normalizeSize(li.sku) ||
    normalizeSize(li.variantSku)
  );
}

