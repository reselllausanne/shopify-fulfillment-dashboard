import { prisma } from "@/app/lib/prisma";
import { buildDecathlonOrdersClient } from "@/decathlon/mirakl/ordersClient";
import {
  getDecathlonRefundReasonCode,
  isReturnAutomationDryRun,
  type MarketplaceReturnProcessStep,
  type ReturnAuditEntry,
} from "./config";
import { appendAuditLog, extractReturnsList, normalizeMiraklReturnStatus, pickString } from "./mapReturn";
import { resolveRemoteReturnStatus } from "./remoteStatus";

type OrdersClient = ReturnType<typeof buildDecathlonOrdersClient>;

function isUuidLike(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id
  );
}

async function patchReturn(id: string, data: Record<string, unknown>) {
  return prisma.marketplaceReturn.update({ where: { id }, data: data as any });
}

function isAlreadyRefundedLineError(message: string): boolean {
  const text = String(message ?? "");
  return (
    /incorrect status of the order line\(s\)/i.test(text) &&
    /state['"]?\s*:\s*['"]?refunded['"]?/i.test(text)
  );
}

function isInvalidStateError(message: string): boolean {
  return /invalid state/i.test(String(message ?? ""));
}

async function receiveRemote(
  client: OrdersClient,
  externalReturnId: string,
  apiSource: string | null,
  dryRun: boolean
): Promise<{ actionId: string | null; endpoint: string; response: unknown }> {
  // Decathlon seller front has no Connect v2 returns API (404). Prefer RT25 for UUID returns.
  const preferRt = apiSource === "rt11" || isUuidLike(externalReturnId);
  if (dryRun) {
    const endpoint = preferRt
      ? `PUT /api/returns/receive`
      : `PUT /v2/orders/returns/${externalReturnId}/receive`;
    return {
      actionId: `dry-run-receive-${externalReturnId}`,
      endpoint,
      response: { dryRun: true, wouldCall: endpoint },
    };
  }

  if (preferRt) {
    const response = await client.receiveReturnsRt25([externalReturnId]);
    const err = response?.return_errors?.[0];
    if (err) throw new Error(err.message ?? `RT25 receive failed for ${externalReturnId}`);
    return {
      actionId: pickString(response?.return_success?.[0]?.id, externalReturnId),
      endpoint: "PUT /api/returns/receive",
      response,
    };
  }

  const response = await client.receiveReturnV2(externalReturnId);
  return {
    actionId: pickString(response?.action_id, response?.tracking_id),
    endpoint: `PUT /v2/orders/returns/${externalReturnId}/receive`,
    response,
  };
}

async function refundRemote(
  client: OrdersClient,
  row: {
    externalOrderLineId: string | null;
    returnAmount: any;
    currency: string;
    quantity: number;
  },
  dryRun: boolean
): Promise<{ refundIds: string[]; endpoint: string; request: unknown; response: unknown }> {
  const orderLineId = pickString(row.externalOrderLineId);
  if (!orderLineId) {
    throw new Error("Missing external_order_line_id — cannot refund line safely");
  }
  const amount = Number(row.returnAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid return_amount — refusing refund");
  }
  const reasonCode = getDecathlonRefundReasonCode();
  const request = {
    order_tax_mode: "TAX_INCLUDED" as const,
    refunds: [
      {
        order_line_id: orderLineId,
        amount,
        shipping_amount: 0,
        reason_code: reasonCode,
        quantity: row.quantity ?? 1,
        currency_iso_code: row.currency || "CHF",
      },
    ],
  };
  const endpoint = "PUT /api/orders/refund";

  if (dryRun) {
    return {
      refundIds: [`dry-run-refund-${orderLineId}`],
      endpoint,
      request,
      response: { dryRun: true, wouldCall: endpoint, body: request },
    };
  }

  const response = await client.refundOrderLines(request);
  const refundIds = (response?.refunds ?? [])
    .map((r) => pickString(r.refund_id, r.order_refund_id))
    .filter((id): id is string => Boolean(id));
  if (!refundIds.length) {
    throw new Error("OR28 refund returned no refund_id");
  }
  return { refundIds, endpoint, request, response };
}

