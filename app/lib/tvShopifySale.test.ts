import { describe, expect, it } from "vitest";
import { aaaWarehouseMarginChf, presentShopifyLiveSale, summarizeDbShopifyOrder, type TvCostMatch, type TvLiveLine } from "@/app/lib/tvShopifySale";

const shoe: TvLiveLine = {
  id: "gid://shopify/LineItem/10",
  title: "Nike Dunk Low",
  name: "Nike Dunk Low",
  sku: "DQ8580-100",
  quantity: 1,
  unitPrice: 180,
  imageUrl: "https://cdn.example/dunk.jpg",
  gtin: "0193324840123",
  variantTitle: "EU 42",
};

const protection: TvLiveLine = {
  id: "gid://shopify/LineItem/11",
  title: "Protection du colis",
  name: "Protection du colis",
  sku: "PROT-COLIS",
  quantity: 1,
  unitPrice: 4.9,
  imageUrl: "https://cdn.example/shield.jpg",
  gtin: "",
  variantTitle: null,
};

function match(partial: Partial<TvCostMatch> & Pick<TvCostMatch, "shopifyLineItemId" | "shopifyProductTitle">): TvCostMatch {
  return {
    shopifyOrderName: "#1001",
    shopifySku: null,
    shopifyTotalPrice: 0,
    supplierCost: 0,
    ...partial,
  };
}

describe("presentShopifyLiveSale", () => {
  it("shows the pair, not package protection, even when protection is the first line", () => {
    const sale = presentShopifyLiveSale({
      lines: [protection, shoe],
      matches: [
        match({
          shopifyLineItemId: protection.id,
          shopifyProductTitle: "Protection du colis",
          shopifySku: "PROT-COLIS",
          shopifyTotalPrice: 4.9,
          shopifyLineItemImageUrl: protection.imageUrl,
        }),
      ],
      buyUnitChf: () => 110,
    });

    expect(sale.title).toBe("Nike Dunk Low · EU 42");
    expect(sale.extraItems).toBe(0);
    expect(sale.imageUrl).toBe(shoe.imageUrl);
    expect(sale.marginEstimated).toBe(true);
    expect(sale.marginChf).toBe(74.9);
    expect(sale.refreshGtins).toEqual(["0193324840123"]);
  });

  it("uses the pair COGS once the match exists and keeps protection at full margin", () => {
    const sale = presentShopifyLiveSale({
      lines: [protection, shoe],
      matches: [
        match({
          shopifyLineItemId: "11",
          shopifyProductTitle: "Protection du colis",
          shopifyTotalPrice: 4.9,
        }),
        match({
          shopifyLineItemId: shoe.id,
          shopifyProductTitle: "Nike Dunk Low",
          shopifySku: shoe.sku,
          shopifyTotalPrice: 180,
          supplierCost: 120,
          supplierSource: "STOCKX",
          stockxOrderNumber: "123",
          shopifyLineItemImageUrl: shoe.imageUrl,
        }),
      ],
    });

    expect(sale.title).toContain("Nike Dunk Low");
    expect(sale.marginEstimated).toBe(false);
    expect(sale.marginChf).toBe(64.9);
    expect(sale.refreshGtins).toEqual([]);
  });

  it("treats a physical pair as full margin and does not estimate it", () => {
    const sale = presentShopifyLiveSale({
      lines: [protection, shoe],
      matches: [],
      physicalLineIds: ["10"],
    });
    expect(sale.marginEstimated).toBe(false);
    expect(sale.marginChf).toBe(184.9);
    expect(sale.title).toContain("Dunk");
  });

  it("does not book a loss when the catalog ask is above the sale", () => {
    const sale = presentShopifyLiveSale({
      lines: [{ ...shoe, unitPrice: 77 }],
      matches: [],
      buyUnitChf: () => 228,
    });
    expect(sale.marginEstimated).toBe(true);
    expect(sale.marginChf).toBeCloseTo(77 * 0.2, 2);
  });

  it("counts a second pair, not the protection add-on", () => {
    const cheap: TvLiveLine = { ...shoe, id: "gid://shopify/LineItem/12", title: "Adidas Samba", name: "Adidas Samba", unitPrice: 90, variantTitle: "EU 41" };
    const sale = presentShopifyLiveSale({
      lines: [protection, cheap, shoe],
      matches: [],
      buyUnitChf: () => undefined,
    });
    expect(sale.title).toContain("Nike Dunk Low");
    expect(sale.extraItems).toBe(1);
    expect(sale.marginChf).toBeCloseTo(4.9 + 180 * 0.2 + 90 * 0.2, 2);
  });
});

describe("aaaWarehouseMarginChf", () => {
  it("uses the Essentials buy price and 100% for the other warehouse pairs", () => {
    expect(
      aaaWarehouseMarginChf({ revenue: 59, qty: 1, warehouse: true, fixedUnitCostChf: 26 })
    ).toBe(33);
    expect(aaaWarehouseMarginChf({ revenue: 693, qty: 9, warehouse: true })).toBe(693);
    expect(aaaWarehouseMarginChf({ revenue: 180, qty: 1, warehouse: false })).toBeNull();
  });
});

describe("summarizeDbShopifyOrder", () => {
  it("picks the pair title when protection was stored first", () => {
    const sale = summarizeDbShopifyOrder([
      match({
        shopifyLineItemId: protection.id,
        shopifyProductTitle: "Protection du colis",
        shopifyTotalPrice: 4.9,
        shopifyLineItemImageUrl: protection.imageUrl,
      }),
      match({
        shopifyLineItemId: shoe.id,
        shopifyProductTitle: "Nike Dunk Low",
        shopifySku: shoe.sku,
        shopifySizeEU: "42",
        shopifyTotalPrice: 180,
        supplierCost: 120,
        supplierSource: "STOCKX",
        stockxOrderNumber: "123",
        shopifyLineItemImageUrl: shoe.imageUrl,
      }),
    ]);
    expect(sale?.title).toBe("Nike Dunk Low · EU 42");
    expect(sale?.extraItems).toBe(0);
    expect(sale?.imageUrl).toBe(shoe.imageUrl);
    expect(sale?.salesChf).toBe(184.9);
    expect(sale?.marginChf).toBe(64.9);
    expect(sale?.marginEstimated).toBe(false);
  });
});
