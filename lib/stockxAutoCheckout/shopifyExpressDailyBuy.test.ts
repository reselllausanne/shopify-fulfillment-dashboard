import { describe, expect, it } from "vitest";
import { detectShopifyExpress } from "@/lib/stockxAutoCheckout/detectShopifyExpress";

describe("Shopify Express daily buy gate", () => {
  it("only Express shipping qualifies", () => {
    expect(
      detectShopifyExpress({
        deliveryMode: "express",
        deliveryModeLabel: "Livraison express",
      })
    ).toBe(true);
    expect(
      detectShopifyExpress({
        deliveryMode: "standard",
        deliveryModeLabel: "Standard",
      })
    ).toBe(false);
  });
});
