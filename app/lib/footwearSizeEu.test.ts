import { describe, expect, it } from "vitest";
import {
  convertUkSizeToUs,
  convertUsSizeToEu,
  pickSnowleaderSizeSourceLabel,
  resolveFootwearEuSize,
  resolveSnowleaderVariantEuSize,
} from "@/app/lib/footwearSizeEu";

describe("footwearSizeEu", () => {
  it("prefers EU attribute label when Snowleader exposes it", () => {
    expect(
      pickSnowleaderSizeSourceLabel([
        { label: "5 UK", code: "gamme_tailles_uk" },
        { label: "38", code: "gamme_tailles_eu" },
      ])
    ).toBe("38");
  });

  it("converts adidas UK store size to EU via US chart", () => {
    expect(
      resolveFootwearEuSize("5 UK", { brand: "adidas", gender: "men" })
    ).toEqual({
      euSize: "38",
      sourceLabel: "5 UK",
      conversion: "uk",
    });
  });

  it("converts comma-decimal UK labels", () => {
    expect(convertUkSizeToUs("6,5 UK", { brand: "adidas", gender: "men" })).toBe("7");
    expect(convertUsSizeToEu("7", { brand: "adidas", gender: "men" })).toBe("40");
  });

  it("keeps EU label when already EU", () => {
    expect(resolveFootwearEuSize("EU 42", { brand: "Nike", gender: "men" })).toEqual({
      euSize: "42",
      sourceLabel: "EU 42",
      conversion: "eu",
    });
  });

  it("converts US label through brand chart", () => {
    expect(resolveFootwearEuSize("US 9", { brand: "Nike", gender: "men" })).toEqual({
      euSize: "42.5",
      sourceLabel: "US 9",
      conversion: "us",
    });
  });

  it("maps Snowleader Gazelle ADV UK variant to EU size", () => {
    const resolved = resolveSnowleaderVariantEuSize({
      attributes: [{ label: "5 UK", code: "gamme_tailles_uk" }],
      brand: "adidas",
      gender: "men",
      galaxusKind: "sneakers",
    });
    expect(resolved.sizeLabel).toBe("38");
    expect(resolved.sourceLabel).toBe("5 UK");
    expect(resolved.conversion).toBe("uk");
  });

  it("leaves apparel sizes unchanged", () => {
    const resolved = resolveSnowleaderVariantEuSize({
      attributes: [{ label: "M", code: "size" }],
      brand: "The North Face",
      gender: "men",
      galaxusKind: "trousers",
    });
    expect(resolved.sizeLabel).toBe("M");
    expect(resolved.conversion).toBe("raw");
  });
});
