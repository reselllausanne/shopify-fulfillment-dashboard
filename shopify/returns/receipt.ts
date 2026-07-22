import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { restockShopifyReturnOnReceipt } from "@/shopify/returns/restockOnReceipt";

const STORE_CREDIT_ACCOUNT_CREDIT_MUTATION = /* GraphQL */ `
mutation StoreCreditAccountCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
  storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
    storeCreditAccountTransaction {
      id
      amount {
        amount
        currencyCode
      }
      account {
        id
        balance {
          amount
          currencyCode
        }
      }
    }
    userErrors {
      message
      field
      code
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

  const raw = (row.rawJson as any) || {};
  const customerId = String(raw?.order?.customerId || "").trim();
  const grossAmount = Number(row.returnAmount);
  const currencyCode = String(row.currency || "CHF").trim() || "CHF";

  // Restocking fee: Shopify stores it per return line item (restockingFeeAmount in shopMoney).
  // Sum across all lines and deduct from the gross return amount to get the net store credit.
  // This enforces the 10% return fee the business applies to every return.
  const lineItems: Array<any> = Array.isArray(raw?.lineItems) ? raw.lineItems : [];
  let restockingFeeTotal = 0;
  for (const line of lineItems) {
    const lineFee = Number(line?.restockingFeeAmount);
    if (Number.isFinite(lineFee) && lineFee > 0) {
      restockingFeeTotal += lineFee * (Number(line?.quantity) || 1);
    } else if (Number(line?.restockingFeePercent) > 0) {
      const unit = Number(line?.unitAmount) || 0;
      const qty = Number(line?.quantity) || 1;
      restockingFeeTotal += (unit * qty * Number(line.restockingFeePercent)) / 100;
    }
  }
  restockingFeeTotal = Number(restockingFeeTotal.toFixed(2));
  const amount = Number(Math.max(0, grossAmount - restockingFeeTotal).toFixed(2));
  console.log("[SHOPIFY_STORE_CREDIT] return", row.externalReturnId, "gross:", grossAmount, "restockingFee:", restockingFeeTotal, "net store credit:", amount, currencyCode);

  if (!customerId) {
    const failureMessage = "Missing Shopify customer ID on return row";
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

  const result = await shopifyGraphQL<{
    storeCreditAccountCredit?: {
      storeCreditAccountTransaction?: {
        id?: string | null;
        amount?: { amount?: string | null; currencyCode?: string | null } | null;
        account?: {
          id?: string | null;
          balance?: { amount?: string | null; currencyCode?: string | null } | null;
        } | null;
      } | null;
      userErrors?: Array<{ code?: string | null; field?: string[] | null; message?: string | null }>;
    };
  }>(STORE_CREDIT_ACCOUNT_CREDIT_MUTATION, {
    id: customerId,
    creditInput: {
      creditAmount: {
        amount: amount.toFixed(2),
        currencyCode,
      },
      notify: true,
    },
  });

  if (result.errors?.length) {
    const failureMessage = "Shopify store credit mutation failed";
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
          response: result.errors,
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

  const userErrors = result.data?.storeCreditAccountCredit?.userErrors ?? [];
  if (userErrors.length > 0) {
    const failureMessage = userErrors.map((e) => e.message).filter(Boolean).join("; ") || "Store credit user error";
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
          response: userErrors,
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

  const transaction = result.data?.storeCreditAccountCredit?.storeCreditAccountTransaction;
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

  await prisma.marketplaceReturn.update({
    where: { id: row.id },
    data: {
      localStatus: "completed",
      processStep: "close_done",
      receivedAt: now,
      completedAt: now,
      failureMessage: null,
      refundIdsJson: (transaction?.id ? [transaction.id] : row.refundIdsJson) as any,
      rawJson: {
        ...(raw || {}),
        storeCredit: {
          issuedAt: now.toISOString(),
          transaction,
        },
        restock: restock ?? undefined,
      },
      auditLogJson: pushAudit(row.auditLogJson, {
        at: now.toISOString(),
        step: "shopify_store_credit_issue",
        ok: true,
        customerId,
        amount: amount.toFixed(2),
        currencyCode,
        transactionId: transaction?.id || null,
        restockOk: restock?.ok ?? null,
        restockLines: restock?.lines ?? null,
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
