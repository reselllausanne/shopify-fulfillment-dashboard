import { describe, expect, it } from "vitest";
import {
  buildCatalogSearchSql,
  canUseNameSearch,
  catalogTokenMatches,
  normalizeCatalogSearchText,
  parseCatalogSearchTokens,
} from "@/app/lib/catalogSearch";

function matchesName(q: string, name: string): boolean {
  const doc = normalizeCatalogSearchText(name);
  return parseCatalogSearchTokens(q).every((t) => catalogTokenMatches(doc, t));
}

describe("parseCatalogSearchTokens", () => {
  it("splits words, lowercases, drops MHz unit", () => {
    expect(parseCatalogSearchTokens("2gb DDR3 1333mhz")).toEqual(["2gb", "ddr3", "1333"]);
  });

  it("keeps dashed words glued like the index does", () => {
    expect(parseCatalogSearchTokens("DDR3-1333")).toEqual(["ddr31333"]);
  });

  it("drops words already contained in a longer word", () => {
    expect(parseCatalogSearchTokens("ddr3 ddr3-1333")).toEqual(["ddr31333"]);
  });

  it("empty input gives no tokens", () => {
    expect(parseCatalogSearchTokens("  - ")).toEqual([]);
  });
});

describe("word matching against real shop names", () => {
  const q = "2gb ddr3 1333mhz";
  it.each([
    "CSX CSX 2GB DDR3-1333MHz DIMM",
    "CSX CSX 2GB DDR3-1333MHz SODIMM",
    "NONAME 2 GB DDR3 1333 CL9 Marke",
  ])("matches %s", (name) => {
    expect(matchesName(q, name)).toBe(true);
  });

  it("does not match 4GB module", () => {
    expect(matchesName(q, "Kingston 4GB DDR3-1600 DIMM")).toBe(false);
  });

  it("does not match 32 GB when searching 2gb", () => {
    expect(matchesName(q, "DIMM 32 GB DDR3-1333 ECC, für MAC")).toBe(false);
  });

  it("still matches the 2x 2 GB kit", () => {
    expect(matchesName(q, "DIMM 4 GB DDR3-1333 (2x 2 GB) Dual-Kit")).toBe(true);
  });
});

describe("buildCatalogSearchSql", () => {
  it("returns null for empty query", () => {
    expect(buildCatalogSearchSql("   ", { limit: 10 })).toBeNull();
  });

  it("skips name scan when every word is shorter than 3 chars", () => {
    expect(canUseNameSearch(["4k", "2"])).toBe(false);
    const sql = buildCatalogSearchSql("4k 2", { limit: 10 })!;
    expect(sql.sql).not.toContain("LIKE $");
  });

  it("adds GTIN variants for barcode input", () => {
    const sql = buildCatalogSearchSql("04250312501726", { limit: 10 })!;
    expect(sql.values).toContain("4250312501726");
    expect(sql.values).toContain("04250312501726");
  });
});
