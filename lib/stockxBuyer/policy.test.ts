import { describe, expect, it } from "vitest";
import {
  MAX_TRIES,
  applyOutcome,
  backoffMs,
  classifyResult,
  jobKey,
  laneFromOrderNumber,
  orderQueue,
  shouldRebuyCancelled,
  stateBlocks,
  type JobState,
} from "@/lib/stockxBuyer/policy";

const base = { key: "shopify:1", source: "shopify" as const, orderRef: "#7661", title: "Travis jacket" };

describe("classifyResult", () => {
  it("easy_buy with number → bought, lane from prefix", () => {
    const o = classifyResult({ kind: "easy_buy", stockxOrderNumber: "03-077440ZZMV", totalChf: 212.42, lane: "EXPRESS" });
    expect(o).toMatchObject({ kind: "bought", lane: "STANDARD", totalChf: 212.42 });
  });
  it("easy_buy dry run → done", () => {
    expect(classifyResult({ kind: "easy_buy", detail: "dry_run — would pay" }).kind).toBe("done");
  });
  it("easy_buy without number → paid_no_number (never retried blind)", () => {
    expect(classifyResult({ kind: "easy_buy", detail: "" }).kind).toBe("paid_no_number");
  });
  it("needs_human bot_fail 'paid but no stockx order number' → paid_no_number", () => {
    expect(classifyResult({ kind: "needs_human", reason: "bot_fail", detail: "Paid but no StockX order number" }).kind).toBe(
      "paid_no_number"
    );
  });
  it("GOAT hold skip → held verdict", () => {
    expect(classifyResult({ kind: "skipped", reason: "non_stockx", detail: "goat_jordan_swarovski" })).toMatchObject({
      kind: "verdict",
      status: "held",
    });
  });
  it("plain non_stockx skip → not_stockx", () => {
    expect(classifyResult({ kind: "skipped", reason: "non_stockx", detail: "socks" })).toMatchObject({
      kind: "verdict",
      status: "not_stockx",
    });
  });
  it("margin / cap → too_expensive; oos_no_ask → no_sellers", () => {
    expect(classifyResult({ kind: "needs_human", reason: "margin" })).toMatchObject({ status: "too_expensive" });
    expect(classifyResult({ kind: "needs_human", reason: "cap" })).toMatchObject({ status: "too_expensive" });
    expect(classifyResult({ kind: "needs_human", reason: "oos_no_ask" })).toMatchObject({ status: "no_sellers" });
  });
  it("possible duplicate is never bought through", () => {
    expect(classifyResult({ kind: "needs_human", reason: "prebuy_dedupe" })).toMatchObject({
      kind: "verdict",
      status: "needs_review",
    });
    expect(classifyResult({ kind: "needs_human", reason: "already_matched" })).toMatchObject({ status: "needs_review" });
  });
  it("size / slug problems need review, not retry", () => {
    expect(classifyResult({ kind: "needs_human", reason: "size_us_map" })).toMatchObject({ status: "needs_review" });
    expect(classifyResult({ kind: "needs_human", reason: "slug" })).toMatchObject({ status: "needs_review" });
  });
  it("page flakiness is retry; cf and proxy rotate the session", () => {
    expect(classifyResult({ kind: "needs_human", reason: "bot_fail" })).toMatchObject({ kind: "retry", rotateSession: false });
    expect(classifyResult({ kind: "aborted", reason: "cf_abort_45s" })).toMatchObject({ kind: "retry", rotateSession: true });
    expect(classifyResult({ kind: "needs_human", reason: "proxy_blank" })).toMatchObject({ rotateSession: true });
  });
  it("proxy 402 and link_fail halt", () => {
    expect(classifyResult({ kind: "aborted", reason: "proxy_402" }).kind).toBe("halt");
    expect(classifyResult({ kind: "needs_human", reason: "link_fail", detail: "x" }).kind).toBe("halt");
  });
});

