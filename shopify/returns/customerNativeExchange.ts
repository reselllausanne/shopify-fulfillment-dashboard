import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { ShopifyReturnRequestError } from "@/shopify/returns/createAndOpenReturn";
import { ORIGINAL_PAYMENT_REFUND_MAX_CHF } from "@/shopify/returns/refundPreference";

type UserError = {
  code?: string | null;
  field?: string[] | null;
  message: string;
};

type MoneyBag = {
  shopMoney: { amount: string; currencyCode: string };
  presentmentMoney: { amount: string; currencyCode: string };
};

type NativeReturnLine = {
  fulfillmentLineItemId: string;
  quantity: number;
  returnReason: string;
  reasonNote?: string | null;
  /** Paid-pair unit used for customer Δ (fallback when Shopify line is 0). */
  paidUnitAmount?: number | null;
};

type NativeExchangeLine = {
  variantId: string;
  quantity: number;
  /** Catalog unit price of the replacement (presentment, tax-included). */
  unitPrice?: number | null;
  /**
   * Discount on the exchange line so Shopify net due matches paid-pair Δ
   * (needed when the original line was 100% discounted / staff gratis).
   */
  appliedDiscountAmount?: number | null;
  currencyCode?: string | null;
};

type CreatedReturnLine = {
  id: string;
  quantity: number;
  processableQuantity: number;
};

type CreatedExchangeLine = {
  id: string;
  quantity: number;
  processableQuantity: number;
  variantId: string | null;
};

type NativeReturnShape = {
  id: string;
  name: string;
  status: string;
  order: {
    id: string;
    name: string;
    statusPageUrl?: string | null;
  };
  returnLineItems: { nodes: CreatedReturnLine[] };
  exchangeLineItems: { nodes: CreatedExchangeLine[] };
  reverseFulfillmentOrders?: {
    nodes?: Array<{ id: string }>;
  } | null;
};

type SuggestedTransaction = {
  amountSet: MoneyBag;
  parentTransaction?: { id: string } | null;
};

type FinancialOutcome =
  | {
      __typename: "InvoiceReturnOutcome";
      amount: MoneyBag;
    }
  | {
      __typename: "RefundReturnOutcome";
      amount: MoneyBag;
      suggestedTransactions: SuggestedTransaction[];
      suggestedRefundMethods: Array<{
        __typename: string;
        amount: MoneyBag;
        maximumRefundable: MoneyBag;
      }>;
    }
  | null;

