import { describe, expect, it } from "vitest";
import { applyCheapItemSellFloor } from "@/app/lib/scraperCheapFloor";

describe("applyCheapItemSellFloor", () => {
  it("raises sell when buy under 10 and % margin is thin", () => {
    // buy 6 + ship 2 → landed 8; 15% → 9.20; floor → 13
    const out = applyCheapItemSellFloor({
      buyChf: 6,
      landedChf: 8,
      sellFromPercentChf: 9.2,
    });
    expect(out.sellPriceChf).toBe(13);
    expect(out.usedMinAbsFloor).toBe(true);
  });

  it("leaves higher priced SKUs on percent path", () => {
    const out = applyCheapItemSellFloor({
      buyChf: 22,
      landedChf: 24,
      sellFromPercentChf: 28.2,
    });
    expect(out.sellPriceChf).toBe(28.2);
    expect(out.usedMinAbsFloor).toBe(false);
  });

  it("does not lower a stronger percent sell", () => {
    const out = applyCheapItemSellFloor({
      buyChf: 8,
      landedChf: 10,
      sellFromPercentChf: 16,
    });
    expect(out.sellPriceChf).toBe(16);
    expect(out.usedMinAbsFloor).toBe(false);
  });
});
