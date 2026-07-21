import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import {
  ShopifyReturnRequestError,
} from "@/shopify/returns/createAndOpenReturn";
import { generateShopifyReturnLabel } from "@/shopify/returns/label";

type ShopifyReturnUserError = {
  code?: string | null;
  field?: string[] | null;
  message?: string | null;
};

export type RequestedShopifyReturnLine = {
  id: string;
  title: string;
  sku: string | null;
  variantTitle: string | null;
  quantity: number;
  unitAmount: number | null;
  currencyCode: string | null;
  returnReason: string | null;
  returnReasonLabel: string | null;
  customerNote: string | null;
  restockingFeePercent: number | null;
  restockingFeeAmount: number | null;
};

export type RequestedShopifyReturn = {
  returnId: string;
  returnName: string;
  status: string;
  createdAt: string | null;
  orderId: string;
  orderName: string;
  lineItems: RequestedShopifyReturnLine[];
  totalAmount: number | null;
  currency: string;
  alreadyTracked: boolean;
};

type AcceptRequestedResult = {
  success: true;
  returnId: string;
  status: string;
  orderId: string;
  name: string;
  returnLabelUrl?: string | null;
  returnTrackingNumber?: string | null;
  reverseDeliveryId?: string | null;
};

const SHOPIFY_ACTIVE_RETURN_ORDER_QUERY =
  "return_status:return_requested OR return_status:in_progress";

const TERMINAL_SHOPIFY_RETURN_STATUSES = new Set([
  "CLOSED",
  "DECLINED",
  "CANCELED",
  "CANCELLED",
]);

const RETURN_LINE_LIST_FIELDS = /* GraphQL */ `
  returnLineItems(first: 10) {
    edges {
      node {
        ... on ReturnLineItem {
          id
          quantity
          customerNote
          restockingFee {
            percentage
            amountSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
          returnReasonDefinition {
            handle
            name
          }
          fulfillmentLineItem {
            lineItem {
              title
              sku
              variantTitle
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
`;

const RETURN_LINE_SYNC_FIELDS = /* GraphQL */ `
  returnLineItems(first: 20) {
    edges {
      node {
        ... on ReturnLineItem {
          id
          quantity
          customerNote
          restockingFee {
            percentage
            amountSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
          returnReasonDefinition {
            handle
            name
          }
          fulfillmentLineItem {
            lineItem {
              id
              title
              name
              sku
              variantTitle
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
`;

const REQUESTED_RETURNS_ORDERS_QUERY = /* GraphQL */ `
query RequestedReturnsOrders($first: Int!, $query: String!, $after: String) {
  orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
    pageInfo {
      hasNextPage
      endCursor
    }
    edges {
      node {
        id
        name
        returnStatus
        returns(first: 5) {
          edges {
            node {
              id
              name
              status
              createdAt
              reverseFulfillmentOrders(first: 1) {
                edges {
                  node {
                    id
                  }
                }
              }
              ${RETURN_LINE_LIST_FIELDS}
            }
          }
        }
      }
    }
  }
}
`;

const SHOPIFY_RETURNS_SYNC_ORDERS_QUERY = /* GraphQL */ `
query ShopifyReturnsSyncOrders($first: Int!, $query: String!, $after: String) {
  orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
    pageInfo {
      hasNextPage
      endCursor
    }
    edges {
      node {
        id
        name
        returnStatus
        email
        customer {
          id
          defaultEmailAddress {
            emailAddress
          }
        }
        returns(first: 10) {
          edges {
            node {
              id
              name
              status
              createdAt
              reverseFulfillmentOrders(first: 3) {
                edges {
                  node {
                    id
                    reverseDeliveries(first: 3) {
                      edges {
                        node {
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
                      }
                    }
                  }
                }
              }
              ${RETURN_LINE_SYNC_FIELDS}
            }
          }
        }
      }
    }
  }
}
`;

