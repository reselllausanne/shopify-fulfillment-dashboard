import { describe, expect, it } from "vitest";
import { resolveGalaxusProductCategoryPath } from "@/galaxus/exports/productClassification";
import { GALAXUS_CATEGORY_PATHS } from "@/galaxus/exports/galaxusCategoryPaths";

/**
 * Galaxus assigns a product type only on Producttypes.xlsx leaves.
 * "Mode > Alles in Mode > Bekleidung" is a branch — never ship it.
 */
describe("apparel category leaves", () => {
  it("never resolves to the bare Bekleidung branch", () => {
    for (const path of Object.values(GALAXUS_CATEGORY_PATHS)) {
      expect(path).not.toBe("Mode > Alles in Mode > Bekleidung");
    }
  });

  it.each([
    ["Supreme Standard Tee Fluorescent Yellow", "Shirts"],
    ["Nike Sportswear Club Jersey", "Shirts"],
    ["Fear of God Essentials Hoodie Black", "Pullover"],
    ["Nike Tech Fleece Crewneck Grey", "Pullover"],
    ["Stone Island Down Puffer Jacket", "Winterjacken"],
    ["Arc'teryx Beta Rain Jacket", "Regenjacken"],
    ["Supreme Coach Jacket Black", "Leichte Jacken"],
    ["Patagonia Nano Puff Vest", "Westen"],
    ["Ralph Lauren Oxford Shirt Blue", "Hemden"],
  ])("%s → %s", (title, expectedLeaf) => {
    const path = resolveGalaxusProductCategoryPath({ title });
    expect(path).toContain(expectedLeaf);
    expect(path.split(" > ").length).toBeGreaterThanOrEqual(4);
  });
});
