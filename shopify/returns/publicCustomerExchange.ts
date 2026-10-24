import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import {
  getReturnableItemsForOrder,
  normalizeVariantSizeToken,
  ShopifyReturnRequestError,
  variantSizeTokensFromOptions,
} from "@/shopify/returns/createAndOpenReturn";
import { parseStrictPublicOrderNumber } from "@/shopify/returns/publicOrderNumber";
import {
  parseProductSizeFit,
  resolveSizeFitMetafieldSpec,
  type ProductSizeFit,
} from "@/shopify/returns/productSizeFit";

export type PublicExchangeReplacementOption = {
  variantId: string;
  sku: string | null;
  title: string | null;
  optionLabel: string | null;
  unitPrice: number | null;
  currencyCode: string | null;
  availableQuantity: number | null;
};

export type PublicCustomerExchangeLine = {
  fulfillmentLineItemId: string;
  replacementVariantId: string;
  replacementSku?: string | null;
  replacementTitle?: string | null;
  unitPriceDelta?: number | null;
};

function sizeFitMetafieldGraphqlFragment(): string {
  const { namespace, key } = resolveSizeFitMetafieldSpec();
  return `
    sizeFit: metafield(namespace: "${namespace}", key: "${key}") {
      value
    }
  `;
}

function productVariantsForExchangeQuery(): string {
  const sizeFitField = sizeFitMetafieldGraphqlFragment();
  return /* GraphQL */ `
    query ProductVariantsForExchange($productId: ID!) {
      product(id: $productId) {
        id
        title
        ${sizeFitField}
        variants(first: 250) {
          nodes {
            id
            sku
            title
            displayName
            price
            inventoryQuantity
            selectedOptions {
              name
              value
            }
          }
        }
      }
    }
  `;
}

const VARIANT_SNAPSHOT_QUERY = /* GraphQL */ `
query ExchangeVariantSnapshot($id: ID!) {
  productVariant(id: $id) {
    id
    sku
    displayName
    title
    price
    product {
      id
      title
    }
  }
}
`;

const DRAFT_ORDER_CREATE = /* GraphQL */ `
mutation ExchangeDraftOrderCreate($input: DraftOrderInput!) {
  draftOrderCreate(input: $input) {
    draftOrder {
      id
      name
      invoiceUrl
    }
    userErrors {
      field
      message
    }
  }
}
`;

function cleanEmail(value: string): string {
  return String(value ?? "").trim().toLowerCase();
}

function mergeSizeTokens(...groups: string[][]): string[] {
  return [...new Set(groups.flat().filter(Boolean))];
}

function variantMatchesOrderedSize(input: {
  variantId: string;
  selectedOptions?: Array<{ name?: string; value?: string } | null> | null;
  sku?: string | null;
  currentVariantId: string | null;
  currentSizeTokens: string[];
}): boolean {
  if (input.currentVariantId && input.variantId === input.currentVariantId) return true;
  if (!input.currentSizeTokens.length) return false;
  const optionTokens = variantSizeTokensFromOptions(input.selectedOptions);
  if (optionTokens.some((t) => input.currentSizeTokens.includes(t))) return true;
  const sku = String(input.sku ?? "").trim();
  const fromSku = sku.match(/-(\d+(?:\.\d+)?)$/);
  if (fromSku?.[1] && input.currentSizeTokens.includes(normalizeVariantSizeToken(fromSku[1]))) {
    return true;
  }
  return false;
}

