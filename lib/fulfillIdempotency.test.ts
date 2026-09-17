import { describe, expect, it, vi, beforeEach } from "vitest";

const { fakeTable, store } = vi.hoisted(() => {
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
        store.set(where.idempotencyKey, {
          ...row,
          ...data,
          updatedAt: new Date(),
        } as LockRow);
        return { count: 1 };
      }
    ),
  };
  return { fakeTable, store };
});

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    fulfillAttemptLock: fakeTable,
    shopifyFulfillmentRecord: {
      findFirst: vi.fn(async () => null),
    },
  },
}));

import {
  beginFulfillAttempt,
  completeFulfillAttempt,
  failFulfillAttemptBeforeExternal,
  markExternalSideEffectUnknown,
  markExternalSideEffectConfirmed,
  FulfillLockTableMissingError,
} from "@/lib/fulfillIdempotency";

const baseArgs = {
  idempotencyKey: "scan:AWB1:order-1:line-1",
  awb: "AWB1",
  shopifyOrderId: "order-1",
  selectionHash: "hash-1",
};

describe("fulfillIdempotency (side-effect aware)", () => {
  beforeEach(() => {
    store.clear();
    fakeTable.create.mockClear();
    fakeTable.findUnique.mockClear();
    fakeTable.update.mockClear();
    fakeTable.updateMany.mockClear();
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

  it("FAILED_BEFORE_EXTERNAL_SIDE_EFFECT allows same-key atomic retry (no timestamp key)", async () => {
    await beginFulfillAttempt(baseArgs);
    await failFulfillAttemptBeforeExternal({
      idempotencyKey: baseArgs.idempotencyKey,
      error: "validation failed",
    });
    const replay = await beginFulfillAttempt(baseArgs);
    expect(replay.status).toBe("STARTED");
    expect(store.size).toBe(1);
    expect([...store.keys()][0]).toBe(baseArgs.idempotencyKey);
    expect([...store.keys()][0]).not.toMatch(/retry-/);
  });

  it("EXTERNAL_SIDE_EFFECT_UNKNOWN blocks retry with RECONCILIATION_REQUIRED", async () => {
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
    expect(store.size).toBe(1);
  });

  it("Swiss Post confirmed then Shopify failure then retry: zero second label key", async () => {
    let swissPostCreations = 0;
    const createLabel = async () => {
      swissPostCreations += 1;
      return { identCode: "SP-LABEL-1" };
    };

    // Attempt 1: start → Swiss Post OK → confirm → Shopify fails (leave CONFIRMED)
    await beginFulfillAttempt(baseArgs);
    await markExternalSideEffectUnknown({
      idempotencyKey: baseArgs.idempotencyKey,
      error: "in flight",
    });
    const label = await createLabel();
    await markExternalSideEffectConfirmed({
      idempotencyKey: baseArgs.idempotencyKey,
      partialResult: { swissPostLabelId: label.identCode, shopifyFailed: true },
    });

    // Attempt 2 (operator retry): must NOT start and must NOT create another label
    const replay = await beginFulfillAttempt(baseArgs);
    expect(replay.status).toBe("RECONCILIATION_REQUIRED");
    if (replay.status === "RECONCILIATION_REQUIRED") {
      expect(replay.lockStatus).toBe("EXTERNAL_SIDE_EFFECT_CONFIRMED");
    }
    // No second creation
    expect(swissPostCreations).toBe(1);
    expect(store.size).toBe(1);
    expect([...store.keys()].some((k) => k.includes("retry-"))).toBe(false);
  });

  it("concurrent begin: only one STARTED", async () => {
    const results = await Promise.all([
      beginFulfillAttempt(baseArgs),
      beginFulfillAttempt(baseArgs),
      beginFulfillAttempt(baseArgs),
    ]);
    const started = results.filter((r) => r.status === "STARTED");
    const processing = results.filter((r) => r.status === "ALREADY_PROCESSING");
    expect(started.length).toBe(1);
    expect(processing.length).toBe(2);
  });

  it("missing lock table throws FulfillLockTableMissingError (never run without lock)", async () => {
    const { prisma } = await import("@/app/lib/prisma");
    const original = (prisma as any).fulfillAttemptLock;
    (prisma as any).fulfillAttemptLock = undefined;
    await expect(beginFulfillAttempt(baseArgs)).rejects.toBeInstanceOf(
      FulfillLockTableMissingError
    );
    (prisma as any).fulfillAttemptLock = original;
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
});
