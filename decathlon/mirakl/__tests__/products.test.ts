import { describe, expect, it } from "vitest";
import { __test__ as productsTest } from "../products";

describe("product onboarding helpers", () => {
  it("classifies product status", () => {
    expect(productsTest.classifyProductStatus("LIVE")).toBe("LIVE");
    expect(productsTest.classifyProductStatus("NOT_LIVE")).toBe("NOT_LIVE");
    expect(productsTest.classifyProductStatus("ERROR")).toBe("NOT_LIVE");
    expect(productsTest.classifyProductStatus("")).toBe("UNKNOWN");
  });

  it("extracts required attributes from PM11 payload", () => {
    const payload = [
      { code: "matière principale", requirement_level: "REQUIRED" },
      { code: "optional_attr", requirement_level: "OPTIONAL" },
      { code: "mandatory_attr", required: true },
    ];
    const required = productsTest.extractRequiredAttributes(payload);
    expect(required).toContain("matière principale");
    expect(required).toContain("mandatory_attr");
    expect(required).not.toContain("optional_attr");
  });

  it("parses CM11 CSV and extracts entries", () => {
    const csv = "Product Identifier,Status,codes EAN\nPK_1,LIVE,123\nPK_2,NOT_LIVE,456";
    const entries = productsTest.extractStatusEntries(csv);
    expect(entries[0].productId).toBe("PK_1");
    expect(entries[0].status).toBe("LIVE");
    expect(entries[1].ean).toBe("456");
  });

  it("detects missing attributes by normalized headers", () => {
    const row = {
      "Product Identifier": "PK_1",
      "matière principale": "leather",
    };
    expect(productsTest.isMissingAttribute(row, "product_identifier")).toBe(false);
    expect(productsTest.isMissingAttribute(row, "matière principale")).toBe(false);
    // PM11 codes that do not map to any export column are ignored (cannot validate).
    expect(productsTest.isMissingAttribute(row, "unknown_attr")).toBe(false);
  });

  it("PM11 pre-check only enforces base export columns, not category extras", () => {
    const row: Record<string, string> = {};
    for (const col of [
      "Catégorie",
      "Product Identifier",
      "Product Title en-GB/IE",
      "Product Title it-IT",
      "Product Title fr-CH",
      "Product Title de-CH",
      "Webcatchline en-GB/IE",
      "Description en-GB/IE",
      "Webcatchline it-IT",
      "Description it-IT",
      "Webcatchline fr-CH",
      "Description fr-CH",
      "Webcatchline de-CH",
      "Description de-CH",
      "Main Image",
      "codes EAN",
      "Brand",
      "état",
      "Sports",
      "Genre",
      "Couleur",
      "Sizes for Footwear",
      "Product Natures - Shoes",
    ] as const) {
      row[col] = col === "Brand" ? "" : "ok";
    }
    expect(productsTest.pm11MissingBaseColumns(row, ["Brand", "GPSR - Document (fr_ch)"])).toEqual([
      "Brand",
    ]);
    row["Brand"] = "NIKE";
    row["GPSR - Document (fr_ch)"] = "";
    expect(productsTest.pm11MissingBaseColumns(row, ["Brand", "GPSR - Document (fr_ch)"])).toEqual([]);
  });

  it("maps API-style codes to operator CSV columns", () => {
    const row = {
      "Product Identifier": "PK_1",
      Brand: "X",
      Couleur: "red",
      "matière principale": "synthetic",
    };
    expect(productsTest.isMissingAttribute(row, "MATERIAL")).toBe(false);
    expect(productsTest.isMissingAttribute(row, "BRAND")).toBe(false);
    expect(productsTest.isMissingAttribute(row, "COLOR")).toBe(false);
    const empty = { ...row, Brand: "" };
    expect(productsTest.isMissingAttribute(empty, "brand")).toBe(true);
  });

  it("resolves product status by identifier or EAN", () => {
    const lookup = {
      byProductId: new Map([["PK_1", "LIVE"]]),
      byEan: new Map([["123", "NOT_LIVE"]]),
    };
    expect(productsTest.resolveProductStatus(lookup, "PK_1", "123").classification).toBe("LIVE");
    expect(productsTest.resolveProductStatus(lookup, "PK_2", "123").classification).toBe("NOT_LIVE");
  });
});
