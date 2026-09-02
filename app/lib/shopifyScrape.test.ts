import { describe, expect, it } from "vitest";
import {
  collectEligibleRecords,
  isShopifyPreorderSignal,
  resolveShopifyAvailable,
  resolveShopifyInventoryQty,
} from "@/app/lib/shopifyScrape";
import type { ScraperShop } from "@/app/lib/scraperShops";

const shop: ScraperShop = {
  key: "wel",
  code: "WEL",
  name: "WellPlayed",
  baseUrl: "https://www.wellplayed.ch",
  currency: "CHF",
  platform: "shopify",
  gated: false,
};

/** Mirrors wellplayed ultimate-railroads-de: available true, qty 0, continue. */
const oosContinueListVariant = {
  id: 41561226805423,
  title: "Default Title",
  price: "105.00",
  sku: "HIGD1014",
  barcode: "4015566018532",
  available: true,
};

const oosContinueJsVariant = {
  id: 41561226805423,
  title: "Default Title",
  price: 10500,
  sku: "HIGD1014",
  barcode: "4015566018532",
  available: true,
  inventory_quantity: 0,
  inventory_management: "shopify",
  inventory_policy: "continue",
};

describe("resolveShopifyAvailable", () => {
  it("treats continue-policy OOS (available:true, qty:0) as not sellable", () => {
    expect(
      resolveShopifyAvailable(
        { title: "Ultimate Railroads (DE)", tags: "language_German" },
        { title: "Ultimate Railroads (DE)", tags: ["language_German"], variants: [oosContinueJsVariant] },
        oosContinueListVariant,
        oosContinueJsVariant
      )
    ).toBe(false);
  });

  it("treats tracked inventory with qty>0 as sellable", () => {
    const jsV = { ...oosContinueJsVariant, inventory_quantity: 3 };
    expect(resolveShopifyAvailable({}, { variants: [jsV] }, oosContinueListVariant, jsV)).toBe(true);
  });

  it("treats available:false as not sellable", () => {
    const jsV = {
      ...oosContinueJsVariant,
      available: false,
      inventory_quantity: 0,
      inventory_policy: "deny",
    };
    expect(resolveShopifyAvailable({}, {}, { ...oosContinueListVariant, available: false }, jsV)).toBe(
      false
    );
  });

  it("does not invent stock when tracked qty missing (list-only / .js failed)", () => {
    expect(
      resolveShopifyAvailable(
        {},
        null,
        { ...oosContinueListVariant, available: true },
        {}
      )
    ).toBe(false);
  });

  it("can trust available when qty hidden (Warenkontor-style)", () => {
    expect(
      resolveShopifyAvailable(
        {},
        null,
        { ...oosContinueListVariant, available: true },
        { available: true, inventory_management: "shopify" },
        { trustAvailableWhenQtyHidden: true }
      )
    ).toBe(true);
    expect(
      resolveShopifyAvailable(
        {},
        null,
        { ...oosContinueListVariant, available: false },
        { available: false, inventory_management: "shopify" },
        { trustAvailableWhenQtyHidden: true }
      )
    ).toBe(false);
  });

  it("trusts available flag when inventory is not tracked", () => {
    const jsV = {
      id: 1,
      available: true,
      inventory_quantity: 0,
      inventory_management: null,
      inventory_policy: "deny",
      barcode: "4015566018532",
      price: 1000,
    };
    expect(resolveShopifyAvailable({}, {}, { available: true }, jsV)).toBe(true);
    expect(
      resolveShopifyAvailable({}, {}, { available: false }, { ...jsV, available: false })
    ).toBe(false);
  });

  it("rejects preorder tags even with positive qty", () => {
    const jsV = { ...oosContinueJsVariant, inventory_quantity: 5 };
    expect(
      resolveShopifyAvailable(
        { title: "Game", tags: "preorder, language_German" },
        { title: "Game", tags: ["preorder", "language_German"], variants: [jsV] },
        oosContinueListVariant,
        jsV
      )
    ).toBe(false);
  });
});

