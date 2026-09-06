import { describe, expect, it } from "vitest";
import {
  availabilityTextImpliesDelayed,
  availabilityTextImpliesOos,
  isSchemaOfferInStock,
  resolveScraperStock,
  stockFromExplicitQtyOnly,
} from "@/app/lib/scraperAvailability";

describe("isSchemaOfferInStock", () => {
  it("accepts InStock only", () => {
    expect(isSchemaOfferInStock("https://schema.org/InStock")).toBe(true);
  });

  it("rejects preorder/backorder/OOS", () => {
    expect(isSchemaOfferInStock("https://schema.org/PreOrder")).toBe(false);
    expect(isSchemaOfferInStock("https://schema.org/BackOrder")).toBe(false);
    expect(isSchemaOfferInStock("https://schema.org/OutOfStock")).toBe(false);
  });
});

describe("availabilityTextImpliesOos", () => {
  it("detects off-lager", () => {
    expect(availabilityTextImpliesOos("Der Artikel ist off lager")).toBe(true);
  });
});

describe("availabilityTextImpliesDelayed", () => {
  it("detects multi-week lead times", () => {
    expect(availabilityTextImpliesDelayed("Lieferzeit 4-6 Wochen")).toBe(true);
    expect(availabilityTextImpliesDelayed("Sofort lieferbar")).toBe(false);
  });
});

describe("resolveScraperStock", () => {
  it("uses explicit qty when present", () => {
    expect(
      resolveScraperStock({
        schemaAvailability: "InStock",
        explicitQty: 3,
      })
    ).toEqual({ inStock: true, stock: 3, stockSource: "explicit_qty" });
  });

  it("zeros on off-lager page text", () => {
    expect(
      resolveScraperStock({
        schemaAvailability: "InStock",
        pageText: "Off-Lager — Lieferung in 8 Wochen",
      })
    ).toEqual({ inStock: false, stock: 0, stockSource: "page_text_oos" });
  });

  it("zeros without explicit qty even when schema InStock", () => {
    expect(
      resolveScraperStock({
        schemaAvailability: "InStock",
        pageText: "Auf Lager — sofort lieferbar",
      })
    ).toEqual({ inStock: false, stock: 0, stockSource: "no_explicit_qty" });
  });
});

describe("stockFromExplicitQtyOnly", () => {
  it("returns 0 without explicit qty", () => {
    expect(stockFromExplicitQtyOnly(true, null)).toBe(0);
    expect(stockFromExplicitQtyOnly(true, 4)).toBe(4);
  });
});
