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

  it("StockX hoodie alias resolves to Pullover, not Shirts", () => {
    const path = resolveGalaxusProductCategoryPath({
      title: "Fear of God Essentials Fleece Hoodie (FW24) Black",
      productType: "hoodies",
    });
    expect(path).toContain("Pullover");
  });

  it("StockX sneaker alias + running model resolves to Laufschuhe", () => {
    for (const title of ["ASICS Gel-Nimbus 26 Blue", "On Running Cloudflow 5 Slam Jam", "Hoka One One Speedgoat 7 Vintage Yellow"]) {
      expect(resolveGalaxusProductCategoryPath({ title, productType: "sneakers" })).toContain("Laufschuhe");
    }
    expect(resolveGalaxusProductCategoryPath({ title: "adidas Campus 00s Core Black", productType: "sneakers" })).toContain("Sneakers");
  });

  it("StockX generic aliases refine by title (AssortmentErrors Step 3)", () => {
    const cases: Array<[string, string, string]> = [
      ["adidas Adilette 22 Slides Magic Lime", "sneakers", "Sandalen"],
      ["Nike Vista Sandal Light British Tan", "sneakers", "Sandalen"],
      ["Crocs Classic Clog Disney Princesses (Kids)", "sneakers", "Hausschuhe"],
      ["adidas Women's Terrex Techrock Gore-Tex Pro Jacket Black", "apparel", "Leichte Jacken"],
      ["Nike Devin Booker Repel 8\" Basketball Shorts", "apparel", "Shorts"],
      ["adidas Jamaica Bob Marley Track Pants Black", "apparel", "Hosen"],
      ["adidas Argentina 2026 Tiro Jersey White", "apparel", "Shirts"],
    ];
    for (const [title, productType, leaf] of cases) {
      expect(resolveGalaxusProductCategoryPath({ title, productType })).toContain(leaf);
    }
  });
});
