import { describe, expect, it } from "vitest";
import { listOfferedStxSupplierVariantIds, stxOfferedSizesChanged } from "@/galaxus/jobs/stxSync";

function product(variants: Array<{ id: string; asks: number; price?: number }>) {
  return {
    id: "prod-1",
    slug: "nike-air-max-97-cristiano-ronaldo-portugal-patchwork",
    title: "Nike Air Max 97 Cristiano Ronaldo Portugal Patchwork",
    brand: "Nike",
    variants: variants.map((v) => ({
      id: v.id,
      size_eu: "42",
      prices: v.asks > 0 ? [{ type: "standard", price: v.price ?? 242, asks: v.asks }] : [],
    })),
  };
}

describe("listOfferedStxSupplierVariantIds", () => {
  it("lists only sizes with a live ask", () => {
    const ids = listOfferedStxSupplierVariantIds(
      product([
        { id: "a", asks: 1 },
        { id: "b", asks: 0 },
      ]),
      "prod-1"
    );
    expect([...ids]).toEqual(["stx_a"]);
  });
});

describe("stxOfferedSizesChanged", () => {
  it("flags a size whose last ask disappeared", () => {
    const before = product([
      { id: "a", asks: 1 },
      { id: "b", asks: 2 },
    ]);
    const after = product([
      { id: "a", asks: 0 },
      { id: "b", asks: 2 },
    ]);
    expect(stxOfferedSizesChanged(before, after, "prod-1")).toBe(true);
  });

  it("flags a size that came back", () => {
    const before = product([{ id: "a", asks: 0 }]);
    const after = product([{ id: "a", asks: 3 }]);
    expect(stxOfferedSizesChanged(before, after, "prod-1")).toBe(true);
  });

  it("ignores price-only moves on the same sizes", () => {
    const before = product([{ id: "a", asks: 1, price: 242 }]);
    const after = product([{ id: "a", asks: 4, price: 260 }]);
    expect(stxOfferedSizesChanged(before, after, "prod-1")).toBe(false);
  });

  it("treats a missing previous payload as changed", () => {
    expect(stxOfferedSizesChanged(null, product([{ id: "a", asks: 1 }]), "prod-1")).toBe(true);
  });
});
