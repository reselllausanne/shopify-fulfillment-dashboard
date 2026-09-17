import { describe, expect, it } from "vitest";
import {
  buildGalaxusGtinLineLookupWhere,
  buildGtinSupplierPidLookupCandidates,
  expandGtinCrossFormatKeys,
  expandGtinLookupCandidates,
  selectGalaxusGtinLinesForScan,
} from "@/app/api/scan-awb/gtinFallback";

describe("expandGtinLookupCandidates", () => {
  it("adds common GTIN padding forms", () => {
    const expanded = expandGtinLookupCandidates(["197634784625"]);
    expect(expanded).toContain("197634784625");
    expect(expanded.some((g) => g.length === 13 || g.length === 14)).toBe(true);
  });

  it("keeps padded forms from expandGtinsForDbLookup", () => {
    const expanded = expandGtinLookupCandidates(["058075270008"]);
    expect(expanded).toContain("058075270008");
    expect(expanded).toContain("58075270008");
  });
});

describe("expandGtinCrossFormatKeys", () => {
  it("maps Osram UPC scan to EAN-13 catalog key", () => {
    const expanded = expandGtinCrossFormatKeys(["058075270008"]);
    expect(expanded).toContain("4058075270008");
  });
});

describe("buildGtinSupplierPidLookupCandidates", () => {
  it("includes REI and STX supplier pid forms", () => {
    const keys = buildGtinSupplierPidLookupCandidates(
      expandGtinCrossFormatKeys(["058075270008"])
    );
    expect(keys).toContain("REI_4058075270008");
    expect(keys).toContain("STX_4058075270008");
  });
});

describe("buildGalaxusGtinLineLookupWhere", () => {
  it("matches gtin and REI supplier pid columns", () => {
    const where = buildGalaxusGtinLineLookupWhere(["4058075270008"]);
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { gtin: { in: ["4058075270008"] } },
        {
          supplierPid: {
            in: expect.arrayContaining(["REI_4058075270008"]),
          },
        },
      ])
    );
  });
});

describe("selectGalaxusGtinLinesForScan", () => {
  it("includes open sibling STX lines on the same direct order", () => {
    const included = selectGalaxusGtinLinesForScan({
      matchingLineIds: new Set(["tazz-line"]),
      orderLines: [
        { id: "tazz-line", remaining: 1 },
        { id: "mary-jane-line", remaining: 1 },
      ],
      isDirectDelivery: true,
      isDirectStxLine: (line) => line.id === "tazz-line" || line.id === "mary-jane-line",
    });
    expect(Array.from(included).sort()).toEqual(["mary-jane-line", "tazz-line"]);
  });

  it("skips closed sibling lines", () => {
    const included = selectGalaxusGtinLinesForScan({
      matchingLineIds: new Set(["tazz-line"]),
      orderLines: [
        { id: "tazz-line", remaining: 0 },
        { id: "mary-jane-line", remaining: 1 },
      ],
      isDirectDelivery: true,
      isDirectStxLine: () => true,
    });
    expect(Array.from(included)).toEqual(["tazz-line", "mary-jane-line"]);
  });

  it("does not expand warehouse orders", () => {
    const included = selectGalaxusGtinLinesForScan({
      matchingLineIds: new Set(["line-a"]),
      orderLines: [
        { id: "line-a", remaining: 1 },
        { id: "line-b", remaining: 1 },
      ],
      isDirectDelivery: false,
      isDirectStxLine: () => true,
    });
    expect(Array.from(included)).toEqual(["line-a"]);
  });
});
