import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { generateShopifyReturnLabel } from "@/shopify/returns/label";
import { parseStrictPublicOrderNumber } from "@/shopify/returns/publicOrderNumber";

export type ReturnFormReason =
  | "WRONG_SIZE"
  | "WRONG_ITEM"
  | "DAMAGED"
  | "SIZE_CHANGE"
  | "CHANGE_OF_MIND"
  | "DEFECTIVE_ITEM"
  | "WRONG_ITEM_RECEIVED"
  | "NON_CONFORMITY"
  | "OTHER";

export type ShopifyReturnRequestInput = {
  orderNumber: string;
  email?: string;
  customerProvidedEmail?: string;
  reason: ReturnFormReason | string;
  details: string;
  items?: Array<{
    fulfillmentLineItemId?: string;
    lineItemId?: string;
    sku?: string;
    quantity?: number;
    reason?: ReturnFormReason | string;
    details?: string;
  }>;
};

type ShopifyOrderNode = {
  id: string;
  name: string;
  email?: string | null;
  customer?: {
    id?: string | null;
    email?: string | null;
    defaultEmailAddress?: { emailAddress?: string | null } | null;
  } | null;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
};

type ReturnableLine = {
  fulfillmentLineItemId: string;
  quantity: number;
  title: string | null;
  sku: string | null;
  lineItemId: string | null;
  unitAmount: number | null;
  currencyCode: string | null;
};

type SelectedReturnLine = {
  line: ReturnableLine;
  quantity: number;
  reason: string;
  customerNote: string;
};

type NormalizedRequestedItem = {
  fulfillmentLineItemId: string | null;
  lineItemId: string | null;
  sku: string | null;
  quantity: number;
  reason: string | null;
  details: string | null;
};

export type ShopifyReturnableItem = {
  fulfillmentLineItemId: string;
  lineItemId: string | null;
  sku: string | null;
  title: string | null;
  quantity: number;
  unitAmount: number | null;
  currencyCode: string | null;
};

type ShopifyReturnUserError = {
  code?: string | null;
  field?: string[] | null;
  message?: string | null;
};

const ORDER_LOOKUP_QUERY = /* GraphQL */ `
query OrderLookupForReturn($first: Int!, $query: String!) {
  orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
    edges {
      node {
        id
        name
        email
        customer {
          id
          email
          defaultEmailAddress {
            emailAddress
          }
        }
        displayFinancialStatus
        displayFulfillmentStatus
      }
    }
  }
}
`;

