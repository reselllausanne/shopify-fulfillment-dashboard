import { describe, expect, it } from "vitest";
import { isCardDeclined } from "@/lib/stockxPaymentDiag";
import {
  addPurchaseSpend,
  parseSpendCapChf,
  resumeSessionSpend,
  sessionSpendReached,
  spendCapHaltReason,
} from "@/lib/stockxBuyer/spendCap";

describe("session spend cap", () => {
  it("parses a positive cap and ignores empty", () => {
    expect(parseSpendCapChf("6000")).toBe(6000);
    expect(parseSpendCapChf("")).toBe(null);
    expect(parseSpendCapChf("0")).toBe(null);
    expect(parseSpendCapChf("nope")).toBe(null);
  });

  it("adds all-in totals and ignores a missing price", () => {
    expect(addPurchaseSpend(0, 142.89)).toBe(142.89);
    expect(addPurchaseSpend(142.89, 10.1)).toBe(152.99);
    expect(addPurchaseSpend(10, null)).toBe(10);
  });

  it("halts exactly when the run reaches 6000, with reason cap 6k", () => {
    expect(sessionSpendReached(5999.99, 6000)).toBe(false);
    expect(sessionSpendReached(6000, 6000)).toBe(true);
    expect(sessionSpendReached(6000.01, 6000)).toBe(true);
    expect(sessionSpendReached(99999, null)).toBe(false);
    expect(spendCapHaltReason(6000)).toBe("cap 6k");
  });

  it("cap 6k is not a card decline", () => {
    expect(isCardDeclined(spendCapHaltReason(6000))).toBe(false);
    expect(spendCapHaltReason(6000)).not.toMatch(/declin|refus|payment method/i);
  });

  it("resumes spend only for the same relaunch session and cap", () => {
    const saved = { session: "2026-11-27T14:00:00.000Z", spentChf: 400, capChf: 6000 };
    expect(resumeSessionSpend(saved, saved.session, 6000)).toBe(400);
    expect(resumeSessionSpend(saved, "other-session", 6000)).toBe(0);
    expect(resumeSessionSpend(saved, saved.session, 1000)).toBe(0);
    expect(resumeSessionSpend(null, saved.session, 6000)).toBe(0);
  });
});
