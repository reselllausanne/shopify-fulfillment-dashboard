import type { SupplierStockPolicyStatus } from "./types";

export type InvalidRunDecision = {
  shouldPause: boolean;
  consecutiveInvalidRuns: number;
  newStatus?: SupplierStockPolicyStatus;
  pauseReason?: string;
  notify: boolean;
};

/** 2nd consecutive invalid run → pause + email. monitoring_only never pauses. */
export function shouldPauseAfterInvalidRun(input: {
  policyStatus: SupplierStockPolicyStatus;
  consecutiveInvalidRuns: number;
  invalidReason?: string | null;
}): InvalidRunDecision {
  const nextCount = Math.max(0, input.consecutiveInvalidRuns) + 1;

  if (input.policyStatus === "monitoring_only") {
    return {
      shouldPause: false,
      consecutiveInvalidRuns: nextCount,
      notify: nextCount >= 2,
    };
  }

  if (input.policyStatus === "manually_paused") {
    return {
      shouldPause: false,
      consecutiveInvalidRuns: nextCount,
      notify: false,
    };
  }

  if (nextCount >= 2) {
    return {
      shouldPause: true,
      consecutiveInvalidRuns: nextCount,
      newStatus: "paused_due_to_scrape_failure",
      pauseReason: input.invalidReason ?? "consecutive_invalid_scrape_runs",
      notify: true,
    };
  }

  return {
    shouldPause: false,
    consecutiveInvalidRuns: nextCount,
    notify: false,
  };
}
