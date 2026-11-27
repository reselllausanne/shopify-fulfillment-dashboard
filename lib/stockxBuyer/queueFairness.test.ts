import { describe, expect, it } from "vitest";
import { nextFailStreak, shopifyResultStreakOutcome, shouldYieldQueue } from "@/lib/stockxBuyer/queueFairness";

describe("queue fairness", () => {
  it("yields to the other queue after 3 hard failures in a row", () => {
    let streak = 0;
    streak = nextFailStreak(streak, "fail");
    streak = nextFailStreak(streak, "fail");
    expect(shouldYieldQueue(streak)).toBe(false);
    streak = nextFailStreak(streak, "fail");
    expect(shouldYieldQueue(streak)).toBe(true);
  });

  it("a successful buy resets the streak", () => {
    expect(nextFailStreak(2, "success")).toBe(0);
    expect(nextFailStreak(2, "ignore")).toBe(2);
  });

  it("counts bot_fail and currency_eur, not a skipped line", () => {
    expect(shopifyResultStreakOutcome({ kind: "needs_human", reason: "bot_fail" })).toBe("fail");
    expect(shopifyResultStreakOutcome({ kind: "needs_human", reason: "currency_eur" })).toBe("fail");
    expect(shopifyResultStreakOutcome({ kind: "easy_buy", stockxOrderNumber: "03-A" })).toBe("success");
    expect(shopifyResultStreakOutcome({ kind: "skipped", reason: "already_matched" })).toBe("ignore");
  });
});
