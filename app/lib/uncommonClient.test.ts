import { describe, expect, it } from "vitest";
import {
  isUncommonGiftCard,
  isUncommonPreorderSignal,
  parseUncommonChfPrice,
  parseUncommonStockQty,
  resolveUncommonSellable,
  type UncommonWooProduct,
} from "@/app/lib/uncommonClient";
import { computeUncommonLandedCost } from "@/app/lib/uncommonPricing";

function base(over: Partial<UncommonWooProduct> = {}): UncommonWooProduct {
  return {
    id: 1,
    name: "Gamegenic Pages",
    slug: "gamegenic-pages",
    parent: 0,
    type: "simple",
    variation: "",
    permalink: "https://theuncommonshop.ch/product/gamegenic-pages/",
    sku: "SKU1",
    prices: { price: "1495", regular_price: "1495", sale_price: "1495", currency_minor_unit: 2 },
    images: [],
    categories: [{ id: 1, name: "Binder", slug: "binder" }],
    brands: [{ id: 1, name: "Gamegenic", slug: "gamegenic" }],
    variations: [],
    is_in_stock: true,
    is_on_backorder: false,
    stock_availability: { text: "Verfügbar: 15", class: "in-stock" },
    add_to_cart: { minimum: 1, maximum: 15 },
    ...over,
  };
}

describe("parseUncommonChfPrice", () => {
  it("converts minor units", () => {
    expect(parseUncommonChfPrice({ price: "1495", regular_price: "1495", sale_price: "1495" })).toBe(
      14.95
    );
  });
});

describe("parseUncommonStockQty", () => {
  it("reads Verfügbar: N", () => {
    expect(parseUncommonStockQty(base()).qty).toBe(15);
  });

  it("reads N vorrätig", () => {
    expect(
      parseUncommonStockQty(
        base({ stock_availability: { text: "23 vorrätig", class: "in-stock" } })
      ).qty
    ).toBe(23);
  });

  it("rejects OOS text", () => {
    expect(
      parseUncommonStockQty(
        base({
          is_in_stock: false,
          stock_availability: { text: "Nicht auf Lager", class: "out-of-stock" },
          add_to_cart: { maximum: 9999 },
        })
      ).qty
    ).toBe(0);
  });

  it("ignores unlimited max 9999", () => {
    expect(
      parseUncommonStockQty(
        base({
          stock_availability: { text: "", class: "in-stock" },
          add_to_cart: { maximum: 9999 },
        })
      ).qty
    ).toBeNull();
  });
});

describe("isUncommonPreorderSignal", () => {
  it("detects vorbestellbar category even with qty", () => {
    expect(
      isUncommonPreorderSignal(
        base({
          categories: [
            { id: 306, name: "Vorbestellbar", slug: "vorbestellbar-yu-gi-oh" },
            { id: 259, name: "Yu-Gi-Oh!", slug: "yu-gi-oh" },
          ],
        })
      )
    ).toBe(true);
  });

  it("allows normal binder category", () => {
    expect(isUncommonPreorderSignal(base())).toBe(false);
  });
});

describe("resolveUncommonSellable WEL traps", () => {
  it("sells only with explicit positive qty", () => {
    const d = resolveUncommonSellable(base());
    expect(d.sellable).toBe(true);
    expect(d.stock).toBe(15);
  });

  it("rejects preorder with Verfügbar qty (WEL-style fake stock)", () => {
    const d = resolveUncommonSellable(
      base({
        name: "Yu-Gi-Oh! World Championship 2026",
        categories: [{ id: 306, name: "Vorbestellbar", slug: "vorbestellbar-yu-gi-oh" }],
        stock_availability: { text: "Verfügbar: 25", class: "in-stock" },
        add_to_cart: { maximum: 25 },
      })
    );
    expect(d.sellable).toBe(false);
    expect(d.reason).toBe("preorder");
    expect(d.stock).toBe(0);
  });

  it("rejects OOS that is still purchasable with max 9999", () => {
    const d = resolveUncommonSellable(
      base({
        is_in_stock: false,
        is_purchasable: true,
        stock_availability: { text: "Nicht auf Lager", class: "out-of-stock" },
        add_to_cart: { maximum: 9999 },
      })
    );
    expect(d.sellable).toBe(false);
    expect(d.stock).toBe(0);
  });

  it("rejects backorder", () => {
    expect(resolveUncommonSellable(base({ is_on_backorder: true })).sellable).toBe(false);
  });

  it("rejects gift cards", () => {
    expect(
      resolveUncommonSellable(
        base({ type: "pw-gift-card", slug: "geschenkgutschein", name: "Geschenkgutschein" })
      ).reason
    ).toBe("gift_card");
  });

  it("rejects qty-hidden variable parents (empty stock text)", () => {
    const d = resolveUncommonSellable(
      base({
        type: "variable",
        stock_availability: { text: "", class: "in-stock" },
        add_to_cart: { maximum: 9999 },
      })
    );
    expect(d.sellable).toBe(false);
    expect(d.reason).toBe("qty_hidden");
  });
});

describe("isUncommonGiftCard", () => {
  it("detects pw-gift-card", () => {
    expect(isUncommonGiftCard(base({ type: "pw-gift-card" }))).toBe(true);
  });
});

describe("computeUncommonLandedCost", () => {
  it("adds ship under free threshold", () => {
    const c = computeUncommonLandedCost(14.95)!;
    expect(c.shippingChf).toBe(7);
    expect(c.sellPriceChf).toBeCloseTo((14.95 + 7) * 1.2, 2);
  });

  it("waives ship at/above CHF 79", () => {
    const c = computeUncommonLandedCost(79)!;
    expect(c.shippingChf).toBe(0);
    expect(c.shippingReason).toBe("free_ship_threshold");
  });
});
