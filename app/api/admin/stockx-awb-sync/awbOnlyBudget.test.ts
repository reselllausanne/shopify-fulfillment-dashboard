import { describe, expect, it } from "vitest";
import { AWB_BUDGET_EXHAUSTED } from "@/lib/stockxAwbBackfill";

describe("AWB cron hang fix invariants", () => {
  it("budget_exhausted is distinct from auth abort", () => {
    expect(AWB_BUDGET_EXHAUSTED).toBe("budget_exhausted");
    const isAuthAbort = (reason: string | null | undefined) =>
      Boolean(reason && reason !== AWB_BUDGET_EXHAUSTED);
    expect(isAuthAbort(AWB_BUDGET_EXHAUSTED)).toBe(false);
    expect(isAuthAbort("StockX rejected the token three times in a row. Refresh the StockX session, then retry.")).toBe(
      true
    );
    expect(isAuthAbort(null)).toBe(false);
  });

  it("awbOnly cron body skips remint+autolink redo", () => {
    const body = { days: 30, limit: 60, forceRefresh: false, awbOnly: true };
    expect(body.awbOnly).toBe(true);
    expect((body as { refreshOnly?: boolean }).refreshOnly).toBeUndefined();
    expect((body as { autoLinkOnly?: boolean }).autoLinkOnly).toBeUndefined();
  });
});
