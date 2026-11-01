import { describe, expect, it } from "vitest";
import {
  buildGalaxusMarginNeedsHumanPayload,
  galaxusMarginAlertRefKey,
} from "@/lib/stockxAutoCheckout/galaxusMarginAlert";

describe("galaxusMarginAlertRefKey", () => {
  it("uses gx-margin:<lineId>", () => {
    expect(galaxusMarginAlertRefKey("line-abc")).toBe("gx-margin:line-abc");
  });
});

describe("buildGalaxusMarginNeedsHumanPayload", () => {
  const candidate = {
    galaxusOrderId: "209912345",
    lineId: "line-kd-dj7554",
    productName: "KD DJ7554-009",
    slug: "nike-kd-17",
    sizeEU: "44.5",
    sellChf: 100,
    desiredLaneHint: "EXPRESS" as const,
  };

  it("includes sell vs total / margin% / order / product", () => {
    const p = buildGalaxusMarginNeedsHumanPayload({
      candidate,
      totalChf: 130,
      detail: "sell 100 vs total 130 margin -30.0% (floor 5%)",
      lane: "EXPRESS",
    });
    expect(p.reason).toBe("margin");
    expect(p.shopifyOrderName).toBe("GX 209912345");
    expect(p.shopifyLineItemId).toBe("line-kd-dj7554");
    expect(p.title).toBe("KD DJ7554-009");
    expect(p.saleChf).toBe(100);
    expect(p.detail).toContain("100.00 CHF");
    expect(p.detail).toContain("130.00 CHF");
    expect(p.detail).toMatch(/-30\.0%/);
    expect(p.detail).toContain("lane EXPRESS");
    expect(p.recommended?.totalChf).toBe(130);
    expect(p.slug).toBe("nike-kd-17");
    expect(p.productUrl).toContain("nike-kd-17");
  });

  it("works without totalChf", () => {
    const p = buildGalaxusMarginNeedsHumanPayload({
      candidate,
      detail: "margin abort",
    });
    expect(p.detail).toContain("sell 100.00 CHF");
    expect(p.recommended).toBeNull();
  });
});
