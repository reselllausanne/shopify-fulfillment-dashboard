import { describe, expect, it } from "vitest";
import {
  resolveInStockFixedPrice,
  isInStockFixedPriceProduct,
} from "@/shopify/inventory/inStockFixedPrice";

describe("inStockFixedPrice", () => {
  it("resolves Essentials tee by productId with fixed COGS and sell 59/89", () => {
    const r = resolveInStockFixedPrice({ productId: "15340411617666" });
    expect(r?.costChf).toBe(42);
    expect(r?.sellChf).toBe(59);
    expect(r?.expressChf).toBe(89);
    expect(r?.label).toMatch(/T-Shirt/i);
  });

  it("resolves Essentials shorts by title with fixed COGS and sell 59/89", () => {
    const r = resolveInStockFixedPrice({
      title: "Essentials Shorts Stretch Limo (SS22)",
    });
    expect(r?.costChf).toBe(42);
    expect(r?.sellChf).toBe(59);
    expect(r?.expressChf).toBe(89);
  });

  it("resolves Light Heather hoodie by SKU base with fixed COGS and sell 129/169", () => {
    const r = resolveInStockFixedPrice({ sku: "192HO246258F-M" });
    expect(r?.costChf).toBe(42);
    expect(r?.sellChf).toBe(129);
    expect(r?.expressChf).toBeUndefined();
    expect(r?.noExpress).toBe(true);
    expect(r?.galaxusExVatChf).toBe(69);
  });

  it("resolves FW24 Black hoodie by SKU base with sell 129/169", () => {
    const r = resolveInStockFixedPrice({ sku: "192HO246250F-S" });
    expect(r?.sellChf).toBe(129);
    expect(r?.noExpress).toBe(true);
  });

  it("resolves the FW24 hoodie by title and Crocs warehouse at 42", () => {
    expect(
      resolveInStockFixedPrice({
        title: "Fear of God Essentials Fleece Hoodie (FW24) Black",
      })?.costChf
    ).toBe(42);
    expect(
      resolveInStockFixedPrice({ title: "Crocs Lightning McQueen (41, 42)" })?.costChf
    ).toBe(42);
  });

  it("resolves Bape by productId with fixed COGS and sell 69/99", () => {
    const r = resolveInStockFixedPrice({ productId: "gid://shopify/Product/15356478325122" });
    expect(r?.costChf).toBe(40);
    expect(r?.sellChf).toBe(69);
    expect(r?.expressChf).toBe(99);
  });

  it("resolves Bape Sakura Tree by title / SKU base with fixed COGS", () => {
    expect(
      resolveInStockFixedPrice({ title: "BAPE Sakura Tree Tee Black" })?.costChf,
    ).toBe(40);
    expect(
      resolveInStockFixedPrice({ sku: "8d665d38-a271-46ee-9b51-9da28c3bbb6c-M" })?.costChf,
    ).toBe(40);
  });

  it("resolves Audemars x Travis by title with fixed COGS and sell 89/109", () => {
    const r = resolveInStockFixedPrice({
      title: "Travis Scott CJ x Audemars Piguet Vintage Tee Black",
    });
    expect(r?.costChf).toBe(40);
    expect(r?.sellChf).toBe(89);
    expect(r?.expressChf).toBe(109);
  });

  it("resolves Essentials Galaxus title + KickDB styleId 125HO244360F", () => {
    expect(
      isInStockFixedPriceProduct({
        title: "Essentials Fear of God Jersey Crewneck T-Shirt Black (XS)",
        sku: "125HO244360F",
      })
    ).toBe(true);
    const r = resolveInStockFixedPrice({
      title: "Essentials Fear of God Jersey Crewneck T-Shirt Black (XS)",
      sku: "125HO244360F",
    });
    expect(r?.sellChf).toBe(59);
    expect(r?.expressChf).toBe(89);
  });

  it("does not match liquidation sneakers with Essential in name", () => {
    expect(
      isInStockFixedPriceProduct({
        title: "Nike Air Max 1 Essential Light Bone/Psychic Blue",
        sku: "FZ5808-009-44",
      })
    ).toBe(false);
  });

  it("resolves Supreme boxers by productId / title / StockX SKU, not socks", () => {
    const byId = resolveInStockFixedPrice({ productId: "15074846179714" });
    expect(byId?.sellChf).toBe(49);
    expect(byId?.expressChf).toBe(69);
    expect(byId?.label).toMatch(/Boxer/i);

    expect(
      isInStockFixedPriceProduct({
        title: "Supreme Hanes Boxer Briefs (4 Pack) White",
      })
    ).toBe(true);
    expect(
      isInStockFixedPriceProduct({
        sku: "eadd2461-f6c4-45eb-86f8-83869bb034b3-S",
      })
    ).toBe(true);
    expect(
      isInStockFixedPriceProduct({
        title: "Supreme Hanes Crew Socks (4 Pack) White",
      })
    ).toBe(false);
  });
  it("resolves Eden/Black beanie by productId at hard 79 / express 99", () => {
    const r = resolveInStockFixedPrice({ productId: "gid://shopify/Product/15233996095874" });
    expect(r?.sellChf).toBe(79);
    expect(r?.expressChf).toBe(99);
    expect(r?.hardSell).toBe(true);
    expect(r?.skipLivraison48h).toBe(true);
    expect(
      resolveInStockFixedPrice({ productId: "gid://shopify/Product/15240946155906" })?.sellChf
    ).toBe(79);
    // Sibling Arc'teryx colourways share SKU X000006756-OS and must stay untouched.
    expect(
      resolveInStockFixedPrice({
        sku: "X000006756-OS",
        productId: "gid://shopify/Product/15396946116994",
        title: "Arc'teryx Bird Head Toque Beanie Black/Void",
      })
    ).toBeNull();
  });

  it("resolves only S/M/L of the grey Nike Tech joggers + windrunner at hard 99 / express 119", () => {
    for (const sku of [
      "CU4495-063-S",
      "CU4495-063-M",
      "CU4495-063-L",
      "281c30b7-d092-4607-a39d-37d27b5a3ac9-S",
      "FB7921-063-M",
      "281c30b7-d092-4607-a39d-37d27b5a3ac9-L",
    ]) {
      const r = resolveInStockFixedPrice({ sku });
      expect(r?.sellChf, sku).toBe(99);
      expect(r?.expressChf, sku).toBe(119);
      expect(r?.hardSell, sku).toBe(true);
    }
    for (const sku of ["CU4495-063-XL", "FB8002-063-2XL", "FB7921-063-XXXL", "281c30b7-d092-4607-a39d-37d27b5a3ac9-XS"]) {
      expect(resolveInStockFixedPrice({ sku }), sku).toBeNull();
    }
  });
});
