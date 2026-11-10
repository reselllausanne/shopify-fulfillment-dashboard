import { beforeEach, describe, expect, it, vi } from "vitest";

const executeRaw = vi.fn();
vi.mock("@/app/lib/prisma", () => ({
  prisma: { $executeRaw: (...args: unknown[]) => executeRaw(...args) },
}));

import { __resetDbRetentionThrottle, runDbRetention } from "@/galaxus/ops/dbRetention";

describe("runDbRetention", () => {
  beforeEach(() => {
    executeRaw.mockReset();
    __resetDbRetentionThrottle();
  });

  it("reports cleared manifest payloads and deleted drift rows", async () => {
    // manifest: one short batch; drift: one short batch
    executeRaw.mockResolvedValueOnce(120).mockResolvedValueOnce(4500);
    const res = await runDbRetention({ nowMs: Date.UTC(2026, 10, 10) });
    expect(res).toEqual({ skipped: false, manifestCleared: 120, driftDeleted: 4500 });
    expect(executeRaw).toHaveBeenCalledTimes(2);
  });

  it("is throttled unless forced", async () => {
    executeRaw.mockResolvedValue(0);
    const t0 = Date.UTC(2026, 10, 10);
    await runDbRetention({ nowMs: t0 });
    expect((await runDbRetention({ nowMs: t0 + 1000 })).skipped).toBe(true);
    expect((await runDbRetention({ nowMs: t0 + 1000, force: true })).skipped).toBe(false);
  });

  it("a failing prune does not block the other", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    executeRaw.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(7);
    const res = await runDbRetention({ nowMs: Date.UTC(2026, 10, 10) });
    expect(res).toEqual({ skipped: false, manifestCleared: 0, driftDeleted: 7 });
    err.mockRestore();
  });

  it("bounds work per call", async () => {
    executeRaw.mockResolvedValue(10_000);
    await runDbRetention({ nowMs: Date.UTC(2026, 10, 10) });
    expect(executeRaw).toHaveBeenCalledTimes(20);
  });
});
