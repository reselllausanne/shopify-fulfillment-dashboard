import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/shopifyAdmin", () => ({ shopifyGraphQL: vi.fn() }));

import { shopifyGraphQL } from "@/lib/shopifyAdmin";

import {
  applyStxStockChanges,
  decideStxStock,
  emptyStxStockStats,
  liveVariantsFromPayload,
  matchLiveStxVariant,
  MAX_QUANTITIES_PER_SET,
  normSize,
  planStxStockChanges,
  type StxShopifyVariant,
} from "./stxStockShopify";

const sizes = (...entries: Array<[string, string]>) => entries.map(([type, size]) => ({ type, size }));

describe("normSize", () => {
  it("strips system / gender prefixes and parenthesised hints", () => {
    expect(normSize("EU 37 1/3")).toBe("37 1/3");
    expect(normSize("US M 7")).toBe("7");
    expect(normSize("UK 6 (EU 40)")).toBe("6");
    expect(normSize("7,5")).toBe("7.5");
  });
});

describe("matchLiveStxVariant", () => {
  it("does not confuse US men's with US women's of another size", () => {
    const live = liveVariantsFromPayload({
      variants: [
        { size: "7", sizes: sizes(["us m", "US M 7"], ["eu", "EU 40"], ["us w", "US W 8.5"]), prices: [{ asks: 4 }] },
        { size: "5.5", sizes: sizes(["us m", "US M 5.5"], ["eu", "EU 38"], ["us w", "US W 7"]), prices: [] },
      ],
    });
    const hit = matchLiveStxVariant({ title: "40", barcode: null, usSize: { value: "7" } }, live);
    expect(hit?.asks).toBe(4);
  });

  it("matches US-titled products on the StockX primary size", () => {
    const live = liveVariantsFromPayload({
      variants: [
        { size: "7", sizes: sizes(["us m", "US M 7"]), prices: [{ asks: 0 }] },
        { size: "8", sizes: sizes(["us m", "US M 8"]), prices: [{ asks: 2 }] },
      ],
    });
    expect(matchLiveStxVariant({ title: "7", barcode: null, usSize: { value: "7" } }, live)?.asks).toBe(0);
  });

  it("matches kids sizes by EU title", () => {
    const live = liveVariantsFromPayload({
      variants: [
        { size: "4C", sizes: sizes(["us", "US 4C"], ["eu", "EU 19.5"]), prices: [{ asks: 6 }] },
        { size: "5C", sizes: sizes(["us", "US 5C"], ["eu", "EU 21"]), prices: [] },
      ],
    });
    expect(matchLiveStxVariant({ title: "21", barcode: null, usSize: { value: "5C" } }, live)?.asks).toBe(0);
  });

  it("prefers barcode and returns null when ambiguous", () => {
    const live = liveVariantsFromPayload({
      variants: [
        { size: "S", identifiers: [{ identifier_type: "UPC", identifier: "195394769098" }], prices: [{ asks: 1 }] },
        { size: "S", prices: [] },
      ],
    });
    expect(matchLiveStxVariant({ title: "S", barcode: "195394769098", usSize: null }, live)?.asks).toBe(1);
    expect(matchLiveStxVariant({ title: "S", barcode: null, usSize: null }, live)).toBeNull();
  });
});

