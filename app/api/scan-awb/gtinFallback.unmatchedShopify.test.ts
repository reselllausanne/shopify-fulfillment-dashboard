import { describe, expect, it } from "vitest";
import {
  classifyDiscoveredGtinLines,
  pickGtinAutoRow,
  type GtinOrderRow,
} from "./gtinFallback";

const line = (id: string, sku: string, size: string | null, createdAt = "2026-09-10T00:00:00Z") => ({
  shopifyOrderId: `o-${id}`,
  shopifyOrderName: `#${id}`,
  shopifyLineItemId: id,
  shopifySku: sku,
  shopifySizeEU: size,
  shopifyProductTitle: "Samba OG",
  shopifyCreatedAt: createdAt,
  remainingQuantity: 1,
});

describe("classifyDiscoveredGtinLines (GTIN scan, no OrderMatch)", () => {
  it("per-variant SKU from GTIN implies the size", () => {
    const out = classifyDiscoveredGtinLines([line("a", "B75806-42", "42")], {
      exactSkus: new Set(["B75806-42"]),
      sharedSkus: new Set(),
      styleSkus: new Set(),
      scannedSizes: ["42"],
    });
    expect(out.map((l) => [l.shopifyLineItemId, l.sizeUnverified])).toEqual([["a", false]]);
  });

  it("shared SKU across sizes keeps only the scanned size", () => {
    const out = classifyDiscoveredGtinLines(
      [line("a", "3ME10101430", "EU 40.5"), line("b", "3ME10101430", "43")],
      {
        exactSkus: new Set(["3ME10101430"]),
        sharedSkus: new Set(["3ME10101430"]),
        styleSkus: new Set(),
        scannedSizes: ["40.5"],
      }
    );
    expect(out.map((l) => l.shopifyLineItemId)).toEqual(["a"]);
  });

  it("catalog style SKU reaches BASE-size Shopify lines, size-checked", () => {
    const out = classifyDiscoveredGtinLines(
      [line("a", "B75806-42", null), line("b", "B75806-43", null), line("c", "OTHER-42", "42")],
      {
        exactSkus: new Set(),
        sharedSkus: new Set(["B75806"]),
        styleSkus: new Set(["B75806"]),
        scannedSizes: ["42"],
      }
    );
    expect(out.map((l) => l.shopifyLineItemId)).toEqual(["a"]);
  });

  it("unknown scanned size → kept but unverified (never auto)", () => {
    const out = classifyDiscoveredGtinLines([line("a", "3ME10101430", "43")], {
      exactSkus: new Set(["3ME10101430"]),
      sharedSkus: new Set(["3ME10101430"]),
      styleSkus: new Set(),
      scannedSizes: [],
    });
    expect(out.map((l) => l.sizeUnverified)).toEqual([true]);
  });
});

const row = (over: Partial<GtinOrderRow>): GtinOrderRow => ({
  channel: "shopify",
  lineId: "x",
  lineNumber: null,
  productName: null,
  quantity: 1,
  ordered: 1,
  shipped: 0,
  reserved: 0,
  remaining: 1,
  warehouseMarkedShippedAt: null,
  orderDate: "2026-09-10T00:00:00.000Z",
  orderNumber: null,
  cancelledAt: null,
  recipient: { name: null, city: null, postalCode: null, countryCode: null },
  shopifyOrderId: "o",
  shopifyLineItemId: "li",
  ...over,
});

describe("pickGtinAutoRow FIFO with unlinked Shopify orders", () => {
  it("older unlinked order blocks auto on a newer linked one", () => {
    const older = row({ lineId: "old", shopifyLineItemId: "old", shopifyNeedsLink: true, orderDate: "2026-09-01T00:00:00.000Z" });
    const newer = row({ lineId: "new", shopifyLineItemId: "new", orderDate: "2026-09-05T00:00:00.000Z" });
    expect(pickGtinAutoRow([older, newer])).toBeNull();
  });

  it("unlinked order alone is never auto", () => {
    expect(pickGtinAutoRow([row({ shopifyNeedsLink: true })])).toBeNull();
  });

  it("linked oldest order still auto-fulfills", () => {
    const linked = row({ lineId: "a", orderDate: "2026-09-01T00:00:00.000Z" });
    const unlinked = row({ lineId: "b", shopifyNeedsLink: true, orderDate: "2026-09-05T00:00:00.000Z" });
    expect(pickGtinAutoRow([linked, unlinked])?.lineId).toBe("a");
  });

  it("size-unverified unlinked row does not block", () => {
    const unverified = row({ lineId: "u", shopifyNeedsLink: true, shopifySizeUnverified: true, orderDate: "2026-09-01T00:00:00.000Z" });
    const linked = row({ lineId: "a", orderDate: "2026-09-05T00:00:00.000Z" });
    expect(pickGtinAutoRow([unverified, linked])?.lineId).toBe("a");
  });
});
