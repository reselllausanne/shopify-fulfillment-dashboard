import { afterEach, describe, expect, it } from "vitest";
import {
  isGalaxusCatalogReady,
  isGalaxusSellableStock,
  isXntFeedBlockedBrand,
  resolveGalaxusDirectDeliverySupported,
  shouldForceGalaxusStockZero,
} from "@/galaxus/exports/feedEligibility";

describe("isGalaxusCatalogReady", () => {
  it("rejects missing image / name / brand (NER shell)", () => {
    expect(
      isGalaxusCatalogReady({
        supplierProductName: null,
        supplierBrand: null,
        images: null,
      })
    ).toBe(false);
  });

  it("accepts image + name + brand", () => {
    expect(
      isGalaxusCatalogReady({
        supplierProductName: "Nike Air Force 1",
        supplierBrand: "Nike",
        sourceImageUrl: "https://cdn.example.com/af1.jpg",
      })
    ).toBe(true);
  });

  it("accepts sku fallback when name empty but brand+image present", () => {
    expect(
      isGalaxusCatalogReady({
        supplierProductName: null,
        supplierSku: "SKU-1",
        supplierBrand: "Nike",
        hostedImageUrl: "https://cdn.example.com/af1.jpg",
      })
    ).toBe(true);
  });

  it("accepts hasImageSignal without images JSONB", () => {
    expect(
      isGalaxusCatalogReady({
        supplierProductName: "Nike Air Force 1",
        supplierBrand: "Nike",
        hasImageSignal: true,
      })
    ).toBe(true);
    expect(
      isGalaxusCatalogReady({
        supplierProductName: "Nike Air Force 1",
        supplierBrand: "Nike",
        hasImageSignal: false,
      })
    ).toBe(false);
  });

  // XNT block is enforced at the master + offer route level (not inside
  // isGalaxusCatalogReady) so the stock route can still push stock=0 rows to
  // delist. See isXntFeedBlockedBrand tests below.
});

describe("isXntFeedBlockedBrand", () => {
  it("matches by supplierVariantId prefix", () => {
    expect(
      isXntFeedBlockedBrand({
        supplierVariantId: "xnt_123",
        supplierBrand: "Whatever",
      })
    ).toBe(true);
  });

  it("matches by supplierKey", () => {
    expect(
      isXntFeedBlockedBrand({
        supplierKey: "xnt",
        supplierBrand: "Le Creuset",
      })
    ).toBe(true);
  });

  it("matches xnt id variant separator", () => {
    expect(
      isXntFeedBlockedBrand({
        supplierVariantId: "xnt:abc",
      })
    ).toBe(true);
  });

  it("passes through non-xnt rows", () => {
    expect(
      isXntFeedBlockedBrand({
        supplierKey: "ner",
        supplierBrand: "Le Creuset",
      })
    ).toBe(false);
  });
});

describe("shouldForceGalaxusStockZero", () => {
  const prev = process.env.GALAXUS_STOCK_POSITIVE_ALLOWLIST;

  afterEach(() => {
    if (prev === undefined) delete process.env.GALAXUS_STOCK_POSITIVE_ALLOWLIST;
    else process.env.GALAXUS_STOCK_POSITIVE_ALLOWLIST = prev;
  });

  it("disabled when allowlist empty", () => {
    process.env.GALAXUS_STOCK_POSITIVE_ALLOWLIST = "";
    expect(shouldForceGalaxusStockZero({ supplierVariantId: "tus_1" })).toBe(false);
  });

  it("forces zero for scrapers outside stx,ner,rei", () => {
    process.env.GALAXUS_STOCK_POSITIVE_ALLOWLIST = "stx,ner,rei";
    expect(shouldForceGalaxusStockZero({ supplierVariantId: "tus_1" })).toBe(true);
    expect(shouldForceGalaxusStockZero({ supplierKey: "wel" })).toBe(true);
    expect(shouldForceGalaxusStockZero({ providerKey: "XNT_123" })).toBe(true);
    expect(shouldForceGalaxusStockZero({ supplierVariantId: "stx_1" })).toBe(false);
    expect(shouldForceGalaxusStockZero({ supplierKey: "ner" })).toBe(false);
    expect(shouldForceGalaxusStockZero({ providerKey: "REI_999" })).toBe(false);
  });
});

describe("isGalaxusSellableStock", () => {
  it("enforces GLD MOQ 3", () => {
    expect(isGalaxusSellableStock(1, { providerKey: "GLD_194274091274" })).toBe(false);
    expect(isGalaxusSellableStock(3, { providerKey: "GLD_194274091274" })).toBe(true);
  });

  it("allows stock 1 for NER/STX default MOQ", () => {
    expect(isGalaxusSellableStock(1, { providerKey: "NER_123" })).toBe(true);
    expect(isGalaxusSellableStock(1, { providerKey: "STX_123" })).toBe(true);
    expect(isGalaxusSellableStock(0, { providerKey: "NER_123" })).toBe(false);
  });
});

describe("resolveGalaxusDirectDeliverySupported", () => {
  it("disables DD for STX standard dropship", () => {
    expect(
      resolveGalaxusDirectDeliverySupported({
        isStx: true,
        deliveryType: "standard",
        hasPhysicalStock: false,
      })
    ).toBe("0");
  });

  it("keeps DD for express STX", () => {
    expect(
      resolveGalaxusDirectDeliverySupported({
        isStx: true,
        deliveryType: "express_standard",
      })
    ).toBe("1");
    expect(
      resolveGalaxusDirectDeliverySupported({
        isStx: true,
        deliveryType: "express_expedited",
      })
    ).toBe("1");
  });

  it("keeps DD for standard STX when physical mirror stock is live", () => {
    expect(
      resolveGalaxusDirectDeliverySupported({
        isStx: true,
        deliveryType: "standard",
        hasPhysicalStock: true,
      })
    ).toBe("1");
  });

  it("disables DD for GLD", () => {
    expect(resolveGalaxusDirectDeliverySupported({ isGld: true, isStx: false })).toBe("0");
  });
});
