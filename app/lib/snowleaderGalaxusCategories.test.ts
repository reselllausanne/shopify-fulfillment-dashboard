import { describe, expect, it } from "vitest";
import {
  classifySnowleaderCategoryLabel,
  inferSnowleaderGender,
  SNOWLEADER_GALAXUS_CATEGORY_IDS,
} from "@/app/lib/snowleaderGalaxusCategories";

describe("snowleaderGalaxusCategories", () => {
  it("includes all major Galaxus-mappable groups", () => {
    expect(SNOWLEADER_GALAXUS_CATEGORY_IDS).toContain("596");
    expect(SNOWLEADER_GALAXUS_CATEGORY_IDS).toContain("380");
    expect(SNOWLEADER_GALAXUS_CATEGORY_IDS).toContain("1047");
    expect(SNOWLEADER_GALAXUS_CATEGORY_IDS).toContain("346");
    expect(SNOWLEADER_GALAXUS_CATEGORY_IDS).toContain("272");
    // Mapping list only grows; exact count is not a contract.
    expect(SNOWLEADER_GALAXUS_CATEGORY_IDS.length).toBeGreaterThanOrEqual(275);
  });

  it("classifies leaf category labels", () => {
    expect(classifySnowleaderCategoryLabel("Sneakers")).toBe("sneakers");
    expect(classifySnowleaderCategoryLabel("Skihosen Damen")).toBe("ski_pants");
    expect(classifySnowleaderCategoryLabel("Duffel Reisetaschen")).toBe("duffel");
    expect(classifySnowleaderCategoryLabel("Wanderschuhe")).toBe("hiking_boots");
  });

  it("infers gender from category path", () => {
    expect(inferSnowleaderGender(["Skihosen Damen", "Edge Pant W"])).toBe("women");
    expect(inferSnowleaderGender(["Sneakers", "Cloudhorizon Herren"])).toBe("men");
  });
});
