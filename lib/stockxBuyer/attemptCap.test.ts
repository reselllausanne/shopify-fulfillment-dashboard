import { describe, expect, it } from "vitest";
import {
  addFail,
  capHit,
  failureClass,
  isMaxAttemptsReason,
  limitFor,
  maxAttemptsBlocks,
  maxAttemptsReason,
} from "@/lib/stockxBuyer/attemptCap";

describe("failureClass", () => {
  it("payment not completed (non-card text) is its own class", () => {
    expect(failureClass("bot_fail", "Payment not completed (no charge): something odd")).toBe("payment_not_completed");
  });
  it("network and hydrate details are infra classes", () => {
    expect(failureClass("bot_fail", "page.goto: net::ERR_TUNNEL_CONNECTION_FAILED at https://stockx.com/...")).toBe("network");
    expect(failureClass("proxy_blank", "checkout hydrate timeout — shell/no CHF lanes after reloads (bodyChars=262)")).toBe("proxy_blank");
    expect(failureClass("retry_exhausted:bot_fail", "Buy Now not found")).toBe("bot_fail");
  });
  it("size / lane classes keep their reason", () => {
    expect(failureClass("size_grid", "size grid shown")).toBe("size_grid");
    expect(failureClass("no_lane_under_cap", "sell=60 lanes=[]")).toBe("no_lane_under_cap");
  });
  it("never counts paid_no_number, payment_declined, proxy_402", () => {
    expect(failureClass("paid_no_number", "")).toBeNull();
    expect(failureClass("payment_declined", "x")).toBeNull();
    expect(failureClass("proxy_402", "x")).toBeNull();
    expect(failureClass("", "x")).toBeNull();
  });
  it("a rejected promo code does not count, and is not a card decline", () => {
    const detail = "Payment not completed (no charge): This discount code is invalid";
    expect(failureClass("bot_fail", detail)).toBeNull();
    expect(failureClass("bot_fail", "Ce code promo est invalide ou a expiré.")).toBeNull();
  });
});

describe("caps", () => {
  const env = {} as NodeJS.ProcessEnv;
  it("20 for line errors, 60 for infra errors", () => {
    expect(limitFor("size_grid", env)).toBe(20);
    expect(limitFor("proxy_blank", env)).toBe(60);
    expect(limitFor("network", env)).toBe(60);
  });
  it("capHit fires at the limit per class, not across classes", () => {
    let c: Record<string, number> | undefined;
    for (let i = 0; i < 19; i += 1) c = addFail(c, "payment_not_completed");
    expect(capHit(c, env)).toBeNull();
    c = addFail(c, "payment_not_completed");
    expect(capHit(c, env)).toEqual({ cls: "payment_not_completed", count: 20 });
    expect(capHit({ size_grid: 10, bot_fail: 10 }, env)).toBeNull();
  });
  it("env raises the limit and frees a capped line", () => {
    const s = { reason: maxAttemptsReason("size_grid"), failCounts: { size_grid: 20 } };
    expect(maxAttemptsBlocks(s, env)).toBe(true);
    expect(maxAttemptsBlocks(s, { STOCKX_BUYER_MAX_LINE_FAILS: "30" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(maxAttemptsBlocks({ reason: "bot_fail" }, env)).toBe(false);
    expect(isMaxAttemptsReason("max_attempts:x")).toBe(true);
  });
});
