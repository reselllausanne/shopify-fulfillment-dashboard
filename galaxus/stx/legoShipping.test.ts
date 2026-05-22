import { describe, expect, it } from "vitest";
import { resolveStxShippingCHF } from "./legoShipping";

describe("resolveStxShippingCHF", () => {
  it("returns exact manual shipping for large LEGO overrides", () => {
    expect(resolveStxShippingCHF({ slug: "lego-icons-the-endurance-set-10335" })).toBe(60);
  });

  it("returns exact manual shipping for medium LEGO overrides", () => {
    expect(resolveStxShippingCHF({ slug: "lego-pet-shop-set-10218" })).toBe(45);
  });

  it("returns exact manual shipping for small LEGO overrides", () => {
    expect(resolveStxShippingCHF({ slug: "lego-star-wars-tie-fighter-set-75095" })).toBe(35);
    expect(resolveStxShippingCHF({ slug: "lego-creator-winter-holiday-train-set-10254" })).toBe(35);
  });

  it("returns exact manual shipping for explicit 25 CHF LEGO overrides", () => {
    expect(resolveStxShippingCHF({ slug: "lego-ideas-nasa-apollo-saturn-v-set-92176" })).toBe(25);
  });

  it("falls back to default 20 CHF for other LEGO products", () => {
    expect(resolveStxShippingCHF({ slug: "lego-random-set-12345" })).toBe(20);
    expect(resolveStxShippingCHF({ title: "LEGO mystery set" })).toBe(20);
  });
});
