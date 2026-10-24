import { describe, expect, it } from "vitest";
import { sortExpressFirst } from "@/lib/stockxAutoCheckout/shopifyBatchBuy";

type Item = { orderName: string; express: boolean };

describe("sortExpressFirst", () => {
  const isExpress = (i: Item) => i.express;

  it("puts express items first, keeps rest in original order (stable)", () => {
    const items: Item[] = [
      { orderName: "#1", express: false },
      { orderName: "#2", express: true },
      { orderName: "#3", express: false },
      { orderName: "#4", express: true },
      { orderName: "#5", express: false },
    ];
    const { sorted, expressCount } = sortExpressFirst(items, isExpress);
    expect(expressCount).toBe(2);
    expect(sorted.map((i) => i.orderName)).toEqual(["#2", "#4", "#1", "#3", "#5"]);
  });

  it("preserves original order within the express group too", () => {
    const items: Item[] = [
      { orderName: "#a", express: true },
      { orderName: "#b", express: true },
      { orderName: "#c", express: false },
    ];
    const { sorted } = sortExpressFirst(items, isExpress);
    expect(sorted.map((i) => i.orderName)).toEqual(["#a", "#b", "#c"]);
  });

  it("no express → unchanged order, count 0", () => {
    const items: Item[] = [
      { orderName: "#x", express: false },
      { orderName: "#y", express: false },
    ];
    const { sorted, expressCount } = sortExpressFirst(items, isExpress);
    expect(expressCount).toBe(0);
    expect(sorted.map((i) => i.orderName)).toEqual(["#x", "#y"]);
  });

  it("empty input → empty output", () => {
    const { sorted, expressCount } = sortExpressFirst<Item>([], isExpress);
    expect(sorted).toEqual([]);
    expect(expressCount).toBe(0);
  });
});
