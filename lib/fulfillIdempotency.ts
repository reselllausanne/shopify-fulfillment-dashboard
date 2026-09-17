/**
 * Persistent fulfill idempotency with external side-effect awareness.
 *
 * Statuses:
 * - IN_PROGRESS
 * - COMPLETED
 * - FAILED_BEFORE_EXTERNAL_SIDE_EFFECT  → same-key atomic retry OK
 * - EXTERNAL_SIDE_EFFECT_UNKNOWN        → no auto retry, reconcile required
 * - EXTERNAL_SIDE_EFFECT_CONFIRMED      → no auto retry; return / reconcile
 *
 * Missing FulfillAttemptLock table → hard fail (never "run without lock").
 * Never invent `:retry-${Date.now()}` keys after an uncertain Swiss Post call.
 */

import { prisma } from "@/app/lib/prisma";

export type FulfillLockStatus =
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED_BEFORE_EXTERNAL_SIDE_EFFECT"
  | "EXTERNAL_SIDE_EFFECT_UNKNOWN"
  | "EXTERNAL_SIDE_EFFECT_CONFIRMED"
  /** @deprecated Legacy rows from earlier builds — treat as UNKNOWN. */
  | "FAILED";

export type BeginFulfillAttemptOutcome =
  | { status: "STARTED"; id: string }
  | { status: "ALREADY_PROCESSING"; id: string; startedAt: Date }
  | { status: "ALREADY_COMPLETED"; id: string; result: unknown }
  | {
      status: "RECONCILIATION_REQUIRED";
      id: string;
      lockStatus: FulfillLockStatus;
      error: string | null;
      result: unknown;
    };

export class FulfillLockTableMissingError extends Error {
  constructor() {
    super(
      "FulfillAttemptLock table missing — apply migration 20260917160000_fulfill_attempt_lock before fulfilling."
    );
    this.name = "FulfillLockTableMissingError";
  }
}

function prismaAny() {
  return prisma as unknown as any;
}

function requireTable() {
  const table = prismaAny().fulfillAttemptLock;
  if (!table) throw new FulfillLockTableMissingError();
  return table;
}

function isUniqueViolation(error: any): boolean {
  const code = String(error?.code ?? "");
  if (code === "P2002") return true;
  const msg = String(error?.message ?? "").toLowerCase();
  return msg.includes("unique") && msg.includes("constraint");
}

function isSideEffectBlocking(status: string): boolean {
  return (
    status === "EXTERNAL_SIDE_EFFECT_UNKNOWN" ||
    status === "EXTERNAL_SIDE_EFFECT_CONFIRMED" ||
    status === "FAILED" // legacy — unknown whether Swiss Post ran
  );
}

/**
 * Acquire lock. Same-key retry only when prior status is
 * FAILED_BEFORE_EXTERNAL_SIDE_EFFECT (atomic flip back to IN_PROGRESS).
 */
export async function beginFulfillAttempt(params: {
  idempotencyKey: string;
  awb: string;
  shopifyOrderId: string;
  selectionHash: string;
}): Promise<BeginFulfillAttemptOutcome> {
  const key = String(params.idempotencyKey ?? "").trim();
  if (!key) throw new Error("beginFulfillAttempt: idempotencyKey required");
  const table = requireTable();

  try {
    const row = await table.create({
      data: {
        idempotencyKey: key,
        status: "IN_PROGRESS" as FulfillLockStatus,
        awb: String(params.awb ?? "").trim(),
        shopifyOrderId: String(params.shopifyOrderId ?? "").trim(),
        selectionHash: String(params.selectionHash ?? "").trim(),
      },
      select: { id: true },
    });
    return { status: "STARTED", id: row.id };
  } catch (error: any) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await table.findUnique({
      where: { idempotencyKey: key },
      select: {
        id: true,
        status: true,
        resultJson: true,
        error: true,
        updatedAt: true,
      },
    });
    if (!existing) throw error;

    if (existing.status === "COMPLETED") {
      return {
        status: "ALREADY_COMPLETED",
        id: existing.id,
        result: existing.resultJson ?? null,
      };
    }

    if (existing.status === "IN_PROGRESS") {
      return {
        status: "ALREADY_PROCESSING",
        id: existing.id,
        startedAt: existing.updatedAt,
      };
    }

    if (existing.status === "FAILED_BEFORE_EXTERNAL_SIDE_EFFECT") {
      // Atomic same-key retry: only reclaim if still in that failed-before state.
      const updated = await table.updateMany({
        where: {
          idempotencyKey: key,
          status: "FAILED_BEFORE_EXTERNAL_SIDE_EFFECT",
        },
        data: {
          status: "IN_PROGRESS",
          error: null,
          resultJson: null,
        },
      });
      if (Number(updated?.count ?? 0) === 1) {
        return { status: "STARTED", id: existing.id };
      }
      return {
        status: "ALREADY_PROCESSING",
        id: existing.id,
        startedAt: existing.updatedAt,
      };
    }

    if (isSideEffectBlocking(existing.status)) {
      return {
        status: "RECONCILIATION_REQUIRED",
        id: existing.id,
        lockStatus: existing.status as FulfillLockStatus,
        error: existing.error ?? null,
        result: existing.resultJson ?? null,
      };
    }

    return {
      status: "RECONCILIATION_REQUIRED",
      id: existing.id,
      lockStatus: existing.status as FulfillLockStatus,
      error: existing.error ?? "Unknown lock status",
      result: existing.resultJson ?? null,
    };
  }
}

