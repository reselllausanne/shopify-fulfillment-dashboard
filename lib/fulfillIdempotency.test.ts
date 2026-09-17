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
  };
  return { fakeTable, store };
});

vi.mock("@/app/lib/prisma", () => ({
  prisma: { fulfillAttemptLock: fakeTable },
}));

import {
  beginFulfillAttempt,
  completeFulfillAttempt,
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

  it("after fail, replay returns PREVIOUSLY_FAILED with recorded error", async () => {
    await beginFulfillAttempt(baseArgs);
    await failFulfillAttempt({
      idempotencyKey: baseArgs.idempotencyKey,
      error: "Swiss Post 502",
    });
    const replay = await beginFulfillAttempt(baseArgs);
    expect(replay.status).toBe("PREVIOUSLY_FAILED");
    if (replay.status === "PREVIOUSLY_FAILED") {
      expect(replay.error).toBe("Swiss Post 502");
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
});
