import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import {
  resolveProcessReturnLineItems,
} from "@/shopify/returns/returnLineItemsForReceipt";
import { computeReturnRestockingFeeTotal } from "@/shopify/returns/restockingFee";
import { applyShopifyReturnToOrderMatches } from "@/shopify/returns/applyReturnToOrderMatch";
import { restockShopifyReturnOnReceipt } from "@/shopify/returns/restockOnReceipt";
import { intakeLocalStockLotsFromReturnReceipt } from "@/shopify/localStock/intakeFromReturnReceipt";

/**
 * Issue store credit via returnProcess + refundMethods.storeCreditRefund.
 *
 * Prefer this over storeCreditAccountCredit: that mutation needs
 * write_store_credit_account_transactions, which custom-app tokens often lack.
 * returnProcess only needs write_returns (already required for the returns flow).
 */
const RETURN_PROCESS_MUTATION = /* GraphQL */ `
mutation ReturnProcess($input: ReturnProcessInput!) {
  returnProcess(input: $input) {
    return {
      id
      status
    }
    userErrors {
      field
      message
      code
    }
  }
}
`;

const RETURN_CLOSE_MUTATION = /* GraphQL */ `
mutation ReturnClose($id: ID!) {
  returnClose(id: $id) {
    return {
      id
      status
    }
    userErrors {
      field
      message
      code
    }
  }
}
`;

const RETURN_SUGGESTED_REFUND_QUERY = /* GraphQL */ `
query ReturnSuggestedRefund(
  $id: ID!
  $returnRefundLineItems: [ReturnRefundLineItemInput!]!
) {
  return(id: $id) {
    id
    status
    suggestedRefund(returnRefundLineItems: $returnRefundLineItems) {
      amount {
        shopMoney {
          amount
          currencyCode
        }
      }
    }
  }
}
`;

type ReceiptActionResult = {
  ok: boolean;
  id: string;
  localStatus: string;
  processStep: string;
  message: string;
  failureMessage?: string | null;
};

function pushAudit(existing: unknown, entry: Record<string, unknown>) {
  const arr = Array.isArray(existing) ? [...existing] : [];
  arr.push(entry);
  return arr;
}

function formatGraphqlFailure(
  fallback: string,
  errors?: Array<{ message?: string | null } | null> | null
): string {
  const messages = (errors ?? [])
    .map((e) => String(e?.message || "").trim())
    .filter(Boolean);
  if (!messages.length) return fallback;
  return `${fallback}: ${messages.join("; ")}`;
}

