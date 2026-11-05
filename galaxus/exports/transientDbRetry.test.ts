import { describe, expect, it, vi } from "vitest";
import { isTransientDbError, withTransientDbRetry } from "@/galaxus/exports/transientDbRetry";

function prismaError(code: string, message = "", metaCode?: string) {
  const err = new Error(message) as Error & { code: string; meta?: { code: string } };
  err.code = code;
  if (metaCode) err.meta = { code: metaCode };
  return err;
}

describe("isTransientDbError", () => {
  it("matches transient prisma codes", () => {
    expect(isTransientDbError(prismaError("P1001"))).toBe(true);
    expect(isTransientDbError(prismaError("P1017", "Server has closed the connection."))).toBe(true);
    expect(isTransientDbError(prismaError("P2024"))).toBe(true);
  });

  it("matches raw-query statement timeout (P2010 + 57014)", () => {
    expect(isTransientDbError(prismaError("P2010", "Raw query failed", "57014"))).toBe(true);
    expect(isTransientDbError(prismaError("P2010", "Raw query failed", "23505"))).toBe(false);
  });

  it("matches connection messages without codes", () => {
    expect(isTransientDbError(new Error("read ECONNRESET"))).toBe(true);
    expect(isTransientDbError(new Error("socket hang up"))).toBe(true);
  });

  it("rejects non-transient errors", () => {
    expect(isTransientDbError(prismaError("P2002", "Unique constraint failed"))).toBe(false);
    expect(isTransientDbError(new Error("Refusing to publish empty snapshot"))).toBe(false);
    expect(isTransientDbError(null)).toBe(false);
  });
});

describe("withTransientDbRetry", () => {
  it("retries transient failures then succeeds", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const promise = withTransientDbRetry("test", async () => {
        calls += 1;
        if (calls < 3) throw prismaError("P1017", "Server has closed the connection.");
        return "ok";
      });
      await vi.runAllTimersAsync();
      await expect(promise).resolves.toBe("ok");
      expect(calls).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rethrows non-transient errors immediately", async () => {
    let calls = 0;
    await expect(
      withTransientDbRetry("test", async () => {
        calls += 1;
        throw prismaError("P2002", "Unique constraint failed");
      })
    ).rejects.toThrow("Unique constraint failed");
    expect(calls).toBe(1);
  });

  it("gives up after max attempts", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const promise = withTransientDbRetry(
        "test",
        async () => {
          calls += 1;
          throw prismaError("P1001", "Can't reach database server");
        },
        { attempts: 2 }
      );
      promise.catch(() => {});
      await vi.runAllTimersAsync();
      await expect(promise).rejects.toThrow("Can't reach database server");
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
