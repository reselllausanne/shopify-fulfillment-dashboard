import { describe, expect, it } from "vitest";
import { normalizeSizeKey, stripStxPrefix } from "@/shopify/orders/resolveStockxVariant";

describe("normalizeSizeKey", () => {
  it("strips EU prefix and whitespace", () => {
    expect(normalizeSizeKey("EU 42")).toBe("42");
    expect(normalizeSizeKey("42.5")).toBe("42.5");
    expect(normalizeSizeKey("42,5")).toBe("42.5");
  });
});

describe("stripStxPrefix", () => {
  it("returns raw StockX variant id", () => {
    expect(stripStxPrefix("stx_abc123")).toBe("abc123");
    expect(stripStxPrefix("abc123")).toBe("abc123");
    expect(stripStxPrefix("")).toBeNull();
  });
});
