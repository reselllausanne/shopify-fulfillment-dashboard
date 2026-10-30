import { describe, expect, it } from "vitest";
import {
  apparelLetterSize,
  buildStockxBuyUrl,
  buildStockxCheckoutBuyUrl,
  convertEuToUs,
  inferBrandFromTitle,
} from "@/lib/stockxAutoCheckout/sizeUsFallback";

describe("convertEuToUs", () => {
  it("maps Nike men EU → US", () => {
    expect(convertEuToUs("EU 42", { brand: "Nike", title: "Nike Dunk Low" })).toBe("8.5");
  });

  it("maps adidas men EU fractions", () => {
    const us = convertEuToUs("EU 42 2/3", {
      brand: "adidas",
      title: "adidas Handball Spezial",
    });
    expect(us).toBe("9");
  });

  it("infers brand from title", () => {
    expect(inferBrandFromTitle("Jordan 1 Retro High")).toBe("air jordan");
    expect(convertEuToUs("40.5", { title: "Air Jordan 1 Mid" })).toBeTruthy();
  });

  it("returns null when chart miss", () => {
    expect(convertEuToUs("EU 99", { brand: "Nike" })).toBeNull();
  });

  it("passthrough apparel letter sizes (no footwear chart)", () => {
    expect(convertEuToUs("S", { title: "Nike Tech Fleece Hoodie" })).toBe("S");
    expect(convertEuToUs("M", { title: "NOCTA Jacket" })).toBe("M");
    expect(convertEuToUs("US S", { title: "Travis Hoodie" })).toBe("S");
    expect(convertEuToUs("XL", { brand: "Nike" })).toBe("XL");
    expect(convertEuToUs("2XL", { brand: "Nike" })).toBe("2XL");
  });

  it("appends W for women's footwear StockX deep-link (?size=8W)", () => {
    expect(
      convertEuToUs("EU 40", {
        brand: "adidas",
        title: "adidas Stan Smith Cloud White Off White Wonder White (Women's)",
      })
    ).toBe("8W");
  });
});

describe("apparelLetterSize", () => {
  it("passes through all letter sizes, case + whitespace normalized", () => {
    expect(apparelLetterSize("S")).toBe("S");
    expect(apparelLetterSize("m")).toBe("M");
    expect(apparelLetterSize(" L ")).toBe("L");
    expect(apparelLetterSize("xl")).toBe("XL");
    expect(apparelLetterSize("XS")).toBe("XS");
    expect(apparelLetterSize("xxl")).toBe("XXL");
    expect(apparelLetterSize("US S")).toBe("S");
    expect(apparelLetterSize("EU M")).toBe("M");
    expect(apparelLetterSize("2XL")).toBe("2XL");
  });

  it("returns null for footwear numeric / OS / junk (no false apparel match)", () => {
    expect(apparelLetterSize("42")).toBeNull();
    expect(apparelLetterSize("8.5")).toBeNull();
    expect(apparelLetterSize("36 2/3")).toBeNull();
    expect(apparelLetterSize("OS")).toBeNull();
    expect(apparelLetterSize("")).toBeNull();
    expect(apparelLetterSize(null)).toBeNull();
    expect(apparelLetterSize("Small")).toBeNull();
  });
});

describe("buildStockxBuyUrl", () => {
  it("appends size query", () => {
    expect(buildStockxBuyUrl("nike-dunk-low", "8.5")).toContain("?size=8.5");
  });

  it("appends apparel letter size query", () => {
    expect(buildStockxBuyUrl("nike-tech-fleece-hoodie", "S")).toContain("?size=S");
    expect(buildStockxBuyUrl("nocta-jacket", "M")).toContain("?size=M");
  });
});

describe("buildStockxCheckoutBuyUrl", () => {
  it("uses /buy/ path with size", () => {
    expect(buildStockxCheckoutBuyUrl("nike-dunk-low", "8.5")).toBe(
      "https://stockx.com/fr-fr/buy/nike-dunk-low?size=8.5"
    );
  });
});
