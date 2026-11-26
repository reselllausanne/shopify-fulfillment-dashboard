import { describe, expect, it } from "vitest";
import { isNeverBuyStockx, NEVER_BUY_STOCKX } from "@/lib/stockxAutoCheckout/neverBuyStockx";
import { classifySlugMissingOutcome, isClearlyNotStockxBuyable } from "@/lib/stockxAutoCheckout/nonStockxBuyable";

const TITLE = "Nike Varsity Elite Backpack White/Black/Metallic Silver (32 l)";

describe("NEVER_BUY_STOCKX", () => {
  it("lists MPN, STX sku and GTIN", () => {
    const tokens = NEVER_BUY_STOCKX.map((e) => e.token);
    expect(tokens).toEqual(expect.arrayContaining(["HM9965-010", "STX_198480965312", "198480965312"]));
  });

  it("blocks by GTIN, supplier sku, MPN (any case) and shopify-style sku", () => {
    expect(isNeverBuyStockx({ gtin: "198480965312" }).blocked).toBe(true);
    expect(isNeverBuyStockx({ sku: "STX_198480965312" }).blocked).toBe(true);
    expect(isNeverBuyStockx({ supplierPid: "stx_198480965312" }).blocked).toBe(true);
    expect(isNeverBuyStockx({ mpn: "hm9965-010" }).blocked).toBe(true);
    expect(isNeverBuyStockx({ sku: "HM9965-010-OS" }).blocked).toBe(true);
  });

  it("does not block other Nike bags / sneakers (incl. Playful Pink Varsity Elite)", () => {
    expect(
      isNeverBuyStockx({
        title: "Nike Varsity Elite 32L Backpack Playful Pink/Black/Black (32 l)",
        sku: "STX_198481882373",
        gtin: "198481882373",
      }).blocked
    ).toBe(false);
    expect(isNeverBuyStockx({ title: "Air Jordan 1 Retro High OG Chicago", sku: "DZ5485-612-43" }).blocked).toBe(false);
    expect(isNeverBuyStockx({}).blocked).toBe(false);
  });

  it("feeds isClearlyNotStockxBuyable (even with a StockX-plausible title) and skips slug-missing", () => {
    const hit = isClearlyNotStockxBuyable({ title: `${TITLE} Jordan Dunk`, sku: "STX_198480965312" });
    expect(hit.notBuyable).toBe(true);
    expect(hit.label).toBe("never_buy_stockx");
    expect(isClearlyNotStockxBuyable({ title: TITLE, gtin: "198480965312" }).notBuyable).toBe(true);
    expect(classifySlugMissingOutcome({ title: TITLE, sku: "HM9965-010" })).toBe("skipped");
  });
});
