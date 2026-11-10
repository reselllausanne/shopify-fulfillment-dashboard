import { beforeEach, describe, expect, it, vi } from "vitest";

const executeRaw = vi.fn();
vi.mock("@/app/lib/prisma", () => ({
  prisma: { $executeRaw: (...args: unknown[]) => executeRaw(...args) },
}));

import {
  __resetJobRunRetentionThrottle,
  pruneGalaxusJobRunPayloads,
} from "@/galaxus/ops/jobRunRetention";

describe("pruneGalaxusJobRunPayloads", () => {
  beforeEach(() => {
    executeRaw.mockReset();
    __resetJobRunRetentionThrottle();
  });

  it("stops after a short batch and reports cleared rows", async () => {
    executeRaw.mockResolvedValueOnce(2000).mockResolvedValueOnce(150);
    const res = await pruneGalaxusJobRunPayloads({ nowMs: Date.UTC(2026, 10, 10) });
    expect(res).toEqual({ skipped: false, cleared: 2150 });
    expect(executeRaw).toHaveBeenCalledTimes(2);
  });

  it("is throttled between calls unless forced", async () => {
    executeRaw.mockResolvedValue(0);
    const t0 = Date.UTC(2026, 10, 10);
    await pruneGalaxusJobRunPayloads({ nowMs: t0 });
    const second = await pruneGalaxusJobRunPayloads({ nowMs: t0 + 60_000 });
    expect(second.skipped).toBe(true);
    const forced = await pruneGalaxusJobRunPayloads({ nowMs: t0 + 60_000, force: true });
    expect(forced.skipped).toBe(false);
  });

  it("bounds work per call", async () => {
    executeRaw.mockResolvedValue(2000);
    const res = await pruneGalaxusJobRunPayloads({ nowMs: Date.UTC(2026, 10, 10) });
    expect(executeRaw).toHaveBeenCalledTimes(10);
    expect(res.cleared).toBe(20000);
  });
});