describe("isShopifyPreorderSignal / qty", () => {
  it("detects vorbestellung and pre-order in title/tags", () => {
    expect(isShopifyPreorderSignal({ tags: "Vorbestellung" }, null, {}, {})).toBe(true);
    expect(isShopifyPreorderSignal({ title: "Foo Pre-Order" }, null, {}, {})).toBe(true);
    expect(isShopifyPreorderSignal({ tags: "language_German" }, { tags: ["WP_Expert"] }, {}, {})).toBe(
      false
    );
  });

  it("reads inventory_quantity from .js preferentially", () => {
    expect(resolveShopifyInventoryQty({ inventory_quantity: 9 }, { inventory_quantity: 0 })).toBe(0);
    expect(resolveShopifyInventoryQty({}, { inventory_quantity: 4 })).toBe(4);
    expect(resolveShopifyInventoryQty({}, {})).toBe(null);
  });
});

describe("collectEligibleRecords", () => {
  it("marks ultimate-railroads-style OOS continue as available:false", () => {
    const product = {
      title: "Ultimate Railroads (DE)",
      vendor: "Hans im Glück",
      product_type: "Board Games",
      tags: "language_German, ludonix",
      variants: [oosContinueListVariant],
    };
    const productJs = {
      title: "Ultimate Railroads (DE)",
      vendor: "Hans im Glück",
      type: "Board Games",
      tags: ["language_German", "ludonix"],
      variants: [oosContinueJsVariant],
      images: [],
    };
    const rows = collectEligibleRecords(shop, product, productJs);
    expect(rows).toHaveLength(1);
    expect(rows[0].gtin).toBe("4015566018532");
    expect(rows[0].available).toBe(false);
    expect(rows[0].supplierVariantId).toBe("wel_4015566018532");
  });

  it("keeps available:true only when qty>0", () => {
    const product = {
      title: "In Stock Game",
      vendor: "Vendor",
      product_type: "Board Games",
      variants: [{ ...oosContinueListVariant, barcode: "4015566018532" }],
    };
    const productJs = {
      variants: [{ ...oosContinueJsVariant, inventory_quantity: 2 }],
      images: [],
    };
    const rows = collectEligibleRecords(shop, product, productJs);
    expect(rows[0]?.available).toBe(true);
  });

  it("applies Warenkontor landed sell (shelf + CHF 6 + REI 30%) and trusts available", () => {
    const wrk: ScraperShop = {
      key: "wrk",
      code: "WRK",
      name: "Warenkontor",
      baseUrl: "https://warenkontor.ch",
      currency: "CHF",
      platform: "shopify",
      gated: true,
    };
    const product = {
      handle: "optisches-hybrid-ultra-high-speed-hdmi-kabel-aoc-8k-60hz",
      title: "Optisches Hybrid Ultra High-Speed HDMI Kabel (AOC) 8K / 60Hz",
      vendor: "Goobay",
      product_type: "Kabel",
      variants: [
        {
          id: 1,
          title: "Default Title",
          price: "40.00",
          sku: "100151565",
          barcode: "4040849762741",
          available: true,
        },
      ],
    };
    const productJs = {
      handle: "optisches-hybrid-ultra-high-speed-hdmi-kabel-aoc-8k-60hz",
      variants: [
        {
          id: 1,
          title: "Default Title",
          price: 4000,
          sku: "100151565",
          barcode: "4040849762741",
          available: true,
          inventory_management: "shopify",
          // Warenkontor hides qty in public .js
        },
      ],
      images: [],
    };
    const rows = collectEligibleRecords(wrk, product, productJs);
    expect(rows).toHaveLength(1);
    expect(rows[0].available).toBe(true);
    // (40 + 6) * 1.30 = 59.8
    expect(rows[0].price).toBe(59.8);
    expect(rows[0].manualNote).toContain("warenkontor_landed_cost");
    expect(rows[0].manualNote).toContain('"buyChf":40');
    expect(rows[0].manualNote).toContain('"shippingChf":6');
  });
});