const RETURNABLE_FULFILLMENTS_QUERY = /* GraphQL */ `
query ReturnableFulfillmentsForOrder($orderId: ID!, $first: Int!) {
  returnableFulfillments(orderId: $orderId, first: $first) {
    edges {
      node {
        id
        returnableFulfillmentLineItems(first: 100) {
          edges {
            node {
              quantity
              fulfillmentLineItem {
                id
                lineItem {
                  id
                  title
                  sku
                  originalUnitPriceSet {
                    shopMoney {
                      amount
                      currencyCode
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

const RETURN_REQUEST_MUTATION = /* GraphQL */ `
mutation ReturnRequestCreate($input: ReturnRequestInput!) {
  returnRequest(input: $input) {
    return {
      id
      name
      status
      order {
        id
        name
      }
    }
    userErrors {
      code
      field
      message
    }
  }
}
`;

const RETURN_APPROVE_MUTATION = /* GraphQL */ `
mutation ReturnApproveRequest($input: ReturnApproveRequestInput!) {
  returnApproveRequest(input: $input) {
    return {
      id
      name
      status
      reverseFulfillmentOrders(first: 10) {
        edges {
          node {
            id
          }
        }
      }
      order {
        id
        name
        customer {
          id
          email
          defaultEmailAddress {
            emailAddress
          }
        }
      }
    }
    userErrors {
      code
      field
      message
    }
  }
}
`;

const RETURN_REVERSE_FULFILLMENTS_QUERY = /* GraphQL */ `
query ReturnReverseFulfillmentOrders($id: ID!) {
  return(id: $id) {
    id
    reverseFulfillmentOrders(first: 10) {
      edges {
        node {
          id
        }
      }
    }
  }
}
`;

const REVERSE_DELIVERY_CREATE_MUTATION = /* GraphQL */ `
mutation CreateReverseDeliveryWithExternalLabel(
  $reverseFulfillmentOrderId: ID!
  $labelFileUrl: URL!
  $trackingNumber: String
  $trackingUrl: URL
  $notifyCustomer: Boolean!
) {
  reverseDeliveryCreateWithShipping(
    reverseFulfillmentOrderId: $reverseFulfillmentOrderId
    labelInput: { fileUrl: $labelFileUrl }
    reverseDeliveryLineItems: []
    trackingInput: { number: $trackingNumber, url: $trackingUrl }
    notifyCustomer: $notifyCustomer
  ) {
    reverseDelivery {
      id
      deliverable {
        ... on ReverseDeliveryShippingDeliverable {
          label {
            publicFileUrl
          }
          tracking {
            number
            url
          }
        }
      }
    }
    userErrors {
      code
      field
      message
    }
  }
}
`;

const RETURN_REASON_LABELS: Record<string, string> = {
  WRONG_SIZE: "Wrong size",
  WRONG_ITEM: "Wrong item",
  DAMAGED: "Damaged item",
  SIZE_CHANGE: "Changement de taille",
  CHANGE_OF_MIND: "Changement d'avis",
  DEFECTIVE_ITEM: "Article recu defectueux",
  WRONG_ITEM_RECEIVED: "Mauvais article recu",
  NON_CONFORMITY: "Non-conformite",
  OTHER: "Autre",
};

const RETURN_REASON_MAP: Record<string, string> = {
  WRONG_SIZE: "SIZE_TOO_SMALL",
  SIZE_CHANGE: "SIZE_TOO_SMALL",
  WRONG_ITEM: "WRONG_ITEM",
  WRONG_ITEM_RECEIVED: "WRONG_ITEM",
  DAMAGED: "DEFECTIVE",
  DEFECTIVE_ITEM: "DEFECTIVE",
  CHANGE_OF_MIND: "OTHER",
  NON_CONFORMITY: "OTHER",
  OTHER: "OTHER",
};

export class ShopifyReturnRequestError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "ShopifyReturnRequestError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function normalizeOrderNumber(value: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function assertStrictPublicOrderNumber(raw: string): string {
  const parsed = parseStrictPublicOrderNumber(raw);
  if (!parsed) {
    throw new ShopifyReturnRequestError(
      "INVALID_ORDER_NUMBER",
      "Order number must use format #1234 (hash + digits only).",
      400
    );
  }
  return parsed;
}

export function mapFormReasonToShopify(value: string): string {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized in RETURN_REASON_MAP) {
    return RETURN_REASON_MAP[normalized];
  }
  return RETURN_REASON_MAP["OTHER"];
}

function mapReasonLabel(value: string): string {
  const normalized = String(value ?? "").trim().toUpperCase();
  return RETURN_REASON_LABELS[normalized] ?? RETURN_REASON_LABELS["OTHER"];
}

function cleanEmail(value: string): string {
  return String(value ?? "").trim().toLowerCase();
}

function orderNodeEmail(node: ShopifyOrderNode) {
  return (
    node.customer?.defaultEmailAddress?.emailAddress ||
    node.customer?.email ||
    node.email ||
    ""
  );
}

function validateInput(input: ShopifyReturnRequestInput) {
  const orderNumber = assertStrictPublicOrderNumber(String(input.orderNumber ?? ""));
  const emailRaw = String(input.email ?? "").trim();
  const email = emailRaw ? cleanEmail(emailRaw) : null;
  const customerProvidedEmail = String(input.customerProvidedEmail ?? "").trim();
  const reason = String(input.reason ?? "").trim().toUpperCase();
  const details = String(input.details ?? "").trim();
  const requestedItems = normalizeRequestedItems(input.items);

  if (!orderNumber) {
    throw new ShopifyReturnRequestError(
      "VALIDATION_ERROR",
      "Missing orderNumber",
      400
    );
  }
  if (email && !email.includes("@")) {
    throw new ShopifyReturnRequestError(
      "VALIDATION_ERROR",
      "Invalid email",
      400
    );
  }
  if (!details) {
    throw new ShopifyReturnRequestError(
      "VALIDATION_ERROR",
      "Missing details",
      400
    );
  }
  if (!reason) {
    throw new ShopifyReturnRequestError(
      "VALIDATION_ERROR",
      "Missing reason",
      400
    );
  }

  return { orderNumber, email, customerProvidedEmail, reason, details, requestedItems };
}

function normalizeRequestedItems(input: ShopifyReturnRequestInput["items"]): NormalizedRequestedItem[] {
  if (!Array.isArray(input)) return [];
  const normalized: NormalizedRequestedItem[] = [];
  for (const item of input) {
    const fulfillmentLineItemId = String(item?.fulfillmentLineItemId ?? "").trim() || null;
    const lineItemId = String(item?.lineItemId ?? "").trim() || null;
    const sku = String(item?.sku ?? "").trim() || null;
    const quantityRaw = Number(item?.quantity ?? 1);
    const quantity = Number.isFinite(quantityRaw) ? Math.max(0, Math.floor(quantityRaw)) : 0;
    if (!fulfillmentLineItemId && !lineItemId && !sku) continue;
    if (quantity <= 0) {
      throw new ShopifyReturnRequestError(
        "VALIDATION_ERROR",
        "Each selected item quantity must be at least 1",
        400
      );
    }
    const reason = String(item?.reason ?? "").trim().toUpperCase() || null;
    const details = String(item?.details ?? "").trim() || null;
    normalized.push({ fulfillmentLineItemId, lineItemId, sku, quantity, reason, details });
  }
  return normalized;
}

async function findOrderByNumberAndEmail(orderNumber: string, email?: string | null) {
  const query = `name:${orderNumber}`;
  const { data, errors } = await shopifyGraphQL<{
    orders: { edges: Array<{ node: ShopifyOrderNode }> };
  }>(ORDER_LOOKUP_QUERY, { first: 5, query });

  if (errors?.length) {
    throw new ShopifyReturnRequestError(
      "SERVER_ERROR",
      "Shopify order lookup failed",
      502,
      errors
    );
  }

  const nodes = data?.orders?.edges?.map((edge) => edge.node) ?? [];
  if (!nodes.length) {
    throw new ShopifyReturnRequestError(
      "ORDER_NOT_FOUND",
      "Order not found",
      404
    );
  }

  const exactNameNodes = nodes.filter((node) => normalizeOrderNumber(node.name) === orderNumber);
  const candidateNodes = exactNameNodes.length > 0 ? exactNameNodes : nodes;

  if (!email) {
    return candidateNodes[0];
  }

  const emailMatch = candidateNodes.find((node) => {
    const anyEmail = cleanEmail(orderNodeEmail(node));
    const orderEmail = cleanEmail(node.email ?? "");
    const customerEmail = cleanEmail(node.customer?.email ?? "");
    const defaultEmail = cleanEmail(node.customer?.defaultEmailAddress?.emailAddress ?? "");
    return email === anyEmail || email === orderEmail || email === customerEmail || email === defaultEmail;
  });

  if (!emailMatch) {
    throw new ShopifyReturnRequestError(
      "EMAIL_MISMATCH",
      "Order found but email does not match",
      403
    );
  }

  return emailMatch;
}

async function listReturnableLineItems(orderId: string): Promise<ReturnableLine[]> {
  const { data, errors } = await shopifyGraphQL<{
    returnableFulfillments: {
      edges: Array<{
        node: {
          returnableFulfillmentLineItems: {
            edges: Array<{
              node: {
                quantity: number;
                fulfillmentLineItem: {
                  id: string;
                  lineItem?: {
                    id?: string | null;
                    title?: string | null;
                    sku?: string | null;
                    originalUnitPriceSet?: {
                      shopMoney?: { amount?: string | null; currencyCode?: string | null } | null;
                    } | null;
                  } | null;
                };
              };
            }>;
          };
        };
      }>;
    };
  }>(RETURNABLE_FULFILLMENTS_QUERY, { orderId, first: 20 });

  if (errors?.length) {
    throw new ShopifyReturnRequestError(
      "SERVER_ERROR",
      "Shopify returnable items lookup failed",
      502,
      errors
    );
  }

  const lines: ReturnableLine[] = [];
  const fulfillments = data?.returnableFulfillments?.edges ?? [];
  for (const fulfillment of fulfillments) {
    const items = fulfillment.node.returnableFulfillmentLineItems.edges ?? [];
    for (const edge of items) {
      const fulfillmentLineItemId = edge.node.fulfillmentLineItem.id;
      const quantityRaw = Number(edge.node.quantity ?? 0);
      const quantity = Number.isFinite(quantityRaw) ? Math.max(0, Math.floor(quantityRaw)) : 0;
      if (!fulfillmentLineItemId || quantity <= 0) continue;

      const lineItem = edge.node.fulfillmentLineItem.lineItem;
      const amountRaw = Number(lineItem?.originalUnitPriceSet?.shopMoney?.amount ?? NaN);
      lines.push({
        fulfillmentLineItemId,
        quantity,
        title: lineItem?.title ?? null,
        sku: lineItem?.sku ?? null,
        lineItemId: lineItem?.id ?? null,
        unitAmount: Number.isFinite(amountRaw) ? amountRaw : null,
        currencyCode: lineItem?.originalUnitPriceSet?.shopMoney?.currencyCode ?? null,
      });
    }
  }

  if (!lines.length) {
    throw new ShopifyReturnRequestError(
      "NO_RETURNABLE_ITEMS",
      "No returnable items available on this order",
      422
    );
  }

  return lines;
}

function pickRequestedLines(
  allLines: ReturnableLine[],
  requestedItems: NormalizedRequestedItem[],
  fallbackReason: string,
  fallbackDetails: string
): SelectedReturnLine[] {
  if (requestedItems.length === 0) {
    return allLines.map((line) => ({
      line,
      quantity: line.quantity,
      reason: fallbackReason,
      customerNote: fallbackDetails,
    }));
  }

  const remainingByLine = new Map<string, number>();
  for (const line of allLines) {
    remainingByLine.set(line.fulfillmentLineItemId, line.quantity);
  }

  const selected = new Map<string, SelectedReturnLine>();

  const addSelection = (line: ReturnableLine, qty: number, reason: string, customerNote: string) => {
    const existing = selected.get(line.fulfillmentLineItemId);
    if (existing) {
      existing.quantity += qty;
      return;
    }
    selected.set(line.fulfillmentLineItemId, {
      line,
      quantity: qty,
      reason,
      customerNote,
    });
  };

  for (const requested of requestedItems) {
    const requestedReason = requested.reason
      ? mapFormReasonToShopify(requested.reason)
      : fallbackReason;
    const requestedNote = requested.details || fallbackDetails;
    const targetQuantity = requested.quantity;

    let candidates = allLines;
    if (requested.fulfillmentLineItemId) {
      candidates = allLines.filter(
        (line) => line.fulfillmentLineItemId === requested.fulfillmentLineItemId
      );
    } else if (requested.lineItemId) {
      candidates = allLines.filter((line) => line.lineItemId === requested.lineItemId);
    } else if (requested.sku) {
      const sku = requested.sku.toLowerCase();
      candidates = allLines.filter((line) => String(line.sku ?? "").toLowerCase() === sku);
    }

    if (candidates.length === 0) {
      throw new ShopifyReturnRequestError(
        "ITEM_NOT_RETURNABLE",
        "One selected item is not returnable on this order",
        422,
        requested
      );
    }

    let remaining = targetQuantity;
    for (const candidate of candidates) {
      const available = remainingByLine.get(candidate.fulfillmentLineItemId) ?? 0;
      if (available <= 0) continue;
      const useQty = Math.min(available, remaining);
      if (useQty <= 0) continue;
      remainingByLine.set(candidate.fulfillmentLineItemId, available - useQty);
      addSelection(candidate, useQty, requestedReason, requestedNote);
      remaining -= useQty;
      if (remaining <= 0) break;
    }

    if (remaining > 0) {
      throw new ShopifyReturnRequestError(
        "ITEM_QTY_EXCEEDS_RETURNABLE",
        "Selected quantity exceeds returnable quantity",
        422,
        requested
      );
    }
  }

  const selectedLines = Array.from(selected.values()).filter((entry) => entry.quantity > 0);
  if (!selectedLines.length) {
    throw new ShopifyReturnRequestError(
      "VALIDATION_ERROR",
      "Select at least one returnable item",
      400
    );
  }
  return selectedLines;
}

function assertNoReturnUserErrors(
  payloadName: string,
  userErrors: ShopifyReturnUserError[] | undefined
) {
  if (!userErrors?.length) return;
  throw new ShopifyReturnRequestError(
    "SHOPIFY_USER_ERROR",
    `${payloadName} failed`,
    422,
    userErrors
  );
}

async function afterReturnOpened(_returnId: string) {
  return;
}

type CreateAndOpenResult = {
  success: true;
  returnId: string;
  status: string;
  orderId: string;
  name: string;
  returnLabelUrl?: string | null;
  returnTrackingNumber?: string | null;
  reverseDeliveryId?: string | null;
};

type ReturnableItemsResult = {
  success: true;
  orderId: string;
  orderName: string;
  items: ShopifyReturnableItem[];
};

export async function getReturnableItemsForOrder(input: {
  orderNumber: string;
  email?: string;
}): Promise<ReturnableItemsResult> {
  const orderNumber = assertStrictPublicOrderNumber(String(input.orderNumber ?? ""));
  const emailRaw = String(input.email ?? "").trim();
  const email = emailRaw ? cleanEmail(emailRaw) : null;
  if (!email) {
    throw new ShopifyReturnRequestError("VALIDATION_ERROR", "Missing email", 400);
  }
  if (!email.includes("@")) {
    throw new ShopifyReturnRequestError("VALIDATION_ERROR", "Invalid email", 400);
  }

  const order = await findOrderByNumberAndEmail(orderNumber, email);
  const lines = await listReturnableLineItems(order.id);
  return {
    success: true,
    orderId: order.id,
    orderName: order.name,
    items: lines.map((line) => ({
      fulfillmentLineItemId: line.fulfillmentLineItemId,
      lineItemId: line.lineItemId,
      sku: line.sku,
      title: line.title,
      quantity: line.quantity,
      unitAmount: line.unitAmount,
      currencyCode: line.currencyCode,
    })),
  };
}

export async function createAndOpenReturnFromFormData(
  input: ShopifyReturnRequestInput,
  options: { publicBaseUrl?: string } = {}
): Promise<CreateAndOpenResult> {
  const validated = validateInput(input);
  const order = await findOrderByNumberAndEmail(validated.orderNumber, validated.email);
  const allReturnableLines = await listReturnableLineItems(order.id);
  const defaultReason = mapFormReasonToShopify(validated.reason);
  const selectedLines = pickRequestedLines(
    allReturnableLines,
    validated.requestedItems,
    defaultReason,
    validated.details
  );

  const returnLineItems = selectedLines.map((entry) => ({
    fulfillmentLineItemId: entry.line.fulfillmentLineItemId,
    quantity: entry.quantity,
    returnReason: entry.reason,
    customerNote: entry.customerNote,
  }));

  const requestResult = await shopifyGraphQL<{
    returnRequest: {
      return?: { id: string; name: string; status: string; order?: { id: string; name: string } | null } | null;
      userErrors: ShopifyReturnUserError[];
    };
  }>(RETURN_REQUEST_MUTATION, {
    input: {
      orderId: order.id,
      returnLineItems,
    },
  });

  if (requestResult.errors?.length) {
    throw new ShopifyReturnRequestError(
      "SERVER_ERROR",
      "Shopify returnRequest failed",
      502,
      requestResult.errors
    );
  }

  assertNoReturnUserErrors("returnRequest", requestResult.data?.returnRequest?.userErrors);
  const requestedReturn = requestResult.data?.returnRequest?.return;
  if (!requestedReturn?.id) {
    throw new ShopifyReturnRequestError(
      "SERVER_ERROR",
      "Shopify returnRequest returned no return id",
      502
    );
  }

  const approveResult = await shopifyGraphQL<{
    returnApproveRequest: {
      return?: {
        id: string;
        name: string;
        status: string;
        reverseFulfillmentOrders?: { edges?: Array<{ node?: { id?: string | null } | null }> } | null;
        order?: {
          id: string;
          name: string;
          customer?: {
            id?: string | null;
            email?: string | null;
            defaultEmailAddress?: { emailAddress?: string | null } | null;
          } | null;
        } | null;
      } | null;
      userErrors: ShopifyReturnUserError[];
    };
  }>(RETURN_APPROVE_MUTATION, {
    input: { id: requestedReturn.id, notifyCustomer: false },
  });

  if (approveResult.errors?.length) {
    throw new ShopifyReturnRequestError(
      "SERVER_ERROR",
      "Shopify returnApproveRequest failed",
      502,
      approveResult.errors
    );
  }

  assertNoReturnUserErrors(
    "returnApproveRequest",
    approveResult.data?.returnApproveRequest?.userErrors
  );

  const approvedReturn = approveResult.data?.returnApproveRequest?.return;
  if (!approvedReturn?.id) {
    throw new ShopifyReturnRequestError(
      "SERVER_ERROR",
      "Shopify returnApproveRequest returned no return id",
      502
    );
  }
  if (String(approvedReturn.status).toUpperCase() !== "OPEN") {
    throw new ShopifyReturnRequestError(
      "SHOPIFY_USER_ERROR",
      "Return was created but not opened",
      422,
      { returnId: approvedReturn.id, status: approvedReturn.status }
    );
  }

  let reverseFulfillmentOrderId =
    approvedReturn.reverseFulfillmentOrders?.edges?.[0]?.node?.id ?? null;
  if (!reverseFulfillmentOrderId) {
    const reverseResult = await shopifyGraphQL<{
      return?: { reverseFulfillmentOrders?: { edges?: Array<{ node?: { id?: string | null } | null }> } | null } | null;
    }>(RETURN_REVERSE_FULFILLMENTS_QUERY, { id: approvedReturn.id });
    if (reverseResult.errors?.length) {
      throw new ShopifyReturnRequestError(
        "SERVER_ERROR",
        "Failed to fetch reverse fulfillment order",
        502,
        reverseResult.errors
      );
    }
    reverseFulfillmentOrderId =
      reverseResult.data?.return?.reverseFulfillmentOrders?.edges?.[0]?.node?.id ?? null;
  }
  if (!reverseFulfillmentOrderId) {
    throw new ShopifyReturnRequestError(
      "SERVER_ERROR",
      "Missing reverse fulfillment order on approved return",
      502
    );
  }

  const publicBaseUrl = String(options.publicBaseUrl || "").trim();
  const label = await generateShopifyReturnLabel({
    reference: approvedReturn.name || validated.orderNumber,
    publicBaseUrl,
  });

  const reverseDeliveryResult = await shopifyGraphQL<{
    reverseDeliveryCreateWithShipping: {
      reverseDelivery?: {
        id?: string | null;
        deliverable?: {
          label?: { publicFileUrl?: string | null } | null;
          tracking?: { number?: string | null; url?: string | null } | null;
        } | null;
      } | null;
      userErrors: ShopifyReturnUserError[];
    };
  }>(REVERSE_DELIVERY_CREATE_MUTATION, {
    reverseFulfillmentOrderId,
    labelFileUrl: label.labelPublicUrl,
    trackingNumber: label.trackingNumber,
    trackingUrl: label.trackingUrl,
    notifyCustomer: true,
  });
  if (reverseDeliveryResult.errors?.length) {
    throw new ShopifyReturnRequestError(
      "SERVER_ERROR",
      "Shopify reverseDeliveryCreateWithShipping failed",
      502,
      reverseDeliveryResult.errors
    );
  }
  assertNoReturnUserErrors(
    "reverseDeliveryCreateWithShipping",
    reverseDeliveryResult.data?.reverseDeliveryCreateWithShipping?.userErrors
  );
  const reverseDelivery =
    reverseDeliveryResult.data?.reverseDeliveryCreateWithShipping?.reverseDelivery;
  if (!reverseDelivery?.id) {
    throw new ShopifyReturnRequestError(
      "SERVER_ERROR",
      "Reverse delivery was not created",
      502
    );
  }

  const totalAmount = selectedLines.reduce((sum, entry) => {
    if (entry.line.unitAmount == null) return sum;
    return sum + entry.line.unitAmount * entry.quantity;
  }, 0);
  const returnAmount = Number.isFinite(totalAmount) ? Number(totalAmount.toFixed(2)) : 0;
  const currency = selectedLines.find((entry) => entry.line.currencyCode)?.line.currencyCode ?? "CHF";
  const firstLine = selectedLines[0]?.line;
  const customerId =
    approvedReturn.order?.customer?.id || order.customer?.id || null;
  const customerEmail = orderNodeEmail(order);
  const customerEmailComment = validated.customerProvidedEmail
    ? `Customer declared order email: ${validated.customerProvidedEmail}`
    : null;

  await prisma.marketplaceReturn.upsert({
    where: {
      platform_externalReturnId: {
        platform: "shopify",
        externalReturnId: approvedReturn.id,
      },
    },
    create: {
      platform: "shopify",
      externalReturnId: approvedReturn.id,
      externalOrderId: order.name || order.id,
      externalOrderLineId: firstLine?.fulfillmentLineItemId ?? null,
      productId: firstLine?.lineItemId ?? null,
      productTitle:
        selectedLines.length > 1
          ? `${firstLine?.title ?? "Item"} (+${selectedLines.length - 1} more)`
          : firstLine?.title ?? null,
      sku: firstLine?.sku ?? null,
      returnLabelNumber: label.trackingNumber,
      returnAmount,
      currency,
      returnReasonCode: String(validated.reason).toUpperCase(),
      returnReasonLabel: mapReasonLabel(validated.reason),
      miraklStatus: approvedReturn.status,
      localStatus: "pending_receipt",
      processStep: "pending",
      syncedAt: new Date(),
      quantity: selectedLines.reduce((sum, entry) => sum + entry.quantity, 0),
      apiSource: "shopify-admin-graphql",
      rawJson: {
        order: {
          id: order.id,
          name: order.name,
          email: customerEmail || null,
          customerId,
        },
        return: approvedReturn,
        reverseFulfillmentOrderId,
        reverseDelivery: {
          id: reverseDelivery.id,
          labelPublicFileUrl:
            reverseDelivery.deliverable?.label?.publicFileUrl || label.labelPublicUrl,
          trackingNumber:
            reverseDelivery.deliverable?.tracking?.number || label.trackingNumber,
          trackingUrl:
            reverseDelivery.deliverable?.tracking?.url || label.trackingUrl,
        },
        generatedLabel: {
          key: label.labelKey,
          localPath: label.filePath,
          url: label.labelPublicUrl,
          mimeType: label.mimeType,
        },
        form: {
          reason: String(validated.reason).toUpperCase(),
          details: validated.details,
          customerProvidedEmail: validated.customerProvidedEmail || null,
          comment: customerEmailComment,
        },
        swissPost: label.swissResponse,
        lineItems: selectedLines.map((entry) => ({
          ...entry.line,
          selectedQuantity: entry.quantity,
          selectedReason: entry.reason,
          selectedNote: entry.customerNote,
        })),
      },
      auditLogJson: [
        {
          at: new Date().toISOString(),
          step: "shopify_return_auto_open",
          ok: true,
          requestReturnId: requestedReturn.id,
          status: approvedReturn.status,
        },
        {
          at: new Date().toISOString(),
          step: "shopify_reverse_delivery_label_created",
          ok: true,
          reverseDeliveryId: reverseDelivery.id,
          reverseFulfillmentOrderId,
          trackingNumber: label.trackingNumber,
          labelPublicUrl: label.labelPublicUrl,
          customerProvidedEmail: validated.customerProvidedEmail || null,
        },
      ],
    },
    update: {
      externalOrderId: order.name || order.id,
      externalOrderLineId: firstLine?.fulfillmentLineItemId ?? null,
      productId: firstLine?.lineItemId ?? null,
      productTitle:
        selectedLines.length > 1
          ? `${firstLine?.title ?? "Item"} (+${selectedLines.length - 1} more)`
          : firstLine?.title ?? null,
      sku: firstLine?.sku ?? null,
      returnLabelNumber: label.trackingNumber,
      returnAmount,
      currency,
      returnReasonCode: String(validated.reason).toUpperCase(),
      returnReasonLabel: mapReasonLabel(validated.reason),
      miraklStatus: approvedReturn.status,
      localStatus: "pending_receipt",
      processStep: "pending",
      syncedAt: new Date(),
      quantity: selectedLines.reduce((sum, entry) => sum + entry.quantity, 0),
      apiSource: "shopify-admin-graphql",
      rawJson: {
        order: {
          id: order.id,
          name: order.name,
          email: customerEmail || null,
          customerId,
        },
        return: approvedReturn,
        reverseFulfillmentOrderId,
        reverseDelivery: {
          id: reverseDelivery.id,
          labelPublicFileUrl:
            reverseDelivery.deliverable?.label?.publicFileUrl || label.labelPublicUrl,
          trackingNumber:
            reverseDelivery.deliverable?.tracking?.number || label.trackingNumber,
          trackingUrl:
            reverseDelivery.deliverable?.tracking?.url || label.trackingUrl,
        },
        generatedLabel: {
          key: label.labelKey,
          localPath: label.filePath,
          url: label.labelPublicUrl,
          mimeType: label.mimeType,
        },
        form: {
          reason: String(validated.reason).toUpperCase(),
          details: validated.details,
          customerProvidedEmail: validated.customerProvidedEmail || null,
          comment: customerEmailComment,
        },
        swissPost: label.swissResponse,
        lineItems: selectedLines.map((entry) => ({
          ...entry.line,
          selectedQuantity: entry.quantity,
          selectedReason: entry.reason,
          selectedNote: entry.customerNote,
        })),
      },
      failureMessage: null,
    },
  });

  await afterReturnOpened(approvedReturn.id);

  return {
    success: true,
    returnId: approvedReturn.id,
    status: approvedReturn.status,
    orderId: order.id,
    name: approvedReturn.name ?? approvedReturn.id,
    returnLabelUrl:
      reverseDelivery.deliverable?.label?.publicFileUrl || label.labelPublicUrl,
    returnTrackingNumber:
      reverseDelivery.deliverable?.tracking?.number || label.trackingNumber,
    reverseDeliveryId: reverseDelivery.id || null,
  };
}
