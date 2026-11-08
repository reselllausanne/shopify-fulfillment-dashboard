import { describe, expect, it } from "vitest";
import {
  classifyCheckoutResult,
  lockIsLive,
  laneFromOrderNumber,
  missingUnitIndexes,
  shouldRotateSession,
  stateBlocks,
} from "@/lib/stockxAutoCheckout/galaxusNightBuyer";
import { chooseLaneByGalaxusNoLoss, isNoSellersPage } from "@/lib/stockxAutoCheckout/chooseLane";
import { convertEuToUs } from "@/lib/stockxAutoCheckout/sizeUsFallback";

const lane = (label: "EXPRESS" | "STANDARD", totalChf: number) => ({
  label,
  rawLabel: label,
  totalChf,
  eta: null,
});

describe("night buyer lane rule", () => {
  it("Express when no loss", () => {
    const r = chooseLaneByGalaxusNoLoss(186.13, [lane("STANDARD", 152), lane("EXPRESS", 153.1)]);
    expect(r.ok && r.lane.label).toBe("EXPRESS");
  });
  it("Standard when Express loses but Standard loss <= 5%", () => {
    const r = chooseLaneByGalaxusNoLoss(100, [lane("STANDARD", 104), lane("EXPRESS", 120)]);
    expect(r.ok && r.lane.label).toBe("STANDARD");
  });
  it("aborts when Standard loses more than 5%", () => {
    const r = chooseLaneByGalaxusNoLoss(100, [lane("STANDARD", 106.7), lane("EXPRESS", 120)]);
    expect(r.ok).toBe(false);
  });
  it("Standard-only page buys at no loss", () => {
    const r = chooseLaneByGalaxusNoLoss(106.64, [lane("STANDARD", 88.67)]);
    expect(r.ok && r.lane.label).toBe("STANDARD");
  });
});

describe("no-sellers page", () => {
  it("detects bid-only page", () => {
    expect(isNoSellersPage("There are no sellers to buy from right now\nGood Offer\nReview Offer")).toBe(true);
  });
  it("checkout with Review Order is not no-sellers", () => {
    expect(isNoSellersPage("Subtotal CHF 152\nReview Order")).toBe(false);
  });
});

describe("size tokens", () => {
  it("youth gets Y", () => {
    expect(convertEuToUs("35", { title: "Jordan 1 Travis Scott (PS)", brand: "Air Jordan" })).toMatch(/Y$/);
  });
  it("women via slug gets W", () => {
    expect(convertEuToUs("38", { title: "Ugg Classic Mini", brand: "UGG", slug: "ugg-classic-mini-ii-boot-chestnut-w" })).toMatch(/W$/);
  });
});

describe("classifyCheckoutResult", () => {
  it("Cloudflare / hydrate = retry, never a verdict", () => {
    for (const reason of ["proxy_blank", "express_unparsed", "price_moved", "oos", "bot_fail"]) {
      expect(classifyCheckoutResult({ kind: "needs_human", reason, detail: "x" }).kind).toBe("retry");
    }
  });
  it("real verdicts", () => {
    expect(classifyCheckoutResult({ kind: "needs_human", reason: "margin_abort" })).toMatchObject({ status: "too_expensive" });
    expect(classifyCheckoutResult({ kind: "needs_human", reason: "oos_no_ask" })).toMatchObject({ status: "no_sellers" });
  });
  it("paid without number is recovered, link fail halts", () => {
    expect(
      classifyCheckoutResult({ kind: "needs_human", reason: "bot_fail", detail: "Paid but no StockX order number parsed" }).kind
    ).toBe("paid_no_number");
    expect(classifyCheckoutResult({ kind: "needs_human", reason: "link_fail" }).kind).toBe("halt");
  });
  it("size grid is a size problem, not Cloudflare", () => {
    expect(classifyCheckoutResult({ kind: "needs_human", reason: "size_grid" })).toMatchObject({ status: "needs_review" });
  });
  it("bought needs a number", () => {
    expect(classifyCheckoutResult({ kind: "easy_buy", stockxOrderNumber: "03-ABC", totalChf: 10 }).kind).toBe("bought");
    expect(classifyCheckoutResult({ kind: "easy_buy", stockxOrderNumber: null }).kind).toBe("paid_no_number");
  });
});

describe("units + state + session", () => {
  it("qty 2 with unit 0 taken needs unit 1", () => {
    expect(missingUnitIndexes(2, [{ unitIndex: 0 }])).toEqual([1]);
    expect(missingUnitIndexes(1, [{ unitIndex: 0 }])).toEqual([]);
  });
  it("too_expensive blocks 90 min then reopens", () => {
    const at = 1_000_000;
    expect(stateBlocks({ status: "too_expensive", reason: "m", at }, at + 60_000)).toBe(true);
    expect(stateBlocks({ status: "too_expensive", reason: "m", at }, at + 91 * 60_000)).toBe(false);
    expect(stateBlocks({ status: "bought", reason: "b", at }, at + 99 * 3600_000)).toBe(true);
  });
  it("keeps the IP until 2 fails or expiry", () => {
    const now = 10_000_000;
    expect(shouldRotateSession({ startedAt: now - 60_000, consecutiveFails: 1 }, now)).toBe(false);
    expect(shouldRotateSession({ startedAt: now - 60_000, consecutiveFails: 2 }, now)).toBe(true);
    expect(shouldRotateSession({ startedAt: now - 51 * 60_000, consecutiveFails: 0 }, now)).toBe(true);
  });
});

describe("single instance lock", () => {
  it("live lock blocks a second worker, stale lock does not", () => {
    expect(lockIsLive(1_000_000 - 10_000, 1_000_000)).toBe(true);
    expect(lockIsLive(1_000_000 - 60_000, 1_000_000)).toBe(false);
    expect(lockIsLive(null, 1_000_000)).toBe(false);
  });
});

describe("lane from order number", () => {
  it("01 express, 03 standard", () => {
    expect(laneFromOrderNumber("01-ABC")).toBe("EXPRESS");
    expect(laneFromOrderNumber("03-ABC")).toBe("STANDARD");
    expect(laneFromOrderNumber("xx")).toBeNull();
  });
});
