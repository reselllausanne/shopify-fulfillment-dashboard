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

import { fetchStockxProductByIdOrSlugRaw } from "@/galaxus/kickdb/client";
import { resolvePhysicalRestockPricing } from "@/shopify/restock/physicalRestockPricing";

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
    expect(pricing.compareAt).toBeGreaterThan(0);
    expect(pricing.sellPrice).toBeGreaterThan(0);
    expect(pricing.sellPrice!).toBeLessThan(pricing.compareAt!);
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
  });
});