const RETURN_DETAIL_FOR_ACCEPT_QUERY = /* GraphQL */ `
query ReturnDetailForAccept($id: ID!) {
  return(id: $id) {
    id
    name
    status
    createdAt
    returnLineItems(first: 50) {
      edges {
        node {
          ... on ReturnLineItem {
            id
            quantity
            customerNote
            restockingFee {
              percentage
              amountSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
            }
            returnReasonDefinition {
              handle
              name
            }
            fulfillmentLineItem {
              id
              lineItem {
                id
                title
                name
                sku
                variantTitle
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
    order {
      id
      name
      email
      customer {
        id
        defaultEmailAddress {
          emailAddress
        }
      }
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

function mapReturnLine(
  node: any
): RequestedShopifyReturnLine {
  const lineItem = node?.fulfillmentLineItem?.lineItem;
  const money = lineItem?.originalUnitPriceSet?.shopMoney;
  const restockMoney = node?.restockingFee?.amountSet?.shopMoney;
  const reasonDef = node?.returnReasonDefinition;
  return {
    id: String(node?.id || ""),
    title: String(lineItem?.title || lineItem?.name || "Item"),
    sku: lineItem?.sku ?? null,
    variantTitle: lineItem?.variantTitle ?? null,
    quantity: Number(node?.quantity ?? 0),
    unitAmount: money?.amount != null ? Number(money.amount) : null,
    currencyCode: money?.currencyCode ?? null,
    returnReason: reasonDef?.handle ?? null,
    returnReasonLabel: reasonDef?.name ?? null,
    customerNote: node?.customerNote ?? null,
    restockingFeePercent:
      node?.restockingFee?.percentage != null
        ? Number(node.restockingFee.percentage)
        : null,
    restockingFeeAmount:
      restockMoney?.amount != null ? Number(restockMoney.amount) : null,
  };
}

function buildRequestedReturn(
  returnNode: any,
  orderNode: { id: string; name: string },
  trackedIds: Set<string>
): RequestedShopifyReturn | null {
  const status = String(returnNode?.status || "").toUpperCase();
  if (status !== "REQUESTED") {
    return null;
  }

  const hasReverseFulfillment =
    (returnNode?.reverseFulfillmentOrders?.edges?.length ?? 0) > 0;
  if (hasReverseFulfillment) {
    return null;
  }

  const returnId = String(returnNode.id || "");
  if (trackedIds.has(returnId)) {
    return null;
  }

  const lineItems: RequestedShopifyReturnLine[] =
    returnNode?.returnLineItems?.edges
      ?.map((edge: any) => mapReturnLine(edge?.node))
      .filter((line: RequestedShopifyReturnLine) => Boolean(line.id)) ?? [];
  if (!lineItems.length) return null;

  const currency =
    lineItems.find((line: RequestedShopifyReturnLine) => line.currencyCode)?.currencyCode ??
    "CHF";
  const totalAmount = lineItems.reduce((sum: number, line: RequestedShopifyReturnLine) => {
    if (line.unitAmount == null) return sum;
    return sum + line.unitAmount * line.quantity;
  }, 0);

  return {
    returnId,
    returnName: String(returnNode.name || returnId),
    status,
    createdAt: returnNode.createdAt ?? null,
    orderId: orderNode.id,
    orderName: orderNode.name,
    lineItems,
    totalAmount: Number.isFinite(totalAmount) ? Number(totalAmount.toFixed(2)) : null,
    currency,
    alreadyTracked: false,
  };
}

function hasReverseFulfillment(returnNode: any): boolean {
  return (returnNode?.reverseFulfillmentOrders?.edges?.length ?? 0) > 0;
}

function extractReverseDeliveryFromReturn(returnNode: any): {
  reverseFulfillmentOrderId: string | null;
  reverseDeliveryId: string | null;
  labelPublicUrl: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
} {
  for (const rfoEdge of returnNode?.reverseFulfillmentOrders?.edges ?? []) {
    const rfoId = String(rfoEdge?.node?.id || "").trim();
    for (const deliveryEdge of rfoEdge?.node?.reverseDeliveries?.edges ?? []) {
      const deliverable = deliveryEdge?.node?.deliverable;
      const trackingNumber = String(deliverable?.tracking?.number || "").trim() || null;
      const labelPublicUrl = String(deliverable?.label?.publicFileUrl || "").trim() || null;
      const trackingUrl = String(deliverable?.tracking?.url || "").trim() || null;
      if (trackingNumber || labelPublicUrl || trackingUrl) {
        return {
          reverseFulfillmentOrderId: rfoId || null,
          reverseDeliveryId: String(deliveryEdge?.node?.id || "").trim() || null,
          labelPublicUrl,
          trackingNumber,
          trackingUrl,
        };
      }
    }
    if (rfoId) {
      return {
        reverseFulfillmentOrderId: rfoId,
        reverseDeliveryId: null,
        labelPublicUrl: null,
        trackingNumber: null,
        trackingUrl: null,
      };
    }
  }
  return {
    reverseFulfillmentOrderId: null,
    reverseDeliveryId: null,
    labelPublicUrl: null,
    trackingNumber: null,
    trackingUrl: null,
  };
}

function shouldUpsertShopifyReturnForSync(
  returnNode: any,
  existing: { localStatus: string } | null
): boolean {
  const status = String(returnNode?.status || "").toUpperCase();
  if (TERMINAL_SHOPIFY_RETURN_STATUSES.has(status)) return false;
  if (existing?.localStatus === "completed") return false;
  if (status === "OPEN") return true;
  if (status === "REQUESTED" && hasReverseFulfillment(returnNode)) return true;
  return false;
}

async function fetchActiveReturnOrdersPaginated(options: {
  graphqlQuery: string;
  query: string;
  pageSize: number;
  maxPages: number;
  errorMessage: string;
}): Promise<Array<{ node: any }>> {
  const edges: Array<{ node: any }> = [];
  let after: string | undefined;

  for (let page = 0; page < options.maxPages; page += 1) {
    const variables: {
      first: number;
      query: string;
      after?: string;
    } = {
      first: options.pageSize,
      query: options.query,
    };
    if (after) variables.after = after;

    const result: Awaited<
      ReturnType<
        typeof shopifyGraphQL<{
          orders: {
            pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
            edges: Array<{ node: any }>;
          };
        }>
      >
    > = await shopifyGraphQL(options.graphqlQuery, variables);

    if (result.errors?.length) {
      throw new ShopifyReturnRequestError(
        "SERVER_ERROR",
        options.errorMessage,
        502,
        result.errors
      );
    }

    const batch = result.data?.orders?.edges ?? [];
    edges.push(...batch);

    const pageInfo = result.data?.orders?.pageInfo;
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
    after = pageInfo.endCursor;
  }

  return edges;
}


export async function syncShopifyReturnsFromAdmin(options: {
  limit?: number;
} = {}): Promise<{
  success: true;
  upserted: number;
  requestedCount: number;
  syncedAt: string;
}> {
  const pageSize = Math.min(Math.max(options.limit ?? 12, 1), 20);
  const orderEdges = await fetchActiveReturnOrdersPaginated({
    graphqlQuery: SHOPIFY_RETURNS_SYNC_ORDERS_QUERY,
    query: SHOPIFY_ACTIVE_RETURN_ORDER_QUERY,
    pageSize,
    maxPages: 8,
    errorMessage: "Failed to sync Shopify returns",
  });
  const syncedAt = new Date().toISOString();
  let upserted = 0;
  let requestedCount = 0;

  const candidateReturnIds: string[] = [];
  for (const edge of orderEdges) {
    for (const returnEdge of edge?.node?.returns?.edges ?? []) {
      const returnId = String(returnEdge?.node?.id || "").trim();
      if (returnId) candidateReturnIds.push(returnId);
    }
  }

  const existingRows = candidateReturnIds.length
    ? await prisma.marketplaceReturn.findMany({
        where: {
          platform: "shopify",
          externalReturnId: { in: candidateReturnIds },
        },
        select: { externalReturnId: true, localStatus: true },
      })
    : [];
  const existingByReturnId = new Map(
    existingRows.map((row) => [String(row.externalReturnId || ""), row])
  );

  for (const edge of orderEdges) {
    const orderNode = edge?.node;
    if (!orderNode?.id) continue;
    const orderEmail =
      String(orderNode?.email || "").trim() ||
      String(orderNode?.customer?.defaultEmailAddress?.emailAddress || "").trim() ||
      null;

    for (const returnEdge of orderNode.returns?.edges ?? []) {
      const returnNode = returnEdge?.node;
      if (!returnNode?.id) continue;

      const status = String(returnNode.status || "").toUpperCase();
      const lineItems =
        returnNode.returnLineItems?.edges
          ?.map((lineEdge: any) => mapReturnLine(lineEdge?.node))
          .filter((line: RequestedShopifyReturnLine) => Boolean(line.id)) ?? [];
      if (!lineItems.length) continue;

      const existing = existingByReturnId.get(returnNode.id) ?? null;
      if (status === "REQUESTED" && !hasReverseFulfillment(returnNode) && !existing) {
        requestedCount += 1;
      }

      if (!shouldUpsertShopifyReturnForSync(returnNode, existing)) continue;

      const firstLine = lineItems[0];
      const currency =
        lineItems.find((line: RequestedShopifyReturnLine) => line.currencyCode)?.currencyCode ??
        "CHF";
      const totalAmount = lineItems.reduce((sum: number, line: RequestedShopifyReturnLine) => {
        if (line.unitAmount == null) return sum;
        return sum + line.unitAmount * line.quantity;
      }, 0);
      const returnAmount = Number.isFinite(totalAmount) ? Number(totalAmount.toFixed(2)) : 0;
      const reverseDelivery = extractReverseDeliveryFromReturn(returnNode);
      const returnReasonCode = firstLine.returnReason ?? "OTHER";
      const returnReasonLabel = firstLine.returnReasonLabel ?? "Other";

      await prisma.marketplaceReturn.upsert({
        where: {
          platform_externalReturnId: {
            platform: "shopify",
            externalReturnId: returnNode.id,
          },
        },
        create: {
          platform: "shopify",
          externalReturnId: returnNode.id,
          externalOrderId: orderNode.name || orderNode.id,
          externalOrderLineId: null,
          productId: null,
          productTitle:
            lineItems.length > 1
              ? `${firstLine.title} (+${lineItems.length - 1} more)`
              : firstLine.title,
          sku: firstLine.sku,
          returnLabelNumber: reverseDelivery.trackingNumber,
          returnAmount,
          currency,
          returnReasonCode,
          returnReasonLabel,
          miraklStatus: status,
          localStatus: "pending_receipt",
          processStep: "pending",
          syncedAt: new Date(),
          quantity: lineItems.reduce(
            (sum: number, line: RequestedShopifyReturnLine) => sum + line.quantity,
            0
          ),
          apiSource: "shopify-admin-sync",
          rawJson: {
            order: {
              id: orderNode.id,
              name: orderNode.name,
              email: orderEmail,
              customerId: orderNode.customer?.id ?? null,
            },
            return: {
              id: returnNode.id,
              name: returnNode.name,
              status,
              createdAt: returnNode.createdAt ?? null,
            },
            reverseFulfillmentOrderId: reverseDelivery.reverseFulfillmentOrderId,
            reverseDelivery: {
              id: reverseDelivery.reverseDeliveryId,
              labelPublicFileUrl: reverseDelivery.labelPublicUrl,
              trackingNumber: reverseDelivery.trackingNumber,
              trackingUrl: reverseDelivery.trackingUrl,
            },
            lineItems,
          },
          auditLogJson: [
            {
              at: syncedAt,
              step: "shopify_return_sync",
              ok: true,
              status,
            },
          ],
        },
        update: {
          externalOrderId: orderNode.name || orderNode.id,
          productTitle:
            lineItems.length > 1
              ? `${firstLine.title} (+${lineItems.length - 1} more)`
              : firstLine.title,
          sku: firstLine.sku,
          returnLabelNumber: reverseDelivery.trackingNumber ?? undefined,
          returnAmount,
          currency,
          returnReasonCode,
          returnReasonLabel,
          miraklStatus: status,
          syncedAt: new Date(),
          quantity: lineItems.reduce(
            (sum: number, line: RequestedShopifyReturnLine) => sum + line.quantity,
            0
          ),
          rawJson: {
            order: {
              id: orderNode.id,
              name: orderNode.name,
              email: orderEmail,
              customerId: orderNode.customer?.id ?? null,
            },
            return: {
              id: returnNode.id,
              name: returnNode.name,
              status,
              createdAt: returnNode.createdAt ?? null,
            },
            reverseFulfillmentOrderId: reverseDelivery.reverseFulfillmentOrderId,
            reverseDelivery: {
              id: reverseDelivery.reverseDeliveryId,
              labelPublicFileUrl: reverseDelivery.labelPublicUrl,
              trackingNumber: reverseDelivery.trackingNumber,
              trackingUrl: reverseDelivery.trackingUrl,
            },
            lineItems,
          },
        },
      });
      upserted += 1;
    }
  }

  await prisma.marketplaceReturnSyncCursor.upsert({
    where: { platform: "shopify" },
    create: {
      platform: "shopify",
      lastSuccessfulSyncAt: new Date(),
    },
    update: {
      lastSuccessfulSyncAt: new Date(),
    },
  });

  return { success: true, upserted, requestedCount, syncedAt };
}

export async function listRequestedShopifyReturns(options: {
  limit?: number;
} = {}): Promise<{ success: true; returns: RequestedShopifyReturn[] }> {
  const pageSize = Math.min(Math.max(options.limit ?? 20, 1), 25);
  const query = SHOPIFY_ACTIVE_RETURN_ORDER_QUERY;

  const orderEdges = await fetchActiveReturnOrdersPaginated({
    graphqlQuery: REQUESTED_RETURNS_ORDERS_QUERY,
    query,
    pageSize,
    maxPages: 5,
    errorMessage: "Failed to list requested Shopify returns",
  });
  const candidateReturnIds: string[] = [];
  for (const edge of orderEdges) {
    for (const returnEdge of edge?.node?.returns?.edges ?? []) {
      const returnId = String(returnEdge?.node?.id || "").trim();
      if (returnId) candidateReturnIds.push(returnId);
    }
  }

  const trackedRows = candidateReturnIds.length
    ? await prisma.marketplaceReturn.findMany({
        where: {
          platform: "shopify",
          externalReturnId: { in: candidateReturnIds },
        },
        select: { externalReturnId: true },
      })
    : [];
  const trackedIds = new Set(
    trackedRows.map((row) => String(row.externalReturnId || "")).filter(Boolean)
  );

  const returns: RequestedShopifyReturn[] = [];
  const seen = new Set<string>();
  for (const edge of orderEdges) {
    const orderNode = edge?.node;
    if (!orderNode?.id) continue;
    for (const returnEdge of orderNode.returns?.edges ?? []) {
      const returnNode = returnEdge?.node;
      if (!returnNode?.id || seen.has(returnNode.id)) continue;
      const mapped = buildRequestedReturn(returnNode, orderNode, trackedIds);
      if (!mapped) continue;
      seen.add(returnNode.id);
      returns.push(mapped);
    }
  }

  returns.sort((a, b) => {
    const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
    return bTime - aTime;
  });

  return { success: true, returns };
}

export async function acceptRequestedShopifyReturn(
  returnId: string,
  options: { publicBaseUrl?: string } = {}
): Promise<AcceptRequestedResult> {
  const normalizedReturnId = String(returnId || "").trim();
  if (!normalizedReturnId) {
    throw new ShopifyReturnRequestError("VALIDATION_ERROR", "Missing returnId", 400);
  }

  const existing = await prisma.marketplaceReturn.findUnique({
    where: {
      platform_externalReturnId: {
        platform: "shopify",
        externalReturnId: normalizedReturnId,
      },
    },
  });
  if (existing) {
    throw new ShopifyReturnRequestError(
      "ALREADY_PROCESSED",
      "Return already accepted in our system",
      409
    );
  }

  const detailResult = await shopifyGraphQL<{
    return?: any;
  }>(RETURN_DETAIL_FOR_ACCEPT_QUERY, { id: normalizedReturnId });

  if (detailResult.errors?.length) {
    throw new ShopifyReturnRequestError(
      "SERVER_ERROR",
      "Failed to load return details",
      502,
      detailResult.errors
    );
  }

  const requestedReturn = detailResult.data?.return;
  if (!requestedReturn?.id) {
    throw new ShopifyReturnRequestError("NOT_FOUND", "Return not found", 404);
  }
  if (String(requestedReturn.status).toUpperCase() !== "REQUESTED") {
    throw new ShopifyReturnRequestError(
      "INVALID_STATE",
      `Return is not awaiting approval (status: ${requestedReturn.status})`,
      422
    );
  }

  const lineItems: RequestedShopifyReturnLine[] =
    requestedReturn.returnLineItems?.edges
      ?.map((edge: any) => mapReturnLine(edge?.node))
      .filter((line: RequestedShopifyReturnLine) => Boolean(line.id)) ?? [];
  if (!lineItems.length) {
    throw new ShopifyReturnRequestError(
      "VALIDATION_ERROR",
      "Return has no line items",
      422
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
            defaultEmailAddress?: { emailAddress?: string | null } | null;
          } | null;
        } | null;
      } | null;
      userErrors: ShopifyReturnUserError[];
    };
  }>(RETURN_APPROVE_MUTATION, {
    input: { id: normalizedReturnId, notifyCustomer: false },
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
      "Return was approved but not opened",
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
    reference: approvedReturn.name || requestedReturn.order?.name || normalizedReturnId,
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

  const order = requestedReturn.order;
  const firstLine = lineItems[0];
  const totalAmount = lineItems.reduce((sum: number, line: RequestedShopifyReturnLine) => {
    if (line.unitAmount == null) return sum;
    return sum + line.unitAmount * line.quantity;
  }, 0);
  const returnAmount = Number.isFinite(totalAmount) ? Number(totalAmount.toFixed(2)) : 0;
  const currency =
    lineItems.find((line: RequestedShopifyReturnLine) => line.currencyCode)?.currencyCode ??
    "CHF";
  const customerId =
    approvedReturn.order?.customer?.id || order?.customer?.id || null;
  const customerEmail =
    order?.customer?.defaultEmailAddress?.emailAddress || order?.email || null;
  const returnReasonCode = firstLine.returnReason ?? "OTHER";
  const returnReasonLabel = firstLine.returnReasonLabel ?? "Other";

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
      externalOrderId: order?.name || order?.id || approvedReturn.order?.name || "",
      externalOrderLineId: null,
      productId: null,
      productTitle:
        lineItems.length > 1
          ? `${firstLine.title} (+${lineItems.length - 1} more)`
          : firstLine.title,
      sku: firstLine.sku,
      returnLabelNumber: label.trackingNumber,
      labelKey: label.labelKey,
      labelStorageUrl: label.labelStorageUrl,
      returnAmount,
      currency,
      returnReasonCode,
      returnReasonLabel,
      miraklStatus: approvedReturn.status,
      localStatus: "pending_receipt",
      processStep: "pending",
      syncedAt: new Date(),
      quantity: lineItems.reduce(
        (sum: number, line: RequestedShopifyReturnLine) => sum + line.quantity,
        0
      ),
      apiSource: "shopify-admin-request-accept",      rawJson: {
        order: {
          id: order?.id || approvedReturn.order?.id || null,
          name: order?.name || approvedReturn.order?.name || null,
          email: customerEmail,
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
        source: "shopify_return_request_accept",
        lineItems,
      },
      auditLogJson: [
        {
          at: new Date().toISOString(),
          step: "shopify_return_request_accepted",
          ok: true,
          requestedReturnId: normalizedReturnId,
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
        },
      ],
    },
    update: {
      externalOrderId: order?.name || order?.id || approvedReturn.order?.name || "",
      productTitle:
        lineItems.length > 1
          ? `${firstLine.title} (+${lineItems.length - 1} more)`
          : firstLine.title,
      sku: firstLine.sku,
      returnLabelNumber: label.trackingNumber,
      labelKey: label.labelKey,
      labelStorageUrl: label.labelStorageUrl,
      returnAmount,
      currency,
      returnReasonCode,
      returnReasonLabel,
      miraklStatus: approvedReturn.status,
      localStatus: "pending_receipt",
      processStep: "pending",
      syncedAt: new Date(),
      quantity: lineItems.reduce(
        (sum: number, line: RequestedShopifyReturnLine) => sum + line.quantity,
        0
      ),
      apiSource: "shopify-admin-request-accept",      rawJson: {
        order: {
          id: order?.id || approvedReturn.order?.id || null,
          name: order?.name || approvedReturn.order?.name || null,
          email: customerEmail,
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
        source: "shopify_return_request_accept",
        lineItems,
      },
      failureMessage: null,
    },
  });

  return {
    success: true,
    returnId: approvedReturn.id,
    status: approvedReturn.status,
    orderId: order?.id || approvedReturn.order?.id || "",
    name: approvedReturn.name ?? approvedReturn.id,
    returnLabelUrl:
      reverseDelivery.deliverable?.label?.publicFileUrl || label.labelPublicUrl,
    returnTrackingNumber:
      reverseDelivery.deliverable?.tracking?.number || label.trackingNumber,
    reverseDeliveryId: reverseDelivery.id || null,
  };
}
