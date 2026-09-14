import { describe, expect, it } from "vitest";
import {
  isGalaxusCatalogReady,
  isGalaxusSellableStock,
  isXntFeedBlockedBrand,
  resolveGalaxusDirectDeliverySupported,
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

  it("rejects XNT variants for Pollin / Berrybase brands", () => {
    expect(
      isGalaxusCatalogReady({
        supplierProductName: "Some Board",
        supplierBrand: "Pollin",
        supplierVariantId: "xnt_abc123",
        hostedImageUrl: "https://cdn.example.com/x.jpg",
      })
    ).toBe(false);
    expect(
      isGalaxusCatalogReady({
        supplierProductName: "Raspberry Pi Case",
        supplierBrand: "BerryBase",
        supplierKey: "xnt",
        hostedImageUrl: "https://cdn.example.com/x.jpg",
      })
    ).toBe(false);
  });

  it("keeps non-XNT variants with same brand unaffected", () => {
    expect(
      isGalaxusCatalogReady({
        supplierProductName: "Berrybase Cable",
        supplierBrand: "Berrybase",
        supplierVariantId: "rei_abc",
        hostedImageUrl: "https://cdn.example.com/x.jpg",
      })
    ).toBe(true);
  });
});

describe("isXntFeedBlockedBrand", () => {
  it("matches by supplierVariantId prefix", () => {
    expect(
      isXntFeedBlockedBrand({
        supplierVariantId: "xnt_123",
        supplierBrand: "Pollin",
      })
    ).toBe(true);
  });

  it("matches by supplierKey", () => {
    expect(
      isXntFeedBlockedBrand({
        supplierKey: "xnt",
        supplierBrand: "Berry Base",
      })
    ).toBe(true);
  });

  it("case + accent insensitive", () => {
    expect(
      isXntFeedBlockedBrand({
        supplierKey: "xnt",
        supplierBrand: "POLLIN GmbH",
      })
    ).toBe(true);
  });

  it("passes through allowed brands", () => {
    expect(
      isXntFeedBlockedBrand({
        supplierKey: "xnt",
        supplierBrand: "Le Creuset",
      })
    ).toBe(false);
  });
});

describe("isGalaxusSellableStock", () => {
  it("enforces GLD MOQ 3", () => {
    expect(
      isGalaxusSellableStock(1, { providerKey: "GLD_194274091274" })
    ).toBe(false);
    expect(
      isGalaxusSellableStock(3, { providerKey: "GLD_194274091274" })
    ).toBe(true);
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