async function findOrderLineProductId(input: {
  orderNumber: string;
  email: string;
  fulfillmentLineItemId: string;
}): Promise<{
  orderId: string;
  orderName: string;
  returnedUnitPrice: number | null;
  currencyCode: string | null;
  currentVariantId: string | null;
  currentSizeTokens: string[];
  productId: string;
}> {
  const orderNumber = parseStrictPublicOrderNumber(input.orderNumber);
  if (!orderNumber) {
    throw new ShopifyReturnRequestError("INVALID_ORDER_NUMBER", "Invalid order number", 400);
  }
  const email = cleanEmail(input.email);
  if (!email.includes("@")) {
    throw new ShopifyReturnRequestError("VALIDATION_ERROR", "Invalid email", 400);
  }

  const listed = await getReturnableItemsForOrder({ orderNumber, email });
  const match = listed.items.find(
    (it) => it.fulfillmentLineItemId === input.fulfillmentLineItemId
  );
  if (!match) {
    throw new ShopifyReturnRequestError(
      "ITEM_NOT_RETURNABLE",
      "Item not returnable on this order",
      422
    );
  }

  const { data: returnableData, errors: returnableErrors } = await shopifyGraphQL<{
    returnableFulfillments?: {
      edges?: Array<{
        node?: {
          returnableFulfillmentLineItems?: {
            edges?: Array<{
              node?: {
                fulfillmentLineItem?: {
                  id?: string;
                  lineItem?: {
                    variant?: {
                      id?: string;
                      selectedOptions?: Array<{ name?: string; value?: string } | null> | null;
                      product?: { id?: string } | null;
                    } | null;
                  } | null;
                } | null;
              } | null;
            }>;
          };
        };
      }>;
    };
  }>(
    /* GraphQL */ `
      query ReturnableLineProductForExchange($orderId: ID!) {
        returnableFulfillments(orderId: $orderId, first: 20) {
          edges {
            node {
              returnableFulfillmentLineItems(first: 100) {
                edges {
                  node {
                    fulfillmentLineItem {
                      id
                      lineItem {
                        variant {
                          id
                          selectedOptions {
                            name
                            value
                          }
                          product {
                            id
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
    `,
    { orderId: listed.orderId }
  );

  if (returnableErrors?.length) {
    throw new ShopifyReturnRequestError("SERVER_ERROR", "Shopify lookup failed", 502, returnableErrors);
  }

  let productId: string | null = null;
  let currentVariantId: string | null = null;
  let currentSizeTokens: string[] = [];
  for (const f of returnableData?.returnableFulfillments?.edges ?? []) {
    for (const edge of f?.node?.returnableFulfillmentLineItems?.edges ?? []) {
      const fli = edge?.node?.fulfillmentLineItem;
      if (fli?.id !== input.fulfillmentLineItemId) continue;
      productId = fli?.lineItem?.variant?.product?.id ?? null;
      currentVariantId = fli?.lineItem?.variant?.id ?? null;
      currentSizeTokens = variantSizeTokensFromOptions(fli?.lineItem?.variant?.selectedOptions);
      break;
    }
  }

  if (!productId) {
    const fallback = await shopifyGraphQL<{
      order?: {
        fulfillments?: Array<{
          fulfillmentLineItems?: {
            edges?: Array<{
              node?: {
                id?: string | null;
                lineItem?: {
                  variant?: {
                    id?: string | null;
                    selectedOptions?: Array<{ name?: string; value?: string } | null> | null;
                    product?: { id?: string | null } | null;
                  } | null;
                } | null;
              } | null;
            }>;
          };
        }>;
      } | null;
    }>(
      /* GraphQL */ `
        query OrderFulfillmentLineProduct($orderId: ID!) {
          order(id: $orderId) {
            fulfillments(first: 25) {
              fulfillmentLineItems(first: 100) {
                edges {
                  node {
                    id
                    lineItem {
                      variant {
                        id
                        selectedOptions {
                          name
                          value
                        }
                        product {
                          id
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
      { orderId: listed.orderId }
    );

    for (const fulfillment of fallback.data?.order?.fulfillments ?? []) {
      for (const edge of fulfillment.fulfillmentLineItems?.edges ?? []) {
        const node = edge?.node;
        if (node?.id !== input.fulfillmentLineItemId) continue;
        productId = node?.lineItem?.variant?.product?.id ?? null;
        currentVariantId = node?.lineItem?.variant?.id ?? null;
        currentSizeTokens = variantSizeTokensFromOptions(node?.lineItem?.variant?.selectedOptions);
        break;
      }
    }
  }

  currentVariantId = currentVariantId ?? match.variantId ?? null;
  if (match.variantLabel) {
    currentSizeTokens = mergeSizeTokens(currentSizeTokens, [
      normalizeVariantSizeToken(match.variantLabel),
    ]);
  }

  if (!productId) {
    throw new ShopifyReturnRequestError(
      "SERVER_ERROR",
      "Could not resolve product for return line",
      502
    );
  }

  return {
    orderId: listed.orderId,
    orderName: listed.orderName,
    returnedUnitPrice: match.unitAmount,
    currencyCode: match.currencyCode,
    currentVariantId,
    currentSizeTokens,
    productId,
  };
}

export async function listPublicExchangeReplacementOptions(input: {
  orderNumber: string;
  email: string;
  fulfillmentLineItemId: string;
}): Promise<{
  orderId: string;
  orderName: string;
  fulfillmentLineItemId: string;
  returnedUnitPrice: number | null;
  currencyCode: string | null;
  currentVariantId: string | null;
  productSizeFit: ProductSizeFit | null;
  options: PublicExchangeReplacementOption[];
}> {
  const ctx = await findOrderLineProductId(input);

  const { data, errors } = await shopifyGraphQL<{
    product?: {
      sizeFit?: { value?: string | null } | null;
      variants?: {
        nodes?: Array<{
          id: string;
          sku: string | null;
          title: string | null;
          displayName: string | null;
          price: string | null;
          inventoryQuantity: number | null;
          selectedOptions?: Array<{ name?: string; value?: string }> | null;
        }>;
      };
    } | null;
  }>(productVariantsForExchangeQuery(), { productId: ctx.productId });

  if (errors?.length) {
    throw new ShopifyReturnRequestError("SERVER_ERROR", "Variant lookup failed", 502, errors);
  }

  const options: PublicExchangeReplacementOption[] = (data?.product?.variants?.nodes ?? [])
    .filter(
      (v) =>
        v.id &&
        !variantMatchesOrderedSize({
          variantId: v.id,
          selectedOptions: v.selectedOptions,
          sku: v.sku,
          currentVariantId: ctx.currentVariantId,
          currentSizeTokens: ctx.currentSizeTokens,
        })
    )
    .map((v) => {
      const priceRaw = Number(v.price ?? NaN);
      const opts = (v.selectedOptions ?? [])
        .map((o) => `${o.name ?? ""}: ${o.value ?? ""}`.trim())
        .filter(Boolean)
        .join(" · ");
      return {
        variantId: v.id,
        sku: v.sku ?? null,
        title: v.displayName ?? v.title ?? null,
        optionLabel: opts || null,
        unitPrice: Number.isFinite(priceRaw) ? priceRaw : null,
        currencyCode: ctx.currencyCode,
        availableQuantity:
          v.inventoryQuantity != null && Number.isFinite(Number(v.inventoryQuantity))
            ? Math.max(0, Math.floor(Number(v.inventoryQuantity)))
            : null,
      };
    });

  const productSizeFit = parseProductSizeFit(data?.product?.sizeFit?.value ?? null);

  return {
    orderId: ctx.orderId,
    orderName: ctx.orderName,
    fulfillmentLineItemId: input.fulfillmentLineItemId,
    returnedUnitPrice: ctx.returnedUnitPrice,
    currencyCode: ctx.currencyCode,
    currentVariantId: ctx.currentVariantId,
    productSizeFit,
    options,
  };
}

export async function snapshotReplacementVariant(variantId: string) {
  const { data, errors } = await shopifyGraphQL<{
    productVariant?: {
      id: string;
      sku: string | null;
      displayName: string | null;
      title: string | null;
      price: string | null;
      product?: { id: string; title: string | null } | null;
    } | null;
  }>(VARIANT_SNAPSHOT_QUERY, { id: variantId });

  if (errors?.length || !data?.productVariant?.id) {
    throw new ShopifyReturnRequestError("VALIDATION_ERROR", "Replacement variant not found", 400);
  }

  const priceRaw = Number(data.productVariant.price ?? NaN);
  return {
    variantId: data.productVariant.id,
    sku: data.productVariant.sku ?? null,
    title:
      data.productVariant.displayName ??
      data.productVariant.title ??
      data.productVariant.product?.title ??
      null,
    unitPrice: Number.isFinite(priceRaw) ? priceRaw : null,
  };
}

export function computeUnitPriceDelta(
  returnedUnitPrice: number | null,
  replacementUnitPrice: number | null
): number | null {
  if (returnedUnitPrice == null || replacementUnitPrice == null) return null;
  return Number((replacementUnitPrice - returnedUnitPrice).toFixed(2));
}

export async function createExchangePriceDifferenceDraftOrder(input: {
  customerId: string | null;
  customerEmail: string;
  orderName: string;
  returnName: string;
  shopifyReturnId: string;
  currencyCode: string;
  totalDue: number;
  note: string;
}): Promise<{ draftOrderId: string; draftOrderName: string | null; invoiceUrl: string | null }> {
  if (!Number.isFinite(input.totalDue) || input.totalDue <= 0) {
    return { draftOrderId: "", draftOrderName: null, invoiceUrl: null };
  }

  const { data, errors } = await shopifyGraphQL<{
    draftOrderCreate?: {
      draftOrder?: { id?: string; name?: string; invoiceUrl?: string | null } | null;
      userErrors?: Array<{ message?: string | null }>;
    };
  }>(DRAFT_ORDER_CREATE, {
    input: {
      email: input.customerEmail,
      customerId: input.customerId || undefined,
      note: input.note,
      tags: ["exchange-price-difference", "returns-portal"],
      customAttributes: [
        { key: "source", value: "returns-portal-exchange" },
        { key: "original_order", value: input.orderName },
        { key: "return_name", value: input.returnName },
        { key: "shopify_return_id", value: input.shopifyReturnId },
      ],
      lineItems: [
        {
          title: `Écart échange (${input.returnName})`,
          originalUnitPrice: input.totalDue.toFixed(2),
          quantity: 1,
          taxable: false,
        },
      ],
      presentmentCurrencyCode: input.currencyCode,
    },
  });

  if (errors?.length) {
    throw new ShopifyReturnRequestError(
      "SERVER_ERROR",
      "Draft order for price difference failed",
      502,
      errors
    );
  }

  const userErrors = data?.draftOrderCreate?.userErrors ?? [];
  if (userErrors.length) {
    throw new ShopifyReturnRequestError(
      "SERVER_ERROR",
      userErrors.map((e) => e.message).filter(Boolean).join("; ") || "Draft order failed",
      502,
      userErrors
    );
  }

  const draft = data?.draftOrderCreate?.draftOrder;
  if (!draft?.id) {
    throw new ShopifyReturnRequestError("SERVER_ERROR", "Draft order missing id", 502);
  }

  return {
    draftOrderId: draft.id,
    draftOrderName: draft.name ?? null,
    invoiceUrl: draft.invoiceUrl ?? null,
  };
}
