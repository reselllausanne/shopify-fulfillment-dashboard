import { describe, expect, it } from "vitest";
import { classifyReicheltGalaxusKind } from "@/app/lib/reicheltGalaxusCategories";
import { resolveGalaxusProductCategoryPath } from "@/galaxus/exports/productClassification";

describe("classifyReicheltGalaxusKind pressure washers", () => {
  it("maps Stanley pressure washer to Hochdruckreiniger, not Bolzenschneider", () => {
    const title = "STANLEY TOOLS Nettoyeur haute pression, 180 bar, 2500 W, 500 l/h.";
    expect(classifyReicheltGalaxusKind({ title })).toBe("pressure_washer");
    expect(
      resolveGalaxusProductCategoryPath({
        title,
        brand: "STANLEY TOOLS",
        supplierKey: "rei",
      })
    ).toBe("Baumarkt + Garten > Gartenbau + Technik > Reinigungsmaschinen > Hochdruckreiniger");
  });

  it("does not treat STANLEY TOOLS brand alone as electronic_tool", () => {
    expect(
      classifyReicheltGalaxusKind({
        title: "STANLEY TOOLS Compresseur, 10 bar, 24 l, 180 l/min",
      })
    ).not.toBe("electronic_tool");
  });
});
