import { describe, expect, it } from "vitest";
import {
  checkGoat,
  compareGoat,
  goatAllInChf,
  goatCostModelFromEnv,
  pickGoatProduct,
  pickGoatVariant,
} from "@/lib/stockxBuyer/goatWatch";

const model = { usdChf: 0.8, shipUsd: 25, vat: 0.081, minSavingChf: 15, minSavingPct: 0.08 };

describe("goatWatch", () => {
  it("all-in = (ask + ship) * fx * (1 + vat)", () => {
    expect(goatAllInChf(200, model)).toBeCloseTo((225 * 0.8 * 1.081), 2);
  });

  it("alerts only when saving clears both CHF and % thresholds", () => {
    expect(compareGoat({ stockxAllInChf: 300, askUsd: 150, model }).kind).toBe("goat_cheaper");
    // goat ≈ 151.7 → saving big
    expect(compareGoat({ stockxAllInChf: 200, askUsd: 200, model }).kind).toBe("stockx_ok");
    // small absolute saving
    expect(compareGoat({ stockxAllInChf: 60, askUsd: 30, model }).kind).toBe("stockx_ok");
  });

  it("no ask or no StockX reference → no verdict, never an alert", () => {
    expect(compareGoat({ stockxAllInChf: 300, askUsd: null, model }).kind).toBe("no_goat");
    expect(compareGoat({ stockxAllInChf: null, askUsd: 100, model }).kind).toBe("no_goat");
  });

  it("matches product by sku and variant by US size", () => {
    const rows = [
      { sku: "DZ5485 611", variants: [] },
      { sku: "DZ5485 612", variants: [{ size: "10", lowest_ask: 200, available: true }, { size: "10.5", lowest_ask: 0, available: true }] },
    ];
    const p = pickGoatProduct(rows, "DZ5485-612");
    expect(p?.sku).toBe("DZ5485 612");
    expect(pickGoatVariant(p!, "10")?.lowest_ask).toBe(200);
    expect(pickGoatVariant(p!, "10.5")).toBeNull();
    expect(pickGoatVariant(p!, "11")).toBeNull();
  });

  it("checkGoat never throws and degrades to no_goat on API failure", async () => {
    const boom = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const v = await checkGoat({ sku: "DZ5485-612", sizeEU: "44", stockxAllInChf: 300, fetchImpl: boom, now: 1 });
    expect(v.kind).toBe("no_goat");
  });

  it("env model falls back to defaults on junk", () => {
    expect(goatCostModelFromEnv({ GOAT_USD_CHF: "abc" } as unknown as NodeJS.ProcessEnv).usdChf).toBe(0.8);
  });
});
