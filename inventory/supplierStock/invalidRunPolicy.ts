import type { SupplierStockPolicyStatus } from "./types";
import { TEMPORARY_MONITORING_EXCEPTION } from "./types";

export type InvalidRunDecision = {
  shouldPause: boolean;
  /** Zero marketplace stock for this supplier (approved path). */
  zeroMarketplaceStock: boolean;
  consecutiveInvalidRuns: number;
  newStatus?: SupplierStockPolicyStatus;
  pauseReason?: string;
  notify: boolean;
  /** First invalid: keep last proven stock for a short grace window. */
  keepLastProofGrace: boolean;
  exceptionTag?: string | null;
};

/**
 * Invalid-run policy:
 * - 1st invalid (approved): keep last proof grace, alert optional, no pause
 * - 2nd consecutive (approved): email + marketplace stock → 0 + pause
 * - WEL/REI monitoring_only: TEMPORARY_MONITORING_EXCEPTION — alert on 2nd, never auto-change qty
 */
export function shouldPauseAfterInvalidRun(input: {
  policyStatus: SupplierStockPolicyStatus;
  consecutiveInvalidRuns: number;
  invalidReason?: string | null;
}): InvalidRunDecision {
  const nextCount = Math.max(0, input.consecutiveInvalidRuns) + 1;

  if (input.policyStatus === "monitoring_only") {
    return {
      shouldPause: false,
      zeroMarketplaceStock: false,
      consecutiveInvalidRuns: nextCount,
      notify: nextCount >= 2,
      keepLastProofGrace: true,
      exceptionTag: TEMPORARY_MONITORING_EXCEPTION,
    };
  }

  if (input.policyStatus === "manually_paused") {
    return {
      shouldPause: false,
      zeroMarketplaceStock: false,
      consecutiveInvalidRuns: nextCount,
      notify: false,
      keepLastProofGrace: false,
      exceptionTag: null,
    };
  }

  if (input.policyStatus === "review_required") {
    // Already marketplace-zero via gate; still track + notify on 2nd.
    if (nextCount >= 2) {
      return {
        shouldPause: true,
        zeroMarketplaceStock: true,
        consecutiveInvalidRuns: nextCount,
        newStatus: "paused_due_to_scrape_failure",
        pauseReason: input.invalidReason ?? "consecutive_invalid_scrape_runs",
        notify: true,
        keepLastProofGrace: false,
        exceptionTag: null,
      };
    }
    return {
      shouldPause: false,
      zeroMarketplaceStock: false,
      consecutiveInvalidRuns: nextCount,
      notify: false,
      keepLastProofGrace: false,
      exceptionTag: null,
    };
  }

  // approved (and paused_due_to_scrape_failure re-entry)
  if (nextCount >= 2) {
    return {
      shouldPause: true,
      zeroMarketplaceStock: true,
      consecutiveInvalidRuns: nextCount,
      newStatus: "paused_due_to_scrape_failure",
      pauseReason: input.invalidReason ?? "consecutive_invalid_scrape_runs",
      notify: true,
      keepLastProofGrace: false,
      exceptionTag: null,
    };
  }

  return {
    shouldPause: false,
    zeroMarketplaceStock: false,
    consecutiveInvalidRuns: nextCount,
    notify: false,
    keepLastProofGrace: true,
    exceptionTag: null,
  };
}
