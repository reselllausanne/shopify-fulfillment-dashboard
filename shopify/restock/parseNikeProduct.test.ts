import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nikeToProductData, parseNikeHtml } from "./parseNikeProduct";
import { buildNerRows, validateProductFromData } from "./createProductFromData";

const html = readFileSync(join(__dirname, "__fixtures__/nike-pdp-BQ5453-001.html"), "utf8");

describe("parseNikeHtml", () => {
  const p = parseNikeHtml(html);
  it("reads identity", () => {
    expect(p.brand).toBe("Nike");
    expect(p.sku).toBe("BQ5453-001");
    expect(p.name).toContain("Court Borough Low 2");
    expect(p.color).toBe("Schwarz/Schwarz/Schwarz");
    expect(p.images.length).toBeGreaterThan(0);
    expect(p.images[0]).toContain("/t_PDP_1728_v1/");
  });
  it("reads 9 sizes 2C-10C with GTIN and EU label", () => {
    expect(p.sizes).toHaveLength(9);
    expect(p.sizes[0]).toMatchObject({ nikeLabel: "2C", euSize: "17", gtin: "00193145977099" });
    expect(p.sizes[8]).toMatchObject({ nikeLabel: "10C", euSize: "27" });
  });
  it("feeds createProductFromData validation + ner rows", () => {
    const data = nikeToProductData(p, { sellPrice: 29.9, stockByNikeLabel: { "5C": 1, "6C": 2 } });
    expect(validateProductFromData(data)).toEqual([]);
    const rows = buildNerRows(data);
    expect(rows.map((r) => r.sizeRaw)).toEqual(["21", "22"]);
    expect(rows[0].kickdbVariantId).toBe("nike-BQ5453-001-21");
    expect(rows[0].providerKey).toMatch(/^STX_/);
  });
});
