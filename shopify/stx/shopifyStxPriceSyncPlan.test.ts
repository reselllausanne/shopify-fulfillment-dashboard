import { describe, expect, it } from "vitest";
import { isTcgPriorityProductName } from "@/shopify/stx/shopifyStxPriceSyncPlan";

describe("isTcgPriorityProductName", () => {
  it("flags pokemon booster boxes", () => {
    expect(isTcgPriorityProductName("Pokémon Scarlet & Violet 151 Booster Box (Japanese)")).toBe(
      true
    );
  });
  it("ignores random sneakers", () => {
    expect(isTcgPriorityProductName("Adidas Samba OG White")).toBe(false);
  });
});
