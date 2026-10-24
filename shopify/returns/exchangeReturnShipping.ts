import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { generateShopifyReturnLabel } from "@/shopify/returns/label";
import type { OrderPaidPayload } from "@/shopify/orders/ordersPaidConvergence";

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
      field
      message
    }
  }
}
`;

const ORDER_AWAITING_PAYMENT_HOLDS_QUERY = /* GraphQL */ `
query ExchangeAwaitingPaymentHolds($id: ID!) {
  order(id: $id) {
    fulfillmentOrders(first: 25) {
      nodes {
        id
        status
        fulfillmentHolds {
          reason
        }
      }
    }
  }
}
`;

const FULFILLMENT_ORDER_RELEASE_HOLD_MUTATION = /* GraphQL */ `
mutation ReleasePaidExchangeFulfillmentHold($id: ID!) {
  fulfillmentOrderReleaseHold(id: $id) {
    fulfillmentOrder {
      id
      status
    }
    userErrors {
      field
      message
    }
  }
}
`;

type ShopifyReturnUserError = { field?: string[] | null; message: string };

function assertNoReturnUserErrors(step: string, userErrors: ShopifyReturnUserError[] | undefined) {
  const errors = userErrors ?? [];
  if (!errors.length) return;
  throw new Error(
    `${step}: ${errors.map((e) => e.message).filter(Boolean).join("; ") || "Shopify user error"}`
  );
}

export async function attachShopifyReturnShippingLabel(input: {
  reverseFulfillmentOrderId: string;
  reference: string;
  publicBaseUrl: string;
  notifyCustomer?: boolean;
}): Promise<{
  label: Awaited<ReturnType<typeof generateShopifyReturnLabel>>;
  reverseDeliveryId: string;
  returnLabelUrl: string | null;
  returnTrackingNumber: string | null;
}> {
  const label = await generateShopifyReturnLabel({
    reference: input.reference,
    publicBaseUrl: input.publicBaseUrl,
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
    reverseFulfillmentOrderId: input.reverseFulfillmentOrderId,
    labelFileUrl: label.labelPublicUrl,
    trackingNumber: label.trackingNumber,
    trackingUrl: label.trackingUrl,
    notifyCustomer: input.notifyCustomer ?? true,
  });

  if (reverseDeliveryResult.errors?.length) {
    throw new Error("Shopify reverseDeliveryCreateWithShipping failed");
  }
  assertNoReturnUserErrors(
    "reverseDeliveryCreateWithShipping",
    reverseDeliveryResult.data?.reverseDeliveryCreateWithShipping?.userErrors
  );

  const reverseDelivery =
    reverseDeliveryResult.data?.reverseDeliveryCreateWithShipping?.reverseDelivery;
  if (!reverseDelivery?.id) {
    throw new Error("Reverse delivery was not created");
  }

  return {
    label,
    reverseDeliveryId: reverseDelivery.id,
    returnLabelUrl:
      reverseDelivery.deliverable?.label?.publicFileUrl || label.labelPublicUrl || null,
    returnTrackingNumber:
      reverseDelivery.deliverable?.tracking?.number || label.trackingNumber || null,
  };
}

function noteAttribute(payload: OrderPaidPayload, name: string): string | null {
  const attrs = payload.note_attributes ?? [];
  for (const entry of attrs) {
    if (String(entry.name ?? "").trim().toLowerCase() === name.toLowerCase()) {
      const v = String(entry.value ?? "").trim();
      if (v) return v;
    }
  }
  return null;
}

function orderTags(payload: OrderPaidPayload & { tags?: string }): string[] {
  const raw = String((payload as { tags?: string }).tags ?? "").trim();
  if (!raw) return [];
  return raw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
}

function isExchangePriceDifferenceOrder(payload: OrderPaidPayload): boolean {
  const tags = orderTags(payload);
  if (tags.includes("exchange-price-difference") || tags.includes("returns-portal")) {
    return tags.includes("exchange-price-difference");
  }
  const items = payload.line_items ?? [];
  return items.some((li) =>
    String(li.title ?? "")
      .toLowerCase()
      .includes("écart échange")
  );
}

async function releasePaidExchangeFulfillmentHolds(orderId: string): Promise<string[]> {
  const holdResult = await shopifyGraphQL<{
    order?: {
      fulfillmentOrders?: {
        nodes?: Array<{
          id: string;
          status: string;
          fulfillmentHolds?: Array<{ reason?: string | null }>;
        }>;
      };
    } | null;
  }>(ORDER_AWAITING_PAYMENT_HOLDS_QUERY, { id: orderId });
  if (holdResult.errors?.length) {
    throw new Error("Shopify exchange fulfillment hold lookup failed");
  }
  const heldIds = (holdResult.data?.order?.fulfillmentOrders?.nodes ?? [])
    .filter(
      (order) =>
        String(order.status).toUpperCase() === "ON_HOLD" &&
        (order.fulfillmentHolds ?? []).some(
          (hold) => String(hold.reason).toUpperCase() === "AWAITING_PAYMENT"
        )
    )
    .map((order) => order.id);

  for (const id of heldIds) {
    const releaseResult = await shopifyGraphQL<{
      fulfillmentOrderReleaseHold?: {
        userErrors?: ShopifyReturnUserError[];
      };
    }>(FULFILLMENT_ORDER_RELEASE_HOLD_MUTATION, { id });
    if (releaseResult.errors?.length) {
      throw new Error("Shopify exchange fulfillment hold release failed");
    }
    assertNoReturnUserErrors(
      "fulfillmentOrderReleaseHold",
      releaseResult.data?.fulfillmentOrderReleaseHold?.userErrors
    );
  }
  return heldIds;
}

export async function tryCompleteExchangeReturnAfterOrderPaid(
  payload: OrderPaidPayload
): Promise<{ handled: boolean; returnId?: string; error?: string }> {
  const legacySeparatePaymentOrder = isExchangePriceDifferenceOrder(payload);
  const returnName =
    noteAttribute(payload, "return_name") ||
    noteAttribute(payload, "return_name".toUpperCase()) ||
    null;
  const shopifyReturnGid = noteAttribute(payload, "shopify_return_id");

  const paidOrderGid = String(payload.admin_graphql_api_id ?? "").trim();
  const paidOrderIdNum = String(payload.id ?? "").trim();

  let row = shopifyReturnGid
    ? await prisma.marketplaceReturn.findFirst({
        where: { platform: "shopify", externalReturnId: shopifyReturnGid },
      })
    : null;

  // Native Shopify exchange: the balance and invoice live on the ORIGINAL
  // order, so orders/paid has no custom tags/note attributes. Match the
  // awaiting return by original order GID recorded in rawJson.
  if (!row && paidOrderGid) {
    const awaiting = await prisma.marketplaceReturn.findMany({
      where: {
        platform: "shopify",
        processStep: "awaiting_exchange_payment",
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    row =
      awaiting.find((candidate) => {
        const raw = (candidate.rawJson ?? {}) as Record<string, unknown>;
        const originalOrder = raw.order as
          | { id?: string | null; name?: string | null }
          | undefined;
        return String(originalOrder?.id ?? "").trim() === paidOrderGid;
      }) ?? null;
  }

  if (!row) {
    if (legacySeparatePaymentOrder || shopifyReturnGid) {
      console.warn("[returns][exchange-payment] no marketplace row", {
        returnName,
        shopifyReturnGid,
        paidOrderGid,
      });
      return { handled: true, error: "return_not_found" };
    }
    return { handled: false };
  }

  if (row.labelKey) {
    return { handled: true, returnId: row.externalReturnId };
  }

  if (row.processStep !== "awaiting_exchange_payment") {
    return { handled: true, error: "not_awaiting_exchange_payment" };
  }

  const raw = (row.rawJson ?? {}) as Record<string, unknown>;
  const customerExchange = raw.customerExchange as Record<string, unknown> | undefined;
  if (customerExchange?.exchangePaymentStatus === "paid") {
    return { handled: true, returnId: row.externalReturnId };
  }

  const reverseFulfillmentOrderId = String(raw.reverseFulfillmentOrderId ?? "").trim();
  const publicBaseUrl = String(
    customerExchange?.publicBaseUrl ?? process.env.RETURNS_PUBLIC_BASE_URL ?? ""
  ).trim();
  const returnRef =
    String((raw.return as { name?: string } | undefined)?.name ?? "").trim() ||
    returnName ||
    row.externalReturnId;

  if (!reverseFulfillmentOrderId || !publicBaseUrl) {
    return { handled: true, error: "missing_reverse_fulfillment_or_base_url" };
  }

  try {
    const releasedFulfillmentOrderIds = paidOrderGid
      ? await releasePaidExchangeFulfillmentHolds(paidOrderGid)
      : [];
    const shipped = await attachShopifyReturnShippingLabel({
      reverseFulfillmentOrderId,
      reference: returnRef,
      publicBaseUrl,
      notifyCustomer: true,
    });

    const nextRaw = {
      ...raw,
      customerExchange: {
        ...(customerExchange ?? {}),
        exchangePaymentStatus: "paid",
        paidOrderId: paidOrderGid || paidOrderIdNum || null,
        paidAt: new Date().toISOString(),
      },
      reverseDelivery: {
        id: shipped.reverseDeliveryId,
        labelPublicFileUrl: shipped.returnLabelUrl,
        trackingNumber: shipped.returnTrackingNumber,
      },
      generatedLabel: {
        key: shipped.label.labelKey,
        localPath: shipped.label.filePath,
        url: shipped.label.labelPublicUrl,
        mimeType: shipped.label.mimeType,
      },
    };

    await prisma.marketplaceReturn.update({
      where: { id: row.id },
      data: {
        returnLabelNumber: shipped.returnTrackingNumber,
        labelKey: shipped.label.labelKey,
        labelStorageUrl: shipped.label.labelStorageUrl ?? null,
        processStep: "pending",
        localStatus: "pending_receipt",
        rawJson: nextRaw as object,
        auditLogJson: [
          ...((row.auditLogJson as object[] | null) ?? []),
          {
            at: new Date().toISOString(),
            step: "exchange_price_paid_label_created",
            ok: true,
            paidOrderId: paidOrderGid || paidOrderIdNum,
            releasedFulfillmentOrderIds,
          },
        ],
      },
    });

    return { handled: true, returnId: row.externalReturnId };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[returns][exchange-payment] label attach failed", {
      returnId: row.externalReturnId,
      error: message,
    });
    return { handled: true, error: message };
  }
}