const RETURN_CREATE = /* GraphQL */ `
mutation CustomerExchangeReturnCreate($returnInput: ReturnInput!) {
  returnCreate(returnInput: $returnInput) {
    return {
      id
      name
      status
      order {
        id
        name
        statusPageUrl
      }
      returnLineItems(first: 50) {
        nodes {
          id
          quantity
          processableQuantity
        }
      }
      exchangeLineItems(first: 50) {
        nodes {
          id
          quantity
          processableQuantity
          variantId
        }
      }
      reverseFulfillmentOrders(first: 10) {
        nodes {
          id
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

const RETURN_REASON_DEFINITIONS = /* GraphQL */ `
query CustomerExchangeReturnReasonDefinitions($handles: [String!]) {
  returnReasonDefinitions(first: 50, handles: $handles) {
    nodes {
      id
      handle
      deleted
    }
  }
}
`;

const SUGGESTED_FINANCIAL_OUTCOME = /* GraphQL */ `
query CustomerExchangeSuggestedFinancialOutcome(
  $id: ID!
  $returnLineItems: [SuggestedOutcomeReturnLineItemInput!]!
  $exchangeLineItems: [SuggestedOutcomeExchangeLineItemInput!]!
  $refundMethodAllocation: RefundMethodAllocation!
) {
  return(id: $id) {
    suggestedFinancialOutcome(
      returnLineItems: $returnLineItems
      exchangeLineItems: $exchangeLineItems
      refundMethodAllocation: $refundMethodAllocation
    ) {
      financialTransfer {
        __typename
        ... on InvoiceReturnOutcome {
          amount {
            shopMoney {
              amount
              currencyCode
            }
            presentmentMoney {
              amount
              currencyCode
            }
          }
        }
        ... on RefundReturnOutcome {
          amount {
            shopMoney {
              amount
              currencyCode
            }
            presentmentMoney {
              amount
              currencyCode
            }
          }
          suggestedTransactions {
            amountSet {
              shopMoney {
                amount
                currencyCode
              }
              presentmentMoney {
                amount
                currencyCode
              }
            }
            parentTransaction {
              id
            }
          }
          suggestedRefundMethods {
            __typename
            amount {
              shopMoney {
                amount
                currencyCode
              }
              presentmentMoney {
                amount
                currencyCode
              }
            }
            maximumRefundable {
              shopMoney {
                amount
                currencyCode
              }
              presentmentMoney {
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

const RETURN_PROCESS = /* GraphQL */ `
mutation CustomerExchangeReturnProcess($input: ReturnProcessInput!) {
  returnProcess(input: $input) {
    return {
      id
      name
      status
      order {
        id
        name
        statusPageUrl
      }
      returnLineItems(first: 50) {
        nodes {
          id
          quantity
          processableQuantity
        }
      }
      exchangeLineItems(first: 50) {
        nodes {
          id
          quantity
          processableQuantity
          variantId
        }
      }
      reverseFulfillmentOrders(first: 10) {
        nodes {
          id
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

const ORDER_INVOICE_SEND = /* GraphQL */ `
mutation CustomerExchangeInvoiceSend($id: ID!, $email: EmailInput) {
  orderInvoiceSend(id: $id, email: $email) {
    order {
      id
    }
    userErrors {
      field
      message
    }
  }
}
`;

function assertNoErrors(step: string, graphqlErrors: unknown, userErrors: UserError[] | undefined) {
  if (Array.isArray(graphqlErrors) && graphqlErrors.length > 0) {
    throw new ShopifyReturnRequestError(
      "SERVER_ERROR",
      `Shopify ${step} failed`,
      502,
      graphqlErrors
    );
  }
  if (userErrors?.length) {
    throw new ShopifyReturnRequestError(
      "SHOPIFY_USER_ERROR",
      userErrors.map((error) => error.message).filter(Boolean).join("; ") ||
        `Shopify ${step} failed`,
      422,
      userErrors
    );
  }
}

function amountFromBag(bag: MoneyBag | null | undefined): number {
  const raw = Number(bag?.presentmentMoney?.amount ?? bag?.shopMoney?.amount ?? 0);
  return Number.isFinite(raw) ? Number(raw.toFixed(2)) : 0;
}

const RETURN_REASON_HANDLES: Record<string, string> = {
  SIZE_TOO_SMALL: "too-small",
  SIZE_TOO_LARGE: "too-big",
  UNWANTED: "changed-my-mind",
  NOT_AS_DESCRIBED: "item-not-as-described",
  WRONG_ITEM: "received-the-wrong-item",
  DEFECTIVE: "damaged-or-defective",
  STYLE: "style",
  COLOR: "color",
  OTHER: "other-reason",
};

const returnReasonDefinitionCache = new Map<string, string>();

async function resolveReturnReasonDefinitionId(reason: string): Promise<string> {
  const handle = RETURN_REASON_HANDLES[String(reason).toUpperCase()] ?? "other-reason";
  const cached = returnReasonDefinitionCache.get(handle);
  if (cached) return cached;
  const result = await shopifyGraphQL<{
    returnReasonDefinitions?: {
      nodes?: Array<{ id: string; handle: string; deleted: boolean }>;
    };
  }>(RETURN_REASON_DEFINITIONS, { handles: [handle] });
  assertNoErrors("returnReasonDefinitions", result.errors, undefined);
  const definition = (result.data?.returnReasonDefinitions?.nodes ?? []).find(
    (node) => node.handle === handle && !node.deleted
  );
  if (!definition?.id) {
    throw new ShopifyReturnRequestError(
      "SERVER_ERROR",
      `Shopify return reason definition is unavailable: ${handle}`,
      502
    );
  }
  returnReasonDefinitionCache.set(handle, definition.id);
  return definition.id;
}

/**
 * Customer-facing quote = same math as the size selector:
 * replacement catalog − paid pair unit (staff/0-paid fallback included).
 * Raw returnCalculate alone is wrong for gratis lines (credit 0) and when
 * tax is stacked on TTC catalog prices (+17 became 178.44).
 */
export function quoteCustomerExchangeFromPaidPair(input: {
  lines: Array<{
    paidUnitAmount: number | null;
    replacementUnitPrice: number | null;
    quantity: number;
  }>;
  currencyCode?: string | null;
}): {
  priceDifferenceDue: number;
  priceCreditDue: number;
  currencyCode: string;
} {
  let delta = 0;
  let known = false;
  for (const line of input.lines) {
    if (line.paidUnitAmount == null || line.replacementUnitPrice == null) continue;
    known = true;
    delta += (line.replacementUnitPrice - line.paidUnitAmount) * line.quantity;
  }
  if (!known) {
    throw new ShopifyReturnRequestError(
      "VALIDATION_ERROR",
      "Missing prices for exchange quote",
      400
    );
  }
  const rounded = Number(delta.toFixed(2));
  return {
    priceDifferenceDue: rounded > 0 ? rounded : 0,
    priceCreditDue: rounded < 0 ? Math.abs(rounded) : 0,
    currencyCode: String(input.currencyCode ?? "CHF").trim().toUpperCase() || "CHF",
  };
}

export async function quoteCustomerExchange(input: {
  orderId: string;
  returnLines: Array<{
    fulfillmentLineItemId: string;
    quantity: number;
    paidUnitAmount: number | null;
  }>;
  exchangeLines: Array<NativeExchangeLine & { unitPrice: number | null }>;
  currencyCode?: string | null;
}): Promise<{
  priceDifferenceDue: number;
  priceCreditDue: number;
  currencyCode: string;
}> {
  void input.orderId;
  return quoteCustomerExchangeFromPaidPair({
    currencyCode: input.currencyCode,
    lines: input.returnLines.map((line, index) => ({
      paidUnitAmount: line.paidUnitAmount,
      replacementUnitPrice: input.exchangeLines[index]?.unitPrice ?? null,
      quantity: line.quantity,
    })),
  });
}

async function suggestedOutcome(input: {
  returnId: string;
  returnLineItems: Array<{ id: string; quantity: number }>;
  exchangeLineItems: Array<{ id: string; quantity: number }>;
  allocation: "ORIGINAL_PAYMENT_METHODS" | "STORE_CREDIT";
}): Promise<FinancialOutcome> {
  const result = await shopifyGraphQL<{
    return?: {
      suggestedFinancialOutcome?: {
        financialTransfer?: FinancialOutcome;
      } | null;
    } | null;
  }>(SUGGESTED_FINANCIAL_OUTCOME, {
    id: input.returnId,
    returnLineItems: input.returnLineItems,
    exchangeLineItems: input.exchangeLineItems,
    refundMethodAllocation: input.allocation,
  });
  assertNoErrors("suggestedFinancialOutcome", result.errors, undefined);
  return result.data?.return?.suggestedFinancialOutcome?.financialTransfer ?? null;
}

function refundInput(outcome: Extract<FinancialOutcome, { __typename: "RefundReturnOutcome" }>) {
  const credit = amountFromBag(outcome.amount);
  if (credit <= ORIGINAL_PAYMENT_REFUND_MAX_CHF) {
    const orderTransactions = outcome.suggestedTransactions
      .filter((transaction) => transaction.parentTransaction?.id)
      .map((transaction) => ({
        parentId: transaction.parentTransaction!.id,
        transactionAmount: {
          amount: transaction.amountSet.presentmentMoney.amount,
          currencyCode: transaction.amountSet.presentmentMoney.currencyCode,
        },
      }));
    if (!orderTransactions.length) {
      throw new ShopifyReturnRequestError(
        "SERVER_ERROR",
        "Shopify did not provide a refundable payment transaction",
        502
      );
    }
    return {
      issueRefund: {
        allowOverRefunding: false,
        orderTransactions,
        refundMethods: [],
      },
    };
  }

  const storeCredit = outcome.suggestedRefundMethods.find(
    (method) => method.__typename === "SuggestedStoreCreditRefund"
  );
  if (!storeCredit) {
    throw new ShopifyReturnRequestError(
      "SERVER_ERROR",
      "Shopify did not provide a store-credit refund method",
      502
    );
  }
  return {
    issueRefund: {
      allowOverRefunding: false,
      orderTransactions: [],
      refundMethods: [
        {
          storeCreditRefund: {
            amount: {
              amount: storeCredit.amount.presentmentMoney.amount,
              currencyCode: storeCredit.amount.presentmentMoney.currencyCode,
            },
          },
        },
      ],
    },
  };
}

export async function openNativeCustomerExchange(input: {
  orderId: string;
  customerEmail: string;
  returnLines: NativeReturnLine[];
  exchangeLines: NativeExchangeLine[];
}): Promise<{
  return: NativeReturnShape;
  reverseFulfillmentOrderId: string;
  priceDifferenceDue: number;
  priceCreditDue: number;
  invoiceUrl: string | null;
  refundPreference: "original_payment" | "store_credit" | null;
}> {
  const returnReasonDefinitionIds = await Promise.all(
    input.returnLines.map((line) => resolveReturnReasonDefinitionId(line.returnReason))
  );
  const createdResult = await shopifyGraphQL<{
    returnCreate?: {
      return?: NativeReturnShape | null;
      userErrors?: UserError[];
    };
  }>(RETURN_CREATE, {
    returnInput: {
      orderId: input.orderId,
      requestedAt: new Date().toISOString(),
      returnLineItems: input.returnLines.map((line, index) => ({
        fulfillmentLineItemId: line.fulfillmentLineItemId,
        quantity: line.quantity,
        returnReasonDefinitionId: returnReasonDefinitionIds[index],
        returnReasonNote: String(line.reasonNote ?? "").slice(0, 255),
      })),
      exchangeLineItems: input.exchangeLines.map((line) => {
        const discount = Number(line.appliedDiscountAmount ?? 0);
        const currency =
          String(line.currencyCode ?? "CHF").trim().toUpperCase() || "CHF";
        return {
          variantId: line.variantId,
          quantity: line.quantity,
          ...(discount > 0.009
            ? {
                appliedDiscount: {
                  description: "Ajustement echange — prix paire paye",
                  value: {
                    amount: {
                      amount: discount.toFixed(2),
                      currencyCode: currency,
                    },
                  },
                },
              }
            : {}),
        };
      }),
    },
  });
  assertNoErrors(
    "returnCreate",
    createdResult.errors,
    createdResult.data?.returnCreate?.userErrors
  );
  const created = createdResult.data?.returnCreate?.return;
  if (!created?.id) {
    throw new ShopifyReturnRequestError("SERVER_ERROR", "Shopify returnCreate returned no return", 502);
  }

  const returnLineItems = created.returnLineItems.nodes.map((line) => ({
    id: line.id,
    quantity: line.processableQuantity || line.quantity,
  }));
  const exchangeLineItems = created.exchangeLineItems.nodes.map((line) => ({
    id: line.id,
    quantity: line.processableQuantity || line.quantity,
  }));
  if (!returnLineItems.length || !exchangeLineItems.length) {
    throw new ShopifyReturnRequestError(
      "SERVER_ERROR",
      "Shopify returnCreate did not create all exchange lines",
      502,
      { returnLineItems, exchangeLineItems }
    );
  }

  const paidPairQuote = quoteCustomerExchangeFromPaidPair({
    currencyCode: input.exchangeLines[0]?.currencyCode ?? "CHF",
    lines: input.returnLines.map((line, index) => ({
      paidUnitAmount: line.paidUnitAmount ?? null,
      replacementUnitPrice: input.exchangeLines[index]?.unitPrice ?? null,
      quantity: line.quantity,
    })),
  });

  let outcome = await suggestedOutcome({
    returnId: created.id,
    returnLineItems,
    exchangeLineItems,
    allocation: "ORIGINAL_PAYMENT_METHODS",
  });
  const due = paidPairQuote.priceDifferenceDue;
  const credit = paidPairQuote.priceCreditDue;

  let refundPreference: "original_payment" | "store_credit" | null = null;
  if (outcome?.__typename === "RefundReturnOutcome") {
    refundPreference =
      credit <= ORIGINAL_PAYMENT_REFUND_MAX_CHF ? "original_payment" : "store_credit";
    if (refundPreference === "store_credit") {
      outcome = await suggestedOutcome({
        returnId: created.id,
        returnLineItems,
        exchangeLineItems,
        allocation: "STORE_CREDIT",
      });
      if (outcome?.__typename !== "RefundReturnOutcome") {
        throw new ShopifyReturnRequestError(
          "SERVER_ERROR",
          "Shopify store-credit outcome was not available",
          502
        );
      }
    }
  }

  const processInput: Record<string, unknown> = {
    returnId: created.id,
    returnLineItems,
    exchangeLineItems,
    notifyCustomer: true,
    note: "Échange client via portail Resell Lausanne",
  };
  if (outcome?.__typename === "RefundReturnOutcome") {
    processInput.financialTransfer = refundInput(outcome);
  }

  const processedResult = await shopifyGraphQL<{
    returnProcess?: {
      return?: NativeReturnShape | null;
      userErrors?: UserError[];
    };
  }>(RETURN_PROCESS, { input: processInput });
  assertNoErrors(
    "returnProcess",
    processedResult.errors,
    processedResult.data?.returnProcess?.userErrors
  );
  const processed = processedResult.data?.returnProcess?.return;
  if (!processed?.id) {
    throw new ShopifyReturnRequestError(
      "SERVER_ERROR",
      "Shopify returnProcess returned no return",
      502
    );
  }

  if (due > 0) {
    const invoiceResult = await shopifyGraphQL<{
      orderInvoiceSend?: { userErrors?: UserError[] };
    }>(ORDER_INVOICE_SEND, {
      id: processed.order.id,
      email: {
        to: input.customerEmail,
        customMessage:
          "Votre échange est enregistré. Réglez la différence pour recevoir votre étiquette de retour.",
      },
    });
    assertNoErrors(
      "orderInvoiceSend",
      invoiceResult.errors,
      invoiceResult.data?.orderInvoiceSend?.userErrors
    );
  }

  const reverseFulfillmentOrderId =
    processed.reverseFulfillmentOrders?.nodes?.[0]?.id ??
    created.reverseFulfillmentOrders?.nodes?.[0]?.id ??
    "";
  if (!reverseFulfillmentOrderId) {
    throw new ShopifyReturnRequestError(
      "SERVER_ERROR",
      "Shopify native exchange has no reverse fulfillment order",
      502
    );
  }

  return {
    return: processed,
    reverseFulfillmentOrderId,
    priceDifferenceDue: due,
    priceCreditDue: credit,
    invoiceUrl: processed.order.statusPageUrl ?? null,
    refundPreference,
  };
}