describe("state machine", () => {
  it("retry backs off then parks after MAX_TRIES", () => {
    let st: JobState | undefined;
    const retry = { kind: "retry", reason: "bot_fail", detail: "x", rotateSession: false } as const;
    for (let i = 1; i < MAX_TRIES; i += 1) {
      st = applyOutcome(st, base, retry, 1_000);
      expect(st.status).toBe("retry");
      expect(st.nextAttemptAt).toBe(1_000 + backoffMs(i));
    }
    st = applyOutcome(st, base, retry, 1_000);
    expect(st.status).toBe("parked");
    expect(st.reason).toMatch(/retry_exhausted/);
  });

  it("backoff doubles and caps at 15 min", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(20)).toBe(15 * 60_000);
  });

  it("bought and held never expire; verdicts expire", () => {
    const t0 = 1_000;
    const mk = (status: JobState["status"]): JobState => ({ ...base, status, reason: "", at: t0, tries: 1 });
    const far = t0 + 365 * 86400_000;
    expect(stateBlocks(mk("bought"), far)).toBe(true);
    expect(stateBlocks(mk("held"), far)).toBe(true);
    expect(stateBlocks(mk("done"), far)).toBe(true);
    expect(stateBlocks(mk("too_expensive"), t0 + 60_000)).toBe(true);
    expect(stateBlocks(mk("too_expensive"), t0 + 91 * 60_000)).toBe(false);
    expect(stateBlocks(mk("no_sellers"), t0 + 91 * 60_000)).toBe(false);
  });

  it("retry blocks only until nextAttemptAt", () => {
    const s: JobState = { ...base, status: "retry", reason: "bot_fail", at: 0, tries: 1, nextAttemptAt: 5_000 };
    expect(stateBlocks(s, 4_000)).toBe(true);
    expect(stateBlocks(s, 5_000)).toBe(false);
  });

  it("paid_no_number never returns to a buyable state by itself", () => {
    const s = applyOutcome(undefined, base, { kind: "paid_no_number", totalChf: 100, lane: null }, 0);
    expect(s.status).toBe("needs_review");
    expect(stateBlocks(s, 60_000)).toBe(true);
  });
});

describe("cancelled pair rebuy", () => {
  const ok = { stockxStatus: "CANCELLED", shopifyCancelled: false, precheckStatus: "buyable", alreadyRebought: false };
  it("rebuys a cancelled pair that is still buyable", () => {
    expect(shouldRebuyCancelled(ok)).toEqual({ rebuy: true, reason: "buyable" });
  });
  it("does not rebuy when sold out", () => {
    expect(shouldRebuyCancelled({ ...ok, precheckStatus: "oos_no_ask" })).toEqual({ rebuy: false, reason: "sold_out" });
  });
  it("does not rebuy a live order, a cancelled Shopify order, or one already rebought", () => {
    expect(shouldRebuyCancelled({ ...ok, stockxStatus: "SHIPPED" }).rebuy).toBe(false);
    expect(shouldRebuyCancelled({ ...ok, shopifyCancelled: true }).rebuy).toBe(false);
    expect(shouldRebuyCancelled({ ...ok, alreadyRebought: true }).rebuy).toBe(false);
  });
  it("does not rebuy over margin or excluded brands", () => {
    expect(shouldRebuyCancelled({ ...ok, precheckStatus: "too_expensive" }).rebuy).toBe(false);
    expect(shouldRebuyCancelled({ ...ok, precheckStatus: "excluded_brand" }).rebuy).toBe(false);
  });
});

describe("keys and ordering", () => {
  it("stable idempotency keys", () => {
    expect(jobKey("shopify", { lineItemId: "gid://shopify/LineItem/123", orderRef: "#1" })).toBe("shopify:123");
    expect(jobKey("shopify", { orderRef: "#7661" })).toBe("shopify:#7661");
    expect(jobKey("galaxus", { orderRef: "o", lineId: "L", unitIndex: 1 })).toBe("galaxus:L:1");
  });
  it("lane from StockX order number", () => {
    expect(laneFromOrderNumber("01-ABC")).toBe("EXPRESS");
    expect(laneFromOrderNumber("03-ABC")).toBe("STANDARD");
    expect(laneFromOrderNumber("xx")).toBeNull();
  });
  it("Shopify Express, then Shopify oldest, then Galaxus oldest", () => {
    const q = orderQueue([
      { key: "g1", source: "galaxus" as const, createdAt: 1, express: false },
      { key: "s-new", source: "shopify" as const, createdAt: 50, express: false },
      { key: "s-old", source: "shopify" as const, createdAt: 10, express: false },
      { key: "s-exp", source: "shopify" as const, createdAt: 90, express: true },
      { key: "g0", source: "galaxus" as const, createdAt: 0, express: false },
    ]);
    expect(q.map((x) => x.key)).toEqual(["s-exp", "s-old", "s-new", "g0", "g1"]);
  });
});
