import { describe, expect, it, vi, beforeEach } from "vitest";

const { fakeTable, store, fulfillmentRecordFindFirst } = vi.hoisted(() => {
  type LockRow = {
    id: string;
    idempotencyKey: string;
    status: string;
    awb: string;
    shopifyOrderId: string;
    selectionHash: string;
    resultJson: unknown | null;
    error: string | null;
    updatedAt: Date;
  };
  const store = new Map<string, LockRow>();
  const fakeTable = {
    create: vi.fn(async ({ data }: { data: any }) => {
      if (store.has(data.idempotencyKey)) {
        const err: any = new Error("Unique constraint failed");
        err.code = "P2002";
        throw err;
      }
      const row: LockRow = {
        id: `row-${store.size + 1}`,
        idempotencyKey: data.idempotencyKey,
        status: data.status,
        awb: data.awb,
        shopifyOrderId: data.shopifyOrderId,
        selectionHash: data.selectionHash,
        resultJson: null,
        error: null,
        updatedAt: new Date(),
      };
      store.set(row.idempotencyKey, row);
      return { id: row.id };
    }),
    findUnique: vi.fn(async ({ where }: { where: { idempotencyKey: string } }) => {
      const row = store.get(where.idempotencyKey);
      return row ? { ...row } : null;
    }),
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { idempotencyKey: string };
        data: Partial<LockRow>;
      }) => {
        const row = store.get(where.idempotencyKey);
        if (!row) throw new Error("row missing");
        const updated: LockRow = {
          ...row,
          ...data,
          updatedAt: new Date(),
        } as LockRow;
        store.set(row.idempotencyKey, updated);
        return { id: updated.id };
      }
    ),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { idempotencyKey: string; status?: string };
        data: Partial<LockRow>;
      }) => {
        const row = store.get(where.idempotencyKey);
        if (!row) return { count: 0 };
        if (where.status && row.status !== where.status) return { count: 0 };
        store.set(row.idempotencyKey, {
          ...row,
          ...data,
          updatedAt: new Date(),
        } as LockRow);
        return { count: 1 };
      }
    ),
  };
  const fulfillmentRecordFindFirst = vi.fn(async () => null);
  return { fakeTable, store, fulfillmentRecordFindFirst };
});

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    fulfillAttemptLock: fakeTable,
    shopifyFulfillmentRecord: { findFirst: fulfillmentRecordFindFirst },
  },
}));

import {
  beginFulfillAttempt,
  completeFulfillAttempt,
  failFulfillAttemptBeforeExternal,
  markExternalSideEffectUnknown,
  markExternalSideEffectConfirmed,
  reconcileFulfillAttempt,
  FulfillLockTableMissingError,
  failFulfillAttempt,
} from "@/lib/fulfillIdempotency";

const baseArgs = {
  idempotencyKey: "scan:AWB1:order-1:line-1",
  awb: "AWB1",
  shopifyOrderId: "order-1",
  selectionHash: "hash-1",
};

