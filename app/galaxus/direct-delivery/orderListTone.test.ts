import { describe, expect, it } from "vitest";
import { orderListCardClass, orderListFullyLinked, orderListNeedsLink } from "./orderListTone";

const card = (linked: number, lines: number) => ({
  linkedCount: linked,
  _count: { lines },
});

describe("direct delivery order list tone", () => {
  it("paints 0/1 red even when needsBuyCount is 0", () => {
    const order = { ...card(0, 1), needsBuyCount: 0 };
    expect(orderListNeedsLink(order)).toBe(true);
    expect(orderListFullyLinked(order)).toBe(false);
    expect(orderListCardClass(order, false)).toContain("bg-red-200");
    expect(orderListCardClass(order, false)).not.toContain("emerald");
  });

  it("paints a full link green", () => {
    const order = card(1, 1);
    expect(orderListFullyLinked(order)).toBe(true);
    expect(orderListCardClass(order, false)).toContain("bg-green-200");
  });

  it("keeps a partial link red", () => {
    expect(orderListCardClass(card(1, 2), false)).toContain("bg-red-200");
  });

  it("adds the selection ring without dropping the link color", () => {
    const cls = orderListCardClass(card(0, 1), true);
    expect(cls).toContain("bg-red-200");
    expect(cls).toContain("ring-black");
  });
});
