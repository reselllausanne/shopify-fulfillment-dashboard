import { beforeEach, describe, expect, it, vi } from "vitest";

const executeRaw = vi.fn();
vi.mock("@/app/lib/prisma", () => ({
  prisma: { $executeRaw: (...args: unknown[]) => executeRaw(...args) },
}));

import {
  PROMOTE_PENDING_SWEEP_MIN_INTERVAL_MS,
  __resetPromotePendingSweepThrottle,
  promotePendingStxMappingsThatAlreadyHaveGtin,
} from "@/galaxus/jobs/stxSync";

const T0 = Date.UTC(2026, 10, 11, 10, 0, 0);

beforeEach(() => {
  executeRaw.mockReset();
  __resetPromotePendingSweepThrottle();
});

describe("promotePendingStxMappingsThatAlreadyHaveGtin throttle", () => {
  it("runs the first sweep, then skips while nothing was found within the interval", async () => {
    executeRaw.mockResolvedValue(0);
    expect(await promotePendingStxMappingsThatAlreadyHaveGtin(new Date(T0))).toBe(0);
    expect(executeRaw).toHaveBeenCalledTimes(1);

    await promotePendingStxMappingsThatAlreadyHaveGtin(new Date(T0 + 10 * 60_000));
    await promotePendingStxMappingsThatAlreadyHaveGtin(new Date(T0 + 60 * 60_000));
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it("sweeps again once the interval elapsed", async () => {
    executeRaw.mockResolvedValue(0);
    await promotePendingStxMappingsThatAlreadyHaveGtin(new Date(T0));
    await promotePendingStxMappingsThatAlreadyHaveGtin(
      new Date(T0 + PROMOTE_PENDING_SWEEP_MIN_INTERVAL_MS + 1)
    );
    expect(executeRaw).toHaveBeenCalledTimes(2);
  });

  it("keeps sweeping every call while the previous sweep still found work (backlog drain)", async () => {
    executeRaw.mockResolvedValueOnce(42).mockResolvedValue(0);
    expect(await promotePendingStxMappingsThatAlreadyHaveGtin(new Date(T0))).toBe(42);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    // found work → next refresh sweeps again even 1 minute later (batch < 500 stops that sweep)
    await promotePendingStxMappingsThatAlreadyHaveGtin(new Date(T0 + 60_000));
    expect(executeRaw).toHaveBeenCalledTimes(2);
    // now empty → throttled
    await promotePendingStxMappingsThatAlreadyHaveGtin(new Date(T0 + 120_000));
    expect(executeRaw).toHaveBeenCalledTimes(2);
  });

  it("force bypasses the throttle", async () => {
    executeRaw.mockResolvedValue(0);
    await promotePendingStxMappingsThatAlreadyHaveGtin(new Date(T0));
    await promotePendingStxMappingsThatAlreadyHaveGtin(new Date(T0 + 1000), { force: true });
    expect(executeRaw).toHaveBeenCalledTimes(2);
  });
});