async function closeRemote(
  client: OrdersClient,
  externalReturnId: string,
  apiSource: string | null,
  dryRun: boolean
): Promise<{ actionId: string | null; endpoint: string; response: unknown }> {
  const preferRt = apiSource === "rt11" || isUuidLike(externalReturnId);
  if (dryRun) {
    const endpoint = preferRt
      ? `PUT /api/returns/close`
      : `PUT /v2/orders/returns/${externalReturnId}/close`;
    return {
      actionId: `dry-run-close-${externalReturnId}`,
      endpoint,
      response: { dryRun: true, wouldCall: endpoint },
    };
  }

  if (preferRt) {
    const response = await client.closeReturnsRt27([externalReturnId]);
    const err = response?.return_errors?.[0];
    if (err) throw new Error(err.message ?? `RT27 close failed for ${externalReturnId}`);
    return {
      actionId: pickString(response?.return_success?.[0]?.id, externalReturnId),
      endpoint: "PUT /api/returns/close",
      response,
    };
  }

  const response = await client.closeReturnV2(externalReturnId);
  return {
    actionId: pickString(response?.action_id, response?.tracking_id),
    endpoint: `PUT /v2/orders/returns/${externalReturnId}/close`,
    response,
  };
}

export type ProcessReturnResult = {
  ok: boolean;
  dryRun: boolean;
  id: string;
  localStatus: string;
  processStep: string;
  failureMessage?: string | null;
  message: string;
};

/**
 * Claim row for processing with FOR UPDATE.
 * Allows: pending_receipt | failed | received
 * Blocks: processing | completed | rejected
 */
async function claimForProcessing(id: string): Promise<
  | { ok: true; row: any }
  | { ok: false; result: ProcessReturnResult }
> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe<any[]>(
      `SELECT * FROM "marketplace_returns" WHERE "id" = $1 FOR UPDATE`,
      id
    );
    const row = rows[0];
    if (!row) {
      return {
        ok: false as const,
        result: {
          ok: false,
          dryRun: isReturnAutomationDryRun(),
          id,
          localStatus: "failed",
          processStep: "pending",
          message: "Return not found",
        },
      };
    }

    if (row.localStatus === "completed" && row.processStep === "close_done") {
      return {
        ok: false as const,
        result: {
          ok: true,
          dryRun: isReturnAutomationDryRun(),
          id: row.id,
          localStatus: row.localStatus,
          processStep: row.processStep,
          message: "Already completed",
        },
      };
    }

    if (row.localStatus === "rejected") {
      return {
        ok: false as const,
        result: {
          ok: false,
          dryRun: isReturnAutomationDryRun(),
          id: row.id,
          localStatus: row.localStatus,
          processStep: row.processStep,
          failureMessage: "Return is rejected locally",
          message: "Cannot confirm a rejected return",
        },
      };
    }

    if (row.localStatus === "processing") {
      return {
        ok: false as const,
        result: {
          ok: false,
          dryRun: isReturnAutomationDryRun(),
          id: row.id,
          localStatus: row.localStatus,
          processStep: row.processStep,
          failureMessage: "Already processing",
          message: "Return is already being processed",
        },
      };
    }

    await tx.marketplaceReturn.update({
      where: { id: row.id },
      data: { localStatus: "processing", failureMessage: null },
    });

    return { ok: true as const, row: { ...row, localStatus: "processing" } };
  });
}

