import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    kickDBVariant: { findFirst: vi.fn().mockResolvedValue(null) },
    supplierVariant: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}));

vi.mock("@/shopify/restock/resolveKickdbSlugForGtin", () => ({
  resolveKickdbSlugForGtin: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/galaxus/kickdb/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/galaxus/kickdb/client")>();
  return {
    ...actual,
    fetchStockxProductByIdOrSlugRaw: vi.fn(),
  };
});

import { prisma } from "@/app/lib/prisma";
import { estimatedStockxBuyChfFromList } from "@/galaxus/stx/chfStockxBuyPrice";
import { stxSourceCostChfFromRaw } from "@/shopify/pricing/calcShopifySellPrice";
import { fetchStockxProductByIdOrSlugRaw } from "@/galaxus/kickdb/client";
import {
  resolvePhysicalRestockPricing,
  warehouseHalfBuyNowPrice,
} from "@/shopify/restock/physicalRestockPricing";

const mockedFetch = fetchStockxProductByIdOrSlugRaw as unknown as ReturnType<typeof vi.fn>;

const SCANNED_GTIN = "4550330121471";

/** KickDB live product where variants have asks but NO barcode identifiers. */
function liveProductNoGtins() {
  return {
    product: {
      id: "kickdb-prod-onitsuka",
      slug: "onitsuka-tiger-mexico-66-yellow",
      title: "Onitsuka Tiger Mexico 66 Yellow",
      brand: "Onitsuka Tiger",
      variants: [
        { id: "v36", size_eu: "36", lowest_ask: 95 },
        { id: "v375", size_eu: "37.5", lowest_ask: 120 },
        { id: "v38", size_eu: "38", lowest_ask: 101 },
      ],
    },
  };
}

describe("warehouseHalfBuyNowPrice", () => {
  it("floors half the Buy Now ask to 0.50 CHF", () => {
    expect(warehouseHalfBuyNowPrice(217)).toBe(108.5);
    expect(warehouseHalfBuyNowPrice(200)).toBe(100);
    expect(warehouseHalfBuyNowPrice(99)).toBe(49.5);
    expect(warehouseHalfBuyNowPrice(100.4)).toBe(50);
    expect(warehouseHalfBuyNowPrice(1)).toBe(0.5);
  });

  it("halves the after-fees Buy Now, 0.50 floor", () => {
    expect(warehouseHalfBuyNowPrice(76.81)).toBe(38);
    expect(warehouseHalfBuyNowPrice(96.13)).toBe(48);
  });

  it("skips a non-positive result", () => {
    expect(warehouseHalfBuyNowPrice(0)).toBeNull();
    expect(warehouseHalfBuyNowPrice(0.4)).toBeNull();
    expect(warehouseHalfBuyNowPrice(Number.NaN)).toBeNull();
  });
});

describe("resolvePhysicalRestockPricing — slug + EU size fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetch.mockResolvedValue(liveProductNoGtins());
  });

  it("resolves liquidation pricing from slug + sizeEu when KickDB has no GTIN", async () => {
    const pricing = await resolvePhysicalRestockPricing(SCANNED_GTIN, {
      slug: "onitsuka-tiger-mexico-66-yellow",
      sizeEu: "37.5",
    });

    expect(pricing.source).toBe("kickdb-live-size");
    expect(pricing.stockxRaw).toBe(120);
    // 120 × STX multiplier + 20 CHF, never the raw 120.
    const afterFees = Math.round(stxSourceCostChfFromRaw(120) * 100) / 100;
    expect(afterFees).toBeGreaterThan(120);
    expect(pricing.buyNowAfterFees).toBe(afterFees);
    expect(pricing.compareAt).toBe(afterFees);
    expect(pricing.cost).toBe(afterFees);
    expect(pricing.sellPrice).toBe(warehouseHalfBuyNowPrice(afterFees));
    expect(pricing.sellPrice).not.toBe(60);
    expect(pricing.siteSellPrice).toBeGreaterThan(120);
  });

  it("returns none without sizeEu when GTIN matches nothing on KickDB", async () => {
    const pricing = await resolvePhysicalRestockPricing(SCANNED_GTIN, {
      slug: "onitsuka-tiger-mexico-66-yellow",
    });

    expect(pricing.source).toBe("none");
    expect(pricing.sellPrice).toBeNull();
    expect(pricing.compareAt).toBeNull();
  });

  it("returns none when neither slug nor DB context exists", async () => {
    mockedFetch.mockRejectedValue(new Error("no slug"));
    const pricing = await resolvePhysicalRestockPricing(SCANNED_GTIN, {});

    expect(pricing.source).toBe("none");
    expect(pricing.sellPrice).toBeNull();
  });

  it("still prefers the GTIN match when KickDB has the barcode", async () => {
    mockedFetch.mockResolvedValue({
      product: {
        slug: "onitsuka-tiger-mexico-66-yellow",
        title: "Onitsuka Tiger Mexico 66 Yellow",
        brand: "Onitsuka Tiger",
        variants: [
          { id: "v375", size_eu: "37.5", gtin: SCANNED_GTIN, lowest_ask: 130 },
          { id: "v38", size_eu: "38", lowest_ask: 90 },
        ],
      },
    });

    const pricing = await resolvePhysicalRestockPricing(SCANNED_GTIN, {
      slug: "onitsuka-tiger-mexico-66-yellow",
      sizeEu: "38",
    });

    expect(pricing.source).toBe("kickdb-live");
    expect(pricing.stockxRaw).toBe(130);
    const afterFees = Math.round(stxSourceCostChfFromRaw(130) * 100) / 100;
    expect(pricing.compareAt).toBe(afterFees);
    expect(pricing.sellPrice).toBe(warehouseHalfBuyNowPrice(afterFees));
  });

  it("recalculates from KickDB on every call; stored stx price does not win", async () => {
    const stored = estimatedStockxBuyChfFromList(200, 20);
    (prisma.kickDBVariant.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      product: { urlKey: "air-jordan-1", name: "Air Jordan 1", brand: "Nike" },
    });
    (prisma.supplierVariant.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      price: stored,
      supplierProductName: "Air Jordan 1",
      deliveryType: null,
      supplierBrand: "Nike",
    });
    mockedFetch.mockResolvedValue({
      product: {
        slug: "air-jordan-1",
        title: "Air Jordan 1",
        brand: "Nike",
        variants: [{ id: "v", gtin: SCANNED_GTIN, lowest_ask: 999 }],
      },
    });

    const pricing = await resolvePhysicalRestockPricing(SCANNED_GTIN, {
      slug: "air-jordan-1",
      sizeEu: "42",
    });

    const afterFees = Math.round(stxSourceCostChfFromRaw(999) * 100) / 100;
    expect(pricing.source).toBe("kickdb-live");
    expect(pricing.stockxRaw).toBe(999);
    expect(pricing.storedBuyPrice).toBe(stored);
    expect(pricing.buyNowAfterFees).toBe(afterFees);
    expect(pricing.compareAt).toBe(afterFees);
    expect(pricing.compareAt).not.toBe(stored);
    expect(pricing.sellPrice).toBe(warehouseHalfBuyNowPrice(afterFees));
    expect(mockedFetch).toHaveBeenCalled();
  });

  it("falls back to stored landed price when KickDB returns no ask", async () => {
    const stored = 90.82;
    (prisma.supplierVariant.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      price: stored,
      supplierProductName: "Pair",
      deliveryType: null,
      supplierBrand: "Nike",
    });
    mockedFetch.mockResolvedValue({
      product: { slug: "pair", title: "Pair", variants: [] },
    });

    const pricing = await resolvePhysicalRestockPricing(SCANNED_GTIN, {
      slug: "pair",
      sizeEu: "40",
    });

    expect(pricing.source).toBe("stx-db");
    expect(pricing.stockxRaw).toBeNull();
    expect(pricing.compareAt).toBe(stored);
    expect(pricing.sellPrice).toBe(warehouseHalfBuyNowPrice(stored));
  });

  it("EU 40: live KickDB ask after fees, half, stale stored ignored", async () => {
    for (const [raw, stored] of [
      [51, 90.82],
      [70, 96.35],
    ] as const) {
      (prisma.supplierVariant.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        price: stored,
        supplierProductName: "Pair",
        deliveryType: null,
        supplierBrand: "Nike",
      });
      mockedFetch.mockResolvedValueOnce({
        product: {
          slug: "pair",
          title: "Pair",
          brand: "Nike",
          variants: [{ id: "v40", size_eu: "40", gtin: SCANNED_GTIN, lowest_ask: raw }],
        },
      });

      const pricing = await resolvePhysicalRestockPricing(SCANNED_GTIN, {
        slug: "pair",
        sizeEu: "40",
      });
      const afterFees = Math.round(stxSourceCostChfFromRaw(raw) * 100) / 100;
      expect(pricing.source).toBe("kickdb-live");
      expect(pricing.stockxRaw).toBe(raw);
      expect(pricing.storedBuyPrice).toBe(stored);
      expect(pricing.compareAt).toBe(afterFees);
      expect(pricing.sellPrice).toBe(warehouseHalfBuyNowPrice(afterFees));
    }
  });
});