describe("decideStxStock", () => {
  const PRODUCT = "gid://shopify/Product/1";
  const live = liveVariantsFromPayload({
    variants: [
      { size: "7", sizes: sizes(["us m", "US M 7"], ["eu", "EU 40"]), prices: [{ asks: 1 }] },
      { size: "8", sizes: sizes(["us m", "US M 8"], ["eu", "EU 41"]), prices: [{ asks: 0 }] },
    ],
  });
  const variant = (title: string, qty: number | null, extra: Partial<StxShopifyVariant> = {}): StxShopifyVariant => ({
    id: `gid://shopify/ProductVariant/${title}`,
    title,
    price: "241.00",
    barcode: null,
    usSize: null,
    inventoryItem: {
      id: `gid://shopify/InventoryItem/${title}`,
      inventoryLevel: qty === null ? null : { quantities: [{ quantity: qty }] },
    },
    ...extra,
  });

  it("restores a 0-stock size that has asks again", () => {
    expect(decideStxStock(variant("40", 0), live, PRODUCT)).toEqual({ action: "restore", from: 0, to: 1 });
  });

  it("zeroes an in-stock size with no asks", () => {
    expect(decideStxStock(variant("41", 1), live, PRODUCT)).toEqual({ action: "zero", from: 1, to: 0 });
  });

  it("leaves sizes already in sync or not stocked online", () => {
    expect(decideStxStock(variant("40", 2), live, PRODUCT)).toEqual({ action: "skip", reason: "inSync" });
    expect(decideStxStock(variant("41", 0), live, PRODUCT)).toEqual({ action: "skip", reason: "inSync" });
    expect(decideStxStock(variant("40", null), live, PRODUCT)).toEqual({ action: "skip", reason: "notStocked" });
  });

  it("never restores price-locked, unpriced or negative-stock sizes", () => {
    const locked = variant("40", 0, { priceLocked: { value: "true" } });
    expect(decideStxStock(locked, live, PRODUCT)).toEqual({ action: "skip", reason: "locked" });
    expect(decideStxStock(variant("40", 0, { price: "0.00" }), live, PRODUCT)).toEqual({
      action: "skip",
      reason: "noPrice",
    });
    expect(decideStxStock(variant("40", -1), live, PRODUCT)).toEqual({ action: "skip", reason: "inSync" });
  });

  it("does not restore a size whose Shopify price is under the live ask", () => {
    const priced = liveVariantsFromPayload({
      variants: [{ size: "7", sizes: sizes(["eu", "EU 40"]), prices: [{ asks: 1, price: 117 }] }],
    });
    expect(decideStxStock(variant("40", 0, { price: "99.00" }), priced, PRODUCT)).toEqual({
      action: "skip",
      reason: "underpriced",
    });
    expect(decideStxStock(variant("40", 0), priced, PRODUCT)).toEqual({ action: "restore", from: 0, to: 1 });
  });

  it("zeroes every stocked size of a delisted product", () => {
    expect(decideStxStock(variant("40", 1), null, PRODUCT)).toEqual({ action: "zero", from: 1, to: 0 });
  });

  it("plans changes without API calls and counts skips", () => {
    const stats = emptyStxStockStats();
    const changes = planStxStockChanges(
      [variant("40", 0), variant("41", 1), variant("40", 2), variant("40", null)],
      live,
      PRODUCT,
      stats
    );
    expect(changes.map((c) => [c.node.title, c.action, c.productGid])).toEqual([
      ["40", "restore", PRODUCT],
      ["41", "zero", PRODUCT],
    ]);
    expect(stats.inSync).toBe(1);
    expect(stats.notStocked).toBe(1);
    expect(vi.mocked(shopifyGraphQL)).not.toHaveBeenCalled();
  });

  it("applies changes of several products in one compare-and-set call", async () => {
    vi.mocked(shopifyGraphQL).mockResolvedValueOnce({
      data: { inventorySetQuantities: { userErrors: [] } },
    } as any);
    const stats = emptyStxStockStats();
    const a = planStxStockChanges([variant("40", 0)], live, "gid://shopify/Product/A", stats);
    const b = planStxStockChanges([variant("41", 1)], live, "gid://shopify/Product/B", stats);
    await applyStxStockChanges([...a, ...b]);
    expect(vi.mocked(shopifyGraphQL)).toHaveBeenCalledTimes(1);
    const vars = vi.mocked(shopifyGraphQL).mock.calls[0]![1] as any;
    expect(vars.input.quantities).toHaveLength(2);
    expect(vars.input.quantities[1]).toMatchObject({ quantity: 0, changeFromQuantity: 1 });
  });

  it("refuses batches above the Shopify per-call quantity cap", async () => {
    const big = Array.from({ length: MAX_QUANTITIES_PER_SET + 1 }, () => ({
      productGid: PRODUCT,
      node: variant("40", 0),
      action: "restore" as const,
      from: 0,
      to: 1,
    }));
    await expect(applyStxStockChanges(big)).rejects.toThrow(/quantities/);
  });
});