export async function confirmShopifyReturnReceipt(options: {
  id: string;
}): Promise<ReceiptActionResult> {
  const row = await prisma.marketplaceReturn.findUnique({ where: { id: options.id } });
  if (!row) {
    return {
      ok: false,
      id: options.id,
      localStatus: "failed",
      processStep: "pending",
      message: "Return not found",
      failureMessage: "Return not found",
    };
  }
  if (row.platform !== "shopify") {
    return {
      ok: false,
      id: row.id,
      localStatus: row.localStatus,
      processStep: row.processStep,
      message: "Not a Shopify return",
      failureMessage: "Not a Shopify return",
    };
  }
  if (row.localStatus === "completed") {
    return {
      ok: true,
      id: row.id,
      localStatus: row.localStatus,
      processStep: row.processStep,
      message: "Already completed",
    };
  }

  if (row.localStatus === "failed") {
    await prisma.marketplaceReturn.update({
      where: { id: row.id },
      data: {
        localStatus: "processing",
        failureMessage: null,
      },
    });
  }

  const raw = (row.rawJson as any) || {};
  const returnId = String(row.externalReturnId || raw?.return?.id || "").trim();
  const grossAmount = Number(row.returnAmount);
  const currencyCode = String(row.currency || "CHF").trim() || "CHF";

  if (!returnId) {
    const failureMessage = "Missing Shopify return ID on return row";
    await prisma.marketplaceReturn.update({
      where: { id: row.id },
      data: {
        localStatus: "failed",
        failureMessage,
        auditLogJson: pushAudit(row.auditLogJson, {
          at: new Date().toISOString(),
          step: "shopify_store_credit_issue",
          ok: false,
          error: failureMessage,
        }),
      },
    });
    return {
      ok: false,
      id: row.id,
      localStatus: "failed",
      processStep: row.processStep,
      message: failureMessage,
      failureMessage,
    };
  }

  const resolvedLines = await resolveProcessReturnLineItems({ rawJson: raw, returnId });
  const processReturnLineItems = resolvedLines.items;

  if (!processReturnLineItems.length) {
    const failureMessage = "Missing Shopify return line item IDs";
    await prisma.marketplaceReturn.update({
      where: { id: row.id },
      data: {
        localStatus: "failed",
        failureMessage,
        auditLogJson: pushAudit(row.auditLogJson, {
          at: new Date().toISOString(),
          step: "shopify_store_credit_issue",
          ok: false,
          error: failureMessage,
        }),
      },
    });
    return {
      ok: false,
      id: row.id,
      localStatus: "failed",
      processStep: row.processStep,
      message: failureMessage,
      failureMessage,
    };
  }

  const feeLines =
    resolvedLines.lineItemsForStorage.length > 0
      ? (resolvedLines.lineItemsForStorage as Array<Record<string, unknown>>)
      : ((Array.isArray(raw?.lineItems) ? raw.lineItems : []) as Array<Record<string, unknown>>);
  const feeComputation = computeReturnRestockingFeeTotal({
    lineItems: feeLines,
    grossAmount,
  });
  const { restockingFeeTotal, netAmount: amount, appliedDefaultPercent } = feeComputation;

  console.log(
    "[SHOPIFY_STORE_CREDIT] return",
    row.externalReturnId,
    "gross:",
    grossAmount,
    "restockingFee:",
    restockingFeeTotal,
    "defaultPercentApplied:",
    appliedDefaultPercent,
    "net store credit:",
    amount,
    currencyCode
  );

  if (!Number.isFinite(amount) || amount <= 0) {
    const failureMessage = "Invalid return amount for store credit";
    await prisma.marketplaceReturn.update({
      where: { id: row.id },
      data: {
        localStatus: "failed",
        failureMessage,
        auditLogJson: pushAudit(row.auditLogJson, {
          at: new Date().toISOString(),
          step: "shopify_store_credit_issue",
          ok: false,
          error: failureMessage,
        }),
      },
    });
    return {
      ok: false,
      id: row.id,
      localStatus: "failed",
      processStep: row.processStep,
      message: failureMessage,
      failureMessage,
    };
  }

  // Prefer Shopify suggested net when the return already has restocking fees configured.
  let creditAmount = amount.toFixed(2);
  let creditCurrency = currencyCode;
  if (!appliedDefaultPercent) {
    const suggested = await shopifyGraphQL<{
      return?: {
        id?: string | null;
        status?: string | null;
        suggestedRefund?: {
          amount?: { shopMoney?: { amount?: string | null; currencyCode?: string | null } | null } | null;
        } | null;
      } | null;
    }>(RETURN_SUGGESTED_REFUND_QUERY, {
      id: returnId,
      returnRefundLineItems: processReturnLineItems.map((line) => ({
        returnLineItemId: line.id,
        quantity: line.quantity,
      })),
    });

    const suggestedMoney = suggested.data?.return?.suggestedRefund?.amount?.shopMoney;
    if (suggestedMoney?.amount != null && Number(suggestedMoney.amount) > 0) {
      creditAmount = Number(suggestedMoney.amount).toFixed(2);
      creditCurrency = String(suggestedMoney.currencyCode || currencyCode).trim() || currencyCode;
    }
  }

  const processResult = await shopifyGraphQL<{
    returnProcess?: {
      return?: { id?: string | null; status?: string | null } | null;
      userErrors?: Array<{ code?: string | null; field?: string[] | null; message?: string | null }>;
    };
  }>(RETURN_PROCESS_MUTATION, {
    input: {
      returnId,
      returnLineItems: processReturnLineItems,
      financialTransfer: {
        issueRefund: {
          orderTransactions: [],
          refundMethods: [
            {
              storeCreditRefund: {
                amount: {
                  amount: creditAmount,
                  currencyCode: creditCurrency,
                },
              },
            },
          ],
        },
      },
      notifyCustomer: true,
    },
  });

  if (processResult.errors?.length) {
    const failureMessage = formatGraphqlFailure(
      "Shopify store credit mutation failed",
      processResult.errors
    );
    await prisma.marketplaceReturn.update({
      where: { id: row.id },
      data: {
        localStatus: "failed",
        failureMessage,
        auditLogJson: pushAudit(row.auditLogJson, {
          at: new Date().toISOString(),
          step: "shopify_store_credit_issue",
          ok: false,
          error: failureMessage,
          response: processResult.errors,
        }),
      },
    });
    return {
      ok: false,
      id: row.id,
      localStatus: "failed",
      processStep: row.processStep,
      message: failureMessage,
      failureMessage,
    };
  }

  const processUserErrors = processResult.data?.returnProcess?.userErrors ?? [];
  if (processUserErrors.length > 0) {
    const failureMessage =
      processUserErrors.map((e) => e.message).filter(Boolean).join("; ") ||
      "Store credit user error";
    await prisma.marketplaceReturn.update({
      where: { id: row.id },
      data: {
        localStatus: "failed",
        failureMessage,
        auditLogJson: pushAudit(row.auditLogJson, {
          at: new Date().toISOString(),
          step: "shopify_store_credit_issue",
          ok: false,
          error: failureMessage,
          response: processUserErrors,
        }),
      },
    });
    return {
      ok: false,
      id: row.id,
      localStatus: "failed",
      processStep: row.processStep,
      message: failureMessage,
      failureMessage,
    };
  }

  // Financial transfer can succeed while return stays OPEN (no dispositions).
  // Close so staff UI / sync see a terminal Shopify status.
  let closedStatus = String(processResult.data?.returnProcess?.return?.status || "").toUpperCase();
  if (closedStatus !== "CLOSED") {
    const closeResult = await shopifyGraphQL<{
      returnClose?: {
        return?: { id?: string | null; status?: string | null } | null;
        userErrors?: Array<{ code?: string | null; field?: string[] | null; message?: string | null }>;
      };
    }>(RETURN_CLOSE_MUTATION, { id: returnId });

    const closeErrors = [
      ...(closeResult.errors ?? []).map((e) => ({ message: e.message })),
      ...(closeResult.data?.returnClose?.userErrors ?? []),
    ];
    if (closeErrors.length) {
      console.warn("[SHOPIFY][RETURN][RECEIPT] returnClose soft-fail", {
        id: row.id,
        returnId,
        errors: closeErrors,
      });
    } else {
      closedStatus = String(closeResult.data?.returnClose?.return?.status || "CLOSED").toUpperCase();
    }
  }

  const now = new Date();

  // Restock the returned pair: existing Shopify variant -> Bussigny stock +qty,
  // and THE_ DB row for Galaxus/Decathlon export. Non-fatal: store credit already
  // issued, so restock failures are logged but never fail the receipt.
  let restock: Awaited<ReturnType<typeof restockShopifyReturnOnReceipt>> | null = null;
  try {
    restock = await restockShopifyReturnOnReceipt({ rawJson: raw });
  } catch (error: any) {
    console.error("[SHOPIFY][RETURN][RECEIPT] Restock failed", {
      id: row.id,
      error: error?.message ?? error,
    });
    restock = { ok: false, lines: [] };
  }

  let orderMatchApply: Awaited<ReturnType<typeof applyShopifyReturnToOrderMatches>> | null =
    null;
  try {
    orderMatchApply = await applyShopifyReturnToOrderMatches({
      externalOrderId: row.externalOrderId,
      lineItems:
        resolvedLines.lineItemsForStorage.length > 0
          ? resolvedLines.lineItemsForStorage
          : ((Array.isArray(raw?.lineItems) ? raw.lineItems : []) as typeof resolvedLines.lineItemsForStorage),
      returnReasonCode: row.returnReasonCode,
      marketplaceReturnId: row.id,
      appliedAt: now,
    });
  } catch (error: any) {
    console.error("[SHOPIFY][RETURN][RECEIPT] OrderMatch return apply failed", {
      id: row.id,
      error: error?.message ?? error,
    });
    orderMatchApply = null;
  }

  let localStockIntake:
    | Awaited<ReturnType<typeof intakeLocalStockLotsFromReturnReceipt>>
    | null = null;
  try {
    localStockIntake = await intakeLocalStockLotsFromReturnReceipt({
      marketplaceReturnId: row.id,
      updatedMatchIds: orderMatchApply?.updatedMatchIds ?? [],
      restockLines: restock?.lines ?? [],
      now,
    });
  } catch (error: any) {
    console.error("[SHOPIFY][RETURN][RECEIPT] Local stock lot intake failed", {
      id: row.id,
      error: error?.message ?? error,
    });
    localStockIntake = null;
  }

  await prisma.marketplaceReturn.update({
    where: { id: row.id },
    data: {
      localStatus: "completed",
      processStep: "close_done",
      receivedAt: now,
      completedAt: now,
      failureMessage: null,
      miraklStatus: closedStatus || "CLOSED",
      rawJson: {
        ...(raw || {}),
        lineItems:
          resolvedLines.lineItemsForStorage.length > 0
            ? resolvedLines.lineItemsForStorage
            : raw?.lineItems,
        restockingFee: {
          total: restockingFeeTotal,
          appliedDefaultPercent,
        },
        storeCredit: {
          issuedAt: now.toISOString(),
          method: "returnProcess",
          amount: creditAmount,
          currencyCode: creditCurrency,
        },
        restock: restock ?? undefined,
        orderMatchApply: orderMatchApply ?? undefined,
        localStockIntake: localStockIntake ?? undefined,
      },
      auditLogJson: pushAudit(row.auditLogJson, {
        at: now.toISOString(),
        step: "shopify_store_credit_issue",
        ok: true,
        returnId,
        amount: creditAmount,
        currencyCode: creditCurrency,
        restockingFeeTotal,
        appliedDefaultPercent,
        shopifyStatus: closedStatus || null,
        restockOk: restock?.ok ?? null,
        restockLines: restock?.lines ?? null,
        orderMatchApply,
        localStockIntake,
      }),
    },
  });

  return {
    ok: true,
    id: row.id,
    localStatus: "completed",
    processStep: "close_done",
    message: restock && !restock.ok
      ? "Return received. Store credit issued. Restock partial — check audit log."
      : "Return received. Store credit issued. Restocked.",
  };
}