async function runProcessPipeline(options: {
  row: any;
  client: OrdersClient;
  dryRun: boolean;
}): Promise<ProcessReturnResult> {
  const { client, dryRun } = options;
  const row = options.row;
  let processStep = String(row.processStep ?? "pending") as MarketplaceReturnProcessStep;
  let auditLog = row.auditLogJson;
  let receiveActionId = row.receiveActionId;
  let refundIdsJson = row.refundIdsJson;
  let closeActionId = row.closeActionId;
  let receivedAt = row.receivedAt ? new Date(row.receivedAt) : null;
  const remoteStatus = String(row.miraklStatus ?? "")
    .trim()
    .toUpperCase();

  try {
    if (processStep === "pending" && remoteStatus === "RECEIVED") {
      const entry: ReturnAuditEntry = {
        at: new Date().toISOString(),
        step: "receive",
        dryRun,
        ok: true,
        endpoint: "skip",
        response: { skipped: true, reason: "Mirakl return already RECEIVED" },
      };
      auditLog = appendAuditLog(auditLog, entry);
      processStep = "receive_done";
      receivedAt = receivedAt ?? new Date();
      await patchReturn(row.id, {
        processStep,
        receivedAt,
        auditLogJson: auditLog,
      });
    }

    if (processStep === "pending") {
      const result = await receiveRemote(client, row.externalReturnId, row.apiSource, dryRun);
      const entry: ReturnAuditEntry = {
        at: new Date().toISOString(),
        step: "receive",
        dryRun,
        ok: true,
        endpoint: result.endpoint,
        response: result.response,
      };
      auditLog = appendAuditLog(auditLog, entry);
      receiveActionId = result.actionId;
      receivedAt = new Date();
      processStep = "receive_done";
      await patchReturn(row.id, {
        processStep,
        receiveActionId,
        receivedAt,
        auditLogJson: auditLog,
        miraklStatus: dryRun ? row.miraklStatus : "RECEIVED",
      });
    }

    if (processStep === "receive_done") {
      try {
        const result = await refundRemote(
          client,
          {
            externalOrderLineId: row.externalOrderLineId,
            returnAmount: row.returnAmount,
            currency: row.currency,
            quantity: Number(row.quantity ?? 1),
          },
          dryRun
        );
        const entry: ReturnAuditEntry = {
          at: new Date().toISOString(),
          step: "refund",
          dryRun,
          ok: true,
          endpoint: result.endpoint,
          request: result.request,
          response: result.response,
        };
        auditLog = appendAuditLog(auditLog, entry);
        refundIdsJson = result.refundIds;
        processStep = "refund_done";
        await patchReturn(row.id, {
          processStep,
          refundIdsJson,
          auditLogJson: auditLog,
        });
      } catch (error: any) {
        const message = String(error?.message ?? error);
        if (!isAlreadyRefundedLineError(message)) {
          throw error;
        }
        const entry: ReturnAuditEntry = {
          at: new Date().toISOString(),
          step: "refund",
          dryRun,
          ok: true,
          endpoint: "skip",
          response: {
            skipped: true,
            reason: "Order line already refunded on Mirakl",
            error: message,
          },
        };
        auditLog = appendAuditLog(auditLog, entry);
        processStep = "refund_done";
        await patchReturn(row.id, {
          processStep,
          auditLogJson: auditLog,
        });
      }
    }

    if (processStep === "refund_done") {
      try {
        const result = await closeRemote(client, row.externalReturnId, row.apiSource, dryRun);
        const entry: ReturnAuditEntry = {
          at: new Date().toISOString(),
          step: "close",
          dryRun,
          ok: true,
          endpoint: result.endpoint,
          response: result.response,
        };
        auditLog = appendAuditLog(auditLog, entry);
        closeActionId = result.actionId;
        processStep = "close_done";
        await patchReturn(row.id, {
          processStep,
          closeActionId,
          auditLogJson: auditLog,
          localStatus: "completed",
          completedAt: new Date(),
          miraklStatus: dryRun ? row.miraklStatus : "CLOSED",
          failureMessage: null,
        });
        return {
          ok: true,
          dryRun,
          id: row.id,
          localStatus: "completed",
          processStep,
          message: dryRun
            ? "Dry-run completed (no Mirakl mutations)"
            : "Return received, refunded, and closed",
        };
      } catch (error: any) {
        const message = String(error?.message ?? error);
        if (!isInvalidStateError(message) || dryRun) {
          throw error;
        }
        const remoteStatus = await resolveRemoteReturnStatus({
          client,
          externalReturnId: String(row.externalReturnId),
        });
        if (remoteStatus !== "CLOSED") {
          throw error;
        }
        const entry: ReturnAuditEntry = {
          at: new Date().toISOString(),
          step: "close",
          dryRun,
          ok: true,
          endpoint: "skip",
          response: {
            skipped: true,
            reason: "Mirakl return already CLOSED",
            error: message,
          },
        };
        auditLog = appendAuditLog(auditLog, entry);
        processStep = "close_done";
        await patchReturn(row.id, {
          processStep,
          closeActionId,
          auditLogJson: auditLog,
          localStatus: "completed",
          completedAt: new Date(),
          miraklStatus: "CLOSED",
          failureMessage: null,
        });
        return {
          ok: true,
          dryRun,
          id: row.id,
          localStatus: "completed",
          processStep,
          message: "Return already closed remotely (local state reconciled)",
        };
      }
    }

    if (processStep === "close_done") {
      await patchReturn(row.id, { localStatus: "completed", failureMessage: null });
      return {
        ok: true,
        dryRun,
        id: row.id,
        localStatus: "completed",
        processStep,
        message: "Already completed",
      };
    }

    throw new Error(`Unexpected processStep ${processStep}`);
  } catch (error: any) {
    const message = String(error?.message ?? error);
    const failingStep =
      processStep === "pending" ? "receive" : processStep === "receive_done" ? "refund" : "close";
    auditLog = appendAuditLog(auditLog, {
      at: new Date().toISOString(),
      step: failingStep,
      dryRun,
      ok: false,
      error: message,
    });

    // If refund already succeeded (processStep advanced to refund_done before close threw,
    // or we entered with refund_done), never refund again — mark close pending.
    const closePending = processStep === "refund_done" || failingStep === "close";
    const failureMessage = closePending ? `close pending: ${message}` : message;

    await patchReturn(row.id, {
      localStatus: "failed",
      failureMessage,
      auditLogJson: auditLog,
      processStep,
      receiveActionId,
      refundIdsJson,
      closeActionId,
      receivedAt,
    });

    return {
      ok: false,
      dryRun,
      id: row.id,
      localStatus: "failed",
      processStep,
      failureMessage,
      message: failureMessage,
    };
  }
}

