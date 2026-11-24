import { describe, expect, it } from "vitest";
import {
  findUnitScanShortfall,
  parseUnitScans,
  validateUnitScansForLines,
} from "@/galaxus/warehouse/unitScans";

const line = { lineId: "L1", sourceOrderId: "O1", quantity: 2, gtin: "0194123456789" };
const scan = (unitIndex: number, extra: Record<string, unknown> = {}) => ({
  sourceOrderId: "O1",
  lineId: "L1",
  unitIndex,
  gtin: "194123456789",
  source: "warehouse_page",
  ...extra,
});

describe("validateUnitScansForLines", () => {
  it("rejects no scans", () => {
    expect(validateUnitScansForLines([line], []).ok).toBe(false);
  });
  it("rejects fewer scans than qty", () => {
    expect(validateUnitScansForLines([line], [scan(0)]).ok).toBe(false);
  });
  it("rejects duplicate unitIndex", () => {
    expect(validateUnitScansForLines([line], [scan(0), scan(0)]).ok).toBe(false);
  });
  it("rejects wrong gtin", () => {
    expect(validateUnitScansForLines([line], [scan(0), scan(1, { gtin: "999" })]).ok).toBe(false);
  });
  it("rejects empty gtin from page source", () => {
    expect(validateUnitScansForLines([line], [scan(0), scan(1, { gtin: "" })]).ok).toBe(false);
  });
  it("accepts per-unit scans", () => {
    const r = validateUnitScansForLines([line], [scan(0), scan(1)]);
    expect(r.ok && r.rows.length).toBe(2);
  });
  it("accepts packing_session entries without gtin", () => {
    const r = validateUnitScansForLines(
      [line],
      [scan(0, { gtin: null, source: "packing_session" }), scan(1, { gtin: null, source: "packing_session" })]
    );
    expect(r.ok).toBe(true);
  });
});

describe("findUnitScanShortfall", () => {
  const items = [{ orderId: "O1", gtin14: "0194123456789", quantity: 2 }];
  const stored = (i: number) => ({ orderId: "O1", gtin: "194123456789", galaxusOrderLineId: "L1", unitIndex: i });
  it("flags shortfall", () => {
    expect(findUnitScanShortfall(items, [stored(0)])).toMatch(/1\/2/);
  });
  it("passes when covered", () => {
    expect(findUnitScanShortfall(items, [stored(0), stored(1)])).toBeNull();
  });
});

describe("parseUnitScans", () => {
  it("drops junk", () => {
    expect(parseUnitScans([{ lineId: "a" }, null, "x"])).toEqual([]);
    expect(parseUnitScans(undefined)).toEqual([]);
  });
});
