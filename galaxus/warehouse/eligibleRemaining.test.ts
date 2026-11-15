import { describe, expect, it } from "vitest";
import { filterOrdersToOpenLines, lineIsOpenForPack } from "@/galaxus/warehouse/eligibleRemaining";

describe("filterOrdersToOpenLines", () => {
  const orders = [
    {
      id: "old",
      lines: [
        { id: "shipped", gtin: "111" },
        { id: "open", gtin: "222" },
      ],
    },
    {
      id: "done",
      lines: [{ id: "done-line", gtin: "333" }],
    },
  ];

  const coverage = {
    shipped: { remaining: 0 },
    open: { remaining: 1 },
    "done-line": { remaining: 0 },
  };

  it("keeps only lines that still have quantity to pack", () => {
    const filtered = filterOrdersToOpenLines(orders, coverage);
    expect(filtered.map((order) => order.id)).toEqual(["old"]);
    expect(filtered[0].lines?.map((line) => line.id)).toEqual(["open"]);
  });

  it("does not mutate the source order line lists", () => {
    filterOrdersToOpenLines(orders, coverage);
    expect(orders[0].lines.map((line) => line.id)).toEqual(["shipped", "open"]);
  });

  it("fails open when coverage is missing or not a number", () => {
    expect(lineIsOpenForPack("missing", {})).toBe(true);
    expect(lineIsOpenForPack("bad", { bad: { remaining: Number.NaN } })).toBe(true);
    expect(lineIsOpenForPack("zero", { zero: { remaining: 0 } })).toBe(false);
  });
});
