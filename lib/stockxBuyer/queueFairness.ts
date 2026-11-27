/** After this many consecutive hard failures, the other queue gets the rest of the run. */
export const QUEUE_YIELD_AFTER = 3;

export function nextFailStreak(streak: number, outcome: "fail" | "success" | "ignore"): number {
  if (outcome === "fail") return streak + 1;
  if (outcome === "success") return 0;
  return streak;
}

export function shouldYieldQueue(streak: number, limit = QUEUE_YIELD_AFTER): boolean {
  return streak >= limit;
}

/** Shopify checkout result → streak bucket. Skips and holds do not count. */
export function shopifyResultStreakOutcome(result: {
  kind?: string;
  reason?: string | null;
  stockxOrderNumber?: string | null;
}): "fail" | "success" | "ignore" {
  if (result.kind === "easy_buy" && result.stockxOrderNumber) return "success";
  if (result.kind === "needs_human" && (result.reason === "bot_fail" || result.reason === "currency_eur")) return "fail";
  if (result.kind === "aborted") return "fail";
  return "ignore";
}
