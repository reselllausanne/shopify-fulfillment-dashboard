import { describe, expect, it } from "vitest";
import {
  resolveInStockFixedPrice,
  isInStockFixedPriceProduct,
} from "@/shopify/inventory/inStockFixedPrice";

describe("inStockFixedPrice", () => {
  it("resolves Essentials tee by productId with COGS 26 and sell 59/89", () => {
    const r = resolveInStockFixedPrice({ productId: "15340411617666" });
    expect(r?.costChf).toBe(26);
    expect(r?.sellChf).toBe(59);
    expect(r?.expressChf).toBe(89);
    expect(r?.label).toMatch(/T-Shirt/i);
  });

  it("resolves Essentials shorts by title with COGS 26 and sell 59/89", () => {
    const r = resolveInStockFixedPrice({
      title: "Essentials Shorts Stretch Limo (SS22)",
    });
    expect(r?.costChf).toBe(26);
    expect(r?.sellChf).toBe(59);
    expect(r?.expressChf).toBe(89);
  });

  it("resolves hoodie by SKU base with COGS 42 and sell 59/89", () => {
    const r = resolveInStockFixedPrice({ sku: "192HO246258F-M" });
    expect(r?.costChf).toBe(42);
    expect(r?.sellChf).toBe(59);
    expect(r?.expressChf).toBe(89);
  });

  it("resolves Bape by productId with COGS 35", () => {
    const r = resolveInStockFixedPrice({ productId: "gid://shopify/Product/15356478325122" });
    expect(r?.costChf).toBe(35);
  });

  it("resolves Audemars x Travis by title with COGS 40 and sell 89/109", () => {
    const r = resolveInStockFixedPrice({
      title: "Travis Scott CJ x Audemars Piguet Vintage Tee Black",
    });
    expect(r?.costChf).toBe(40);
    expect(r?.sellChf).toBe(89);
    expect(r?.expressChf).toBe(109);
  });

  it("does not match liquidation sneakers with Essential in name", () => {
    expect(
      isInStockFixedPriceProduct({
        title: "Nike Air Max 1 Essential Light Bone/Psychic Blue",
        sku: "FZ5808-009-44",
      })
    ).toBe(false);
  });
});
