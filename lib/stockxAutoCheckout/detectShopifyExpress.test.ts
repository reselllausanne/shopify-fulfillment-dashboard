import { describe, expect, it } from "vitest";
import {
  detectShopifyExpress,
  desiredStockxLaneFromShopify,
} from "@/lib/stockxAutoCheckout/detectShopifyExpress";

describe("detectShopifyExpress", () => {
  it("uses deliveryMode express", () => {
    expect(detectShopifyExpress({ deliveryMode: "express" })).toBe(true);
    expect(desiredStockxLaneFromShopify(true)).toBe("EXPRESS");
  });

  it("uses deliveryMode standard — never Express StockX", () => {
    expect(detectShopifyExpress({ deliveryMode: "standard" })).toBe(false);
    expect(desiredStockxLaneFromShopify(false)).toBe("STANDARD");
  });

  it("reads Mode d'expédition label", () => {
    expect(
      detectShopifyExpress({
        deliveryMode: null,
        deliveryModeLabel: "Livraison express 2 à 5 jours ouvrés",
      })
    ).toBe(true);
  });

  it("reads shipping line titles as fallback", () => {
    expect(
      detectShopifyExpress({
        deliveryMode: null,
        shippingLineTitles: ["Swiss Post Express"],
      })
    ).toBe(true);
    expect(
      detectShopifyExpress({
        deliveryMode: null,
        shippingLineTitles: ["Xpress overnight"],
      })
    ).toBe(true);
  });

  it("ambiguous → false (safe default Standard)", () => {
    expect(
      detectShopifyExpress({
        deliveryMode: null,
        deliveryModeLabel: null,
        shippingLineTitles: ["Economy"],
      })
    ).toBe(false);
  });

  it("standard mode wins over express-looking shipping title", () => {
    expect(
      detectShopifyExpress({
        deliveryMode: "standard",
        shippingLineTitles: ["Express somehow"],
      })
    ).toBe(false);
  });
});
