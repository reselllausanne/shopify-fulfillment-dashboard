import { describe, expect, it } from "vitest";
import {
  availabilityTextImpliesDelayed,
  availabilityTextImpliesOos,
  isSchemaOfferInStock,
  resolveScraperStock,
} from "@/app/lib/scraperAvailability";

describe("isSchemaOfferInStock", () => {
  it("accepts InStock only", () => {
    expect(isSchemaOfferInStock("https://schema.org/InStock")).toBe(true);
    expect(isSchemaOfferInStock("InStock")).toBe(true);
  });

  it("rejects preorder/backorder/OOS", () => {
    expect(isSchemaOfferInStock("https://schema.org/PreOrder")).toBe(false);
    expect(isSchemaOfferInStock("https://schema.org/BackOrder")).toBe(false);
    expect(isSchemaOfferInStock("https://schema.org/OutOfStock")).toBe(false);
    expect(isSchemaOfferInStock("https://schema.org/LimitedAvailability")).toBe(false);
  });
});

describe("availabilityTextImpliesOos", () => {
  it("detects off-lager and nicht lieferbar", () => {
    expect(availabilityTextImpliesOos("Der Artikel ist off lager")).toBe(true);
    expect(availabilityTextImpliesOos("aktuell nicht lieferbar")).toBe(true);
    expect(availabilityTextImpliesOos("Vorbestellung möglich")).toBe(true);
  });
});

describe("availabilityTextImpliesDelayed", () => {
  it("detects multi-week lead times", () => {
    expect(availabilityTextImpliesDelayed("Lieferzeit 4-6 Wochen")).toBe(true);
    expect(availabilityTextImpliesDelayed("Lieferbar ab 15.10.2026")).toBe(true);
    expect(availabilityTextImpliesDelayed("Sofort lieferbar")).toBe(false);
  });
});

describe("resolveScraperStock", () => {
  it("uses explicit qty when present", () => {
    expect(
      resolveScraperStock({
        schemaAvailability: "InStock",
        explicitQty: 3,
        defaultStockWhenImmediate: 5,
      })
    ).toEqual({ inStock: true, stock: 3, stockSource: "explicit_qty" });
  });

  it("zeros on off-lager page text", () => {
    expect(
      resolveScraperStock({
        schemaAvailability: "InStock",
        pageText: "Off-Lager — Lieferung in 8 Wochen",
        defaultStockWhenImmediate: 5,
      })
    ).toEqual({ inStock: false, stock: 0, stockSource: "page_text_oos" });
  });

  it("requires immediate text before default qty", () => {
    expect(
      resolveScraperStock({
        schemaAvailability: "InStock",
        pageText: "Product details only",
        defaultStockWhenImmediate: 5,
        requireImmediateText: true,
      })
    ).toEqual({ inStock: false, stock: 0, stockSource: "not_immediate" });

    expect(
      resolveScraperStock({
        schemaAvailability: "InStock",
        pageText: "Auf Lager — sofort lieferbar",
        defaultStockWhenImmediate: 1,
        requireImmediateText: true,
      })
    ).toEqual({ inStock: true, stock: 1, stockSource: "default_instock" });
  });
});
