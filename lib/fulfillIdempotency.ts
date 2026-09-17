/**
 * Persistent, cross-process fulfill idempotency.
 *
 * Uses `FulfillAttemptLock` (Prisma) with a UNIQUE constraint on
 * `idempotencyKey` as an atomic in-progress lock:
 *
 *   1. `beginFulfillAttempt(...)` inserts a row with status `IN_PROGRESS`.
 *      - success → caller owns the attempt.
 *      - unique-key conflict → look up the existing row:
 *          * `COMPLETED` → return cached result (`ALREADY_COMPLETED`).
 *          * `FAILED`    → return recorded error (`PREVIOUSLY_FAILED`).
 *          * `IN_PROGRESS` → another worker owns it (`ALREADY_PROCESSING`).
 *   2. `completeFulfillAttempt(...)` flips status to `COMPLETED` and stores
 *      the result payload for later replays.
 *   3. `failFulfillAttempt(...)` flips status to `FAILED` with an error and
 *      lets the operator retry (a follow-up begin recycles the same key).
 *
 * This replaces the previous in-memory Map, which was per-process and lost
 * on restart — allowing the same scan to double-fulfill.
 */

import { prisma } from "@/app/lib/prisma";

export type FulfillLockStatus =
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED";

export type BeginFulfillAttemptOutcome =
  | { status: "STARTED"; id: string }
  | { status: "ALREADY_PROCESSING"; id: string; startedAt: Date }
  | { status: "ALREADY_COMPLETED"; id: string; result: unknown }
  | { status: "PREVIOUSLY_FAILED"; id: string; error: string | null };

function prismaAny() {
  return prisma as unknown as any;
}

function isUniqueViolation(error: any): boolean {
  const code = String(error?.code ?? "");
  if (code === "P2002") return true;
  const msg = String(error?.message ?? "").toLowerCase();
  return msg.includes("unique") && msg.includes("constraint");
}

/**
 * Try to acquire the idempotency lock. Returns what the caller should do:
 * proceed, return cached result, return prior error, or 409.
 */
export async function beginFulfillAttempt(params: {
  idempotencyKey: string;
  awb: string;
  shopifyOrderId: string;
  selectionHash: string;
}): Promise<BeginFulfillAttemptOutcome> {
  const key = String(params.idempotencyKey ?? "").trim();
  if (!key) throw new Error("beginFulfillAttempt: idempotencyKey required");

  const table = prismaAny().fulfillAttemptLock;
  if (!table) {
    // Migration not applied yet — degrade to a permissive start rather than
    // block fulfill. Log so ops notices.
    console.warn(
      "[FULFILL-IDEMPOTENCY] FulfillAttemptLock table missing; running without lock."
    );
    return { status: "STARTED", id: `no-lock:${key}` };
  }

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
    // Race: some other request already inserted this key.
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
    if (existing.status === "FAILED") {
      return {
        status: "PREVIOUSLY_FAILED",
        id: existing.id,
        error: existing.error ?? null,
      };
    }
    return {
      status: "ALREADY_PROCESSING",
      id: existing.id,
      startedAt: existing.updatedAt,
    };
  }
}

export async function completeFulfillAttempt(params: {
  idempotencyKey: string;
  result: unknown;
}): Promise<void> {
  const key = String(params.idempotencyKey ?? "").trim();
  if (!key) return;
  const table = prismaAny().fulfillAttemptLock;
  if (!table) return;
  await table.update({
    where: { idempotencyKey: key },
    data: {
      status: "COMPLETED" as FulfillLockStatus,
      resultJson: params.result as any,
      error: null,
    },
  });
}

export async function failFulfillAttempt(params: {
  idempotencyKey: string;
  error: string;
}): Promise<void> {
  const key = String(params.idempotencyKey ?? "").trim();
  if (!key) return;
  const table = prismaAny().fulfillAttemptLock;
  if (!table) return;
  await table
    .update({
      where: { idempotencyKey: key },
      data: {
        status: "FAILED" as FulfillLockStatus,
        error: String(params.error ?? "").slice(0, 4000),
      },
    })
    .catch(() => null);
}

/**
 * @deprecated Use `beginFulfillAttempt` + `completeFulfillAttempt` instead.
 * Kept as a shim only so old imports compile — always returns `null` because
 * per-process caching is unsafe across restarts / multiple pods.
 */
export function getFulfillIdempotentResult(_key: string): unknown | null {
  return null;
}

/**
 * @deprecated Use `completeFulfillAttempt` instead. This shim is a no-op.
 */
export function setFulfillIdempotentResult(
  _key: string,
  _result: unknown,
  _ttlMs?: number
): void {
  /* no-op */
}