describe("fulfillIdempotency (persistent)", () => {
  beforeEach(() => {
    store.clear();
    fakeTable.create.mockClear();
    fakeTable.findUnique.mockClear();
    fakeTable.update.mockClear();
    fakeTable.updateMany.mockClear();
    fulfillmentRecordFindFirst.mockClear();
  });

  it("first attempt STARTED, concurrent second is ALREADY_PROCESSING", async () => {
    const first = await beginFulfillAttempt(baseArgs);
    expect(first.status).toBe("STARTED");
    const second = await beginFulfillAttempt(baseArgs);
    expect(second.status).toBe("ALREADY_PROCESSING");
  });

  it("after complete, replay returns ALREADY_COMPLETED with cached result", async () => {
    await beginFulfillAttempt(baseArgs);
    await completeFulfillAttempt({
      idempotencyKey: baseArgs.idempotencyKey,
      result: { ok: true, awb: "AWB1" },
    });
    const replay = await beginFulfillAttempt(baseArgs);
    expect(replay.status).toBe("ALREADY_COMPLETED");
    if (replay.status === "ALREADY_COMPLETED") {
      expect(replay.result).toEqual({ ok: true, awb: "AWB1" });
    }
  });

  it("FAILED_BEFORE_EXTERNAL allows same-key atomic retry", async () => {
    await beginFulfillAttempt(baseArgs);
    await failFulfillAttemptBeforeExternal({
      idempotencyKey: baseArgs.idempotencyKey,
      error: "validation failed",
    });
    const retry = await beginFulfillAttempt(baseArgs);
    expect(retry.status).toBe("STARTED");
    expect(fakeTable.updateMany).toHaveBeenCalled();
    expect(store.get(baseArgs.idempotencyKey)?.status).toBe("IN_PROGRESS");
  });

  it("EXTERNAL_SIDE_EFFECT_UNKNOWN blocks retry — RECONCILIATION_REQUIRED, no new key", async () => {
    await beginFulfillAttempt(baseArgs);
    await markExternalSideEffectUnknown({
      idempotencyKey: baseArgs.idempotencyKey,
      error: "Swiss Post in flight",
    });
    const replay = await beginFulfillAttempt(baseArgs);
    expect(replay.status).toBe("RECONCILIATION_REQUIRED");
    if (replay.status === "RECONCILIATION_REQUIRED") {
      expect(replay.lockStatus).toBe("EXTERNAL_SIDE_EFFECT_UNKNOWN");
    }
    // Never invent timestamped retry keys — same key only, still blocked.
    expect(store.size).toBe(1);
    expect([...store.keys()][0]).toBe(baseArgs.idempotencyKey);
  });

  it("Swiss Post ok then Shopify fail: CONFIRMED → retry never creates second label attempt", async () => {
    let swissPostCreateCount = 0;
    const createSwissPostLabel = () => {
      swissPostCreateCount += 1;
      return { ok: true, identCode: "99.00.000000" };
    };

    // Attempt 1: start → Swiss Post succeeds → mark CONFIRMED → Shopify fails
    await beginFulfillAttempt(baseArgs);
    const label1 = createSwissPostLabel();
    await markExternalSideEffectConfirmed({
      idempotencyKey: baseArgs.idempotencyKey,
      partialResult: { phase: "swiss_post_ok", ...label1 },
    });
    // Shopify fails — lock stays CONFIRMED / UNKNOWN, not FAILED_BEFORE
    await markExternalSideEffectUnknown({
      idempotencyKey: baseArgs.idempotencyKey,
      error: "Shopify fulfill failed after Swiss Post",
      partialResult: { phase: "shopify_user_errors_after_swiss_post", ...label1 },
    });

    // Attempt 2 (retry): must NOT start a new Swiss Post create
    const replay = await beginFulfillAttempt(baseArgs);
    expect(replay.status).toBe("RECONCILIATION_REQUIRED");
    expect(swissPostCreateCount).toBe(1);
    expect(store.size).toBe(1);
    expect([...store.keys()].some((k) => k.includes("retry-"))).toBe(false);
  });

  it("legacy FAILED status treated as RECONCILIATION_REQUIRED", async () => {
    await beginFulfillAttempt(baseArgs);
    const row = store.get(baseArgs.idempotencyKey)!;
    row.status = "FAILED";
    store.set(baseArgs.idempotencyKey, row);
    const replay = await beginFulfillAttempt(baseArgs);
    expect(replay.status).toBe("RECONCILIATION_REQUIRED");
  });

  it("deprecated failFulfillAttempt maps to UNKNOWN (never blind retry)", async () => {
    await beginFulfillAttempt(baseArgs);
    await failFulfillAttempt({
      idempotencyKey: baseArgs.idempotencyKey,
      error: "ambiguous",
    });
    expect(store.get(baseArgs.idempotencyKey)?.status).toBe(
      "EXTERNAL_SIDE_EFFECT_UNKNOWN"
    );
    const replay = await beginFulfillAttempt(baseArgs);
    expect(replay.status).toBe("RECONCILIATION_REQUIRED");
  });

  it("reconcileFulfillAttempt returns lock + optional ShopifyFulfillmentRecord", async () => {
    await beginFulfillAttempt(baseArgs);
    await markExternalSideEffectConfirmed({
      idempotencyKey: baseArgs.idempotencyKey,
      partialResult: { swissPostLabelId: "99.00.1" },
    });
    fulfillmentRecordFindFirst.mockResolvedValueOnce({
      shopifyOrderId: "order-1",
      trackingNumber: "99.00.1",
      swissPostLabelId: "99.00.1",
      swissPostBarcode: "barcode",
    });
    const recon = await reconcileFulfillAttempt({
      idempotencyKey: baseArgs.idempotencyKey,
      awb: "AWB1",
    });
    expect(recon.lock?.status).toBe("EXTERNAL_SIDE_EFFECT_CONFIRMED");
    expect(recon.shopifyFulfillmentRecord?.swissPostLabelId).toBe("99.00.1");
  });

  it("missing FulfillAttemptLock table throws FulfillLockTableMissingError", async () => {
    const { beginFulfillAttempt: beginFresh } = await import("@/lib/fulfillIdempotency");
    // Temporarily break table by mutating mock — simulate undefined client accessor
    const prismaMod = await import("@/app/lib/prisma");
    const original = (prismaMod.prisma as any).fulfillAttemptLock;
    (prismaMod.prisma as any).fulfillAttemptLock = undefined;
    try {
      await expect(beginFresh(baseArgs)).rejects.toBeInstanceOf(
        FulfillLockTableMissingError
      );
    } finally {
      (prismaMod.prisma as any).fulfillAttemptLock = original;
    }
  });

  it("distinct idempotency keys do not collide", async () => {
    const a = await beginFulfillAttempt(baseArgs);
    const b = await beginFulfillAttempt({
      ...baseArgs,
      idempotencyKey: "scan:AWB1:order-1:line-2",
    });
    expect(a.status).toBe("STARTED");
    expect(b.status).toBe("STARTED");
  });

  it("concurrent reclaim of FAILED_BEFORE: only one wins", async () => {
    await beginFulfillAttempt(baseArgs);
    await failFulfillAttemptBeforeExternal({
      idempotencyKey: baseArgs.idempotencyKey,
      error: "pre",
    });
    // Simulate race: first updateMany succeeds, second sees status already IN_PROGRESS
    let calls = 0;
    fakeTable.updateMany.mockImplementation(async ({ where, data }: any) => {
      calls += 1;
      const row = store.get(where.idempotencyKey);
      if (!row || (where.status && row.status !== where.status)) {
        return { count: 0 };
      }
      store.set(row.idempotencyKey, { ...row, ...data, updatedAt: new Date() });
      return { count: 1 };
    });
    const [r1, r2] = await Promise.all([
      beginFulfillAttempt(baseArgs),
      beginFulfillAttempt(baseArgs),
    ]);
    const statuses = [r1.status, r2.status].sort();
    // One STARTED, one ALREADY_PROCESSING (second reclaim sees IN_PROGRESS)
    expect(statuses).toEqual(["ALREADY_PROCESSING", "STARTED"]);
    expect(calls).toBeGreaterThanOrEqual(1);
  });
});