export async function confirmMarketplaceReturn(options: {
  id: string;
  client?: OrdersClient;
  forceDryRun?: boolean;
}): Promise<ProcessReturnResult> {
  const dryRun = options.forceDryRun ?? isReturnAutomationDryRun();
  const client = options.client ?? buildDecathlonOrdersClient();
  const claimed = await claimForProcessing(options.id);
  if (!claimed.ok) return claimed.result;
  return runProcessPipeline({ row: claimed.row, client, dryRun });
}

export async function rejectMarketplaceReturn(options: {
  id: string;
  staffNote?: string | null;
}): Promise<ProcessReturnResult> {
  const row = await prisma.marketplaceReturn.findUnique({ where: { id: options.id } });
  if (!row) {
    return {
      ok: false,
      dryRun: isReturnAutomationDryRun(),
      id: options.id,
      localStatus: "failed",
      processStep: "pending",
      failureMessage: "Not found",
      message: "Return not found",
    };
  }
  if (
    row.localStatus === "completed" ||
    row.processStep === "refund_done" ||
    row.processStep === "close_done"
  ) {
    return {
      ok: false,
      dryRun: isReturnAutomationDryRun(),
      id: row.id,
      localStatus: row.localStatus,
      processStep: row.processStep,
      failureMessage: "Already processed remotely — cannot reject",
      message: "Already processed remotely — cannot reject",
    };
  }

  const note = String(options.staffNote ?? "").trim() || null;
  const auditLog = appendAuditLog(row.auditLogJson, {
    at: new Date().toISOString(),
    step: "reject_local",
    ok: true,
    response: { staffNote: note, miraklCalled: false },
  });

  await patchReturn(row.id, {
    localStatus: "rejected",
    staffNote: note,
    failureMessage: null,
    auditLogJson: auditLog,
  });

  return {
    ok: true,
    dryRun: isReturnAutomationDryRun(),
    id: row.id,
    localStatus: "rejected",
    processStep: row.processStep,
    message: "Marked rejected locally (no Mirakl call)",
  };
}

export async function retryFailedMarketplaceReturn(options: {
  id: string;
  client?: OrdersClient;
  forceDryRun?: boolean;
}): Promise<ProcessReturnResult> {
  const row = await prisma.marketplaceReturn.findUnique({ where: { id: options.id } });
  if (!row) {
    return {
      ok: false,
      dryRun: options.forceDryRun ?? isReturnAutomationDryRun(),
      id: options.id,
      localStatus: "failed",
      processStep: "pending",
      message: "Return not found",
    };
  }
  if (row.localStatus !== "failed") {
    return {
      ok: false,
      dryRun: options.forceDryRun ?? isReturnAutomationDryRun(),
      id: row.id,
      localStatus: row.localStatus,
      processStep: row.processStep,
      message: "Retry only allowed for failed returns",
    };
  }
  return confirmMarketplaceReturn({
    id: row.id,
    client: options.client,
    forceDryRun: options.forceDryRun,
  });
}
