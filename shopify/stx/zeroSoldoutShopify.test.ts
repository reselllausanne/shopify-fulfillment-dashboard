import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/shopifyAdmin", () => ({ shopifyGraphQL: vi.fn() }));

import { liveVariantsFromPayload, matchLiveStxVariant, normSize } from "./zeroSoldoutShopify";

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
