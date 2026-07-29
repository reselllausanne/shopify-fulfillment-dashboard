import { describe, expect, it } from "vitest";
import {
  extractNewsoleSizeLabel,
  inferNewsoleGender,
  parseNewsoleChfPrice,
} from "@/app/lib/newsoleClient";
import { classifyNewsoleGalaxusKind } from "@/app/lib/newsoleGalaxusCategories";

describe("parseNewsoleChfPrice", () => {
  it("converts minor-unit CHF prices", () => {
    expect(parseNewsoleChfPrice({ price: "15900", regular_price: "15900", sale_price: "15900" })).toBe(159);
  });
});

describe("extractNewsoleSizeLabel", () => {
  it("reads size from variation label", () => {
    expect(
      extractNewsoleSizeLabel({
        variation: "Size: 42.5",
        attributes: [],
      } as any)
    ).toBe("42.5");
  });
});

describe("inferNewsoleGender", () => {
  it("detects women from title", () => {
    expect(inferNewsoleGender("New Balance 550 (Women's)", [])).toBe("women");
  });
});

describe("classifyNewsoleGalaxusKind", () => {
  it("maps jordan to sneakers", () => {
    expect(
      classifyNewsoleGalaxusKind({
        title: "Air Jordan 4 Retro",
        categories: ["Jordan"],
        brand: "Jordan",
      })
    ).toBe("sneakers");
  });

  it("maps ugg to slippers", () => {
    expect(classifyNewsoleGalaxusKind({ title: "UGG Classic Mini", categories: ["UGG"], brand: "UGG" })).toBe(
      "slippers"
    );
  });
});
