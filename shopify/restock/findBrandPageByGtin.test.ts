import { describe, expect, it } from "vitest";
import { findBrandPageByGtin, gtinSearchVariants, type SearchFn } from "./findBrandPageByGtin";

const nikeUrl = "https://www.nike.com/ch/t/court-borough-low-2-schuh-fur-babys-und-kleinkinder-NsKtlb/BQ5453-001";

const fake: SearchFn = async (q) => {
  if (q.startsWith("site:nike.com")) return [{ link: nikeUrl, title: "Nike Court Borough Low 2" }];
  if (q === "193145977099") {
    return [
      { link: "https://www.de.fnac.ch/QUIKSILV/a1", title: "Quiksilver Rucksack" },
      { link: "https://www.amazon.ca/Nike-Court-Borough-Toddler-Bq5453-001/dp/B07YVPV9ZP", title: "Nike Court Borough Low 2 (TDV) Toddler Bq5453-001" },
      { link: "https://en-qa.sssports.com/nike-kids/193145977099.html", title: "Nike Kids' Court Borough Low 2", snippet: "BQ5453-001" },
    ];
  }
  return [];
};

describe("findBrandPageByGtin", () => {
  it("variants: 12 digits first", () => {
    expect(gtinSearchVariants("00193145977099")[0]).toBe("193145977099");
  });
  it("finds the official Nike page from a GTIN", async () => {
    const r = await findBrandPageByGtin("00193145977099", fake);
    expect(r).toMatchObject({ ok: true, brand: "nike", styleCode: "BQ5453-001", url: "https://www.nike.com/ch/t/x/BQ5453-001" });
  });
  it("fails cleanly when nothing names a brand", async () => {
    const r = await findBrandPageByGtin("00193145977099", async () => []);
    expect(r).toMatchObject({ ok: false, error: "brand_not_found" });
  });
});