export async function completeFulfillAttempt(params: {
  idempotencyKey: string;
  result: unknown;
}): Promise<void> {
  const key = String(params.idempotencyKey ?? "").trim();
  if (!key) return;
  const table = requireTable();
  await table.update({
    where: { idempotencyKey: key },
    data: {
      status: "COMPLETED" as FulfillLockStatus,
      resultJson: params.result as any,
      error: null,
    },
  });
}

/** Failure before any Swiss Post / external label request was sent. */
export async function failFulfillAttemptBeforeExternal(params: {
  idempotencyKey: string;
  error: string;
}): Promise<void> {
  const key = String(params.idempotencyKey ?? "").trim();
  if (!key) return;
  const table = requireTable();
  await table
    .update({
      where: { idempotencyKey: key },
      data: {
        status: "FAILED_BEFORE_EXTERNAL_SIDE_EFFECT" as FulfillLockStatus,
        error: String(params.error ?? "").slice(0, 4000),
      },
    })
    .catch(() => null);
}

/**
 * Mark that an external request is about to be / was sent (Swiss Post).
 * After this, automatic retry is forbidden.
 */
export async function markExternalSideEffectUnknown(params: {
  idempotencyKey: string;
  error?: string | null;
  partialResult?: unknown;
}): Promise<void> {
  const key = String(params.idempotencyKey ?? "").trim();
  if (!key) return;
  const table = requireTable();
  await table
    .update({
      where: { idempotencyKey: key },
      data: {
        status: "EXTERNAL_SIDE_EFFECT_UNKNOWN" as FulfillLockStatus,
        error: params.error ? String(params.error).slice(0, 4000) : undefined,
        resultJson:
          params.partialResult !== undefined
            ? (params.partialResult as any)
            : undefined,
      },
    })
    .catch(() => null);
}

/** Swiss Post (or other external) label creation confirmed. */
export async function markExternalSideEffectConfirmed(params: {
  idempotencyKey: string;
  partialResult: unknown;
}): Promise<void> {
  const key = String(params.idempotencyKey ?? "").trim();
  if (!key) return;
  const table = requireTable();
  await table
    .update({
      where: { idempotencyKey: key },
      data: {
        status: "EXTERNAL_SIDE_EFFECT_CONFIRMED" as FulfillLockStatus,
        resultJson: params.partialResult as any,
        error: null,
      },
    })
    .catch(() => null);
}

/**
 * @deprecated Use failFulfillAttemptBeforeExternal or markExternalSideEffectUnknown.
 * Maps to UNKNOWN (safe — never allow blind retry).
 */
export async function failFulfillAttempt(params: {
  idempotencyKey: string;
  error: string;
}): Promise<void> {
  await markExternalSideEffectUnknown({
    idempotencyKey: params.idempotencyKey,
    error: params.error,
  });
}

/** Read-only reconciliation hints for operators / UI. */
export async function reconcileFulfillAttempt(params: {
  idempotencyKey: string;
  awb: string;
  shopifyOrderId?: string | null;
}): Promise<{
  lock: {
    status: string;
    error: string | null;
    result: unknown;
  } | null;
  shopifyFulfillmentRecord: {
    shopifyOrderId: string;
    trackingNumber: string | null;
    swissPostLabelId: string | null;
    swissPostBarcode: string | null;
  } | null;
}> {
  const table = requireTable();
  const key = String(params.idempotencyKey ?? "").trim();
  const lock = key
    ? await table.findUnique({
        where: { idempotencyKey: key },
        select: { status: true, error: true, resultJson: true },
      })
    : null;

  const awb = String(params.awb ?? "").trim();
  let record: any = null;
  if (awb) {
    record = await prisma.shopifyFulfillmentRecord
      .findFirst({
        where: {
          OR: [
            { trackingNumber: awb },
            { sourceAwb: awb },
            ...(params.shopifyOrderId
              ? [{ shopifyOrderId: String(params.shopifyOrderId) }]
              : []),
          ],
        },
        orderBy: { createdAt: "desc" },
        select: {
          shopifyOrderId: true,
          trackingNumber: true,
          swissPostLabelId: true,
          swissPostBarcode: true,
        },
      })
      .catch(() => null);
  }

  return {
    lock: lock
      ? {
          status: String(lock.status),
          error: lock.error ?? null,
          result: lock.resultJson ?? null,
        }
      : null,
    shopifyFulfillmentRecord: record,
  };
}

/** @deprecated */
export function getFulfillIdempotentResult(_key: string): unknown | null {
  return null;
}

/** @deprecated */
export function setFulfillIdempotentResult(
  _key: string,
  _result: unknown,
  _ttlMs?: number
): void {
  /* no-op */
}
