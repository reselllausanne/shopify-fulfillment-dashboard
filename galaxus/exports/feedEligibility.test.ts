import { afterEach, describe, expect, it } from "vitest";
import {
  buildGalaxusForceZeroStockRow,
  galaxusStockFeedActiveSupplierCodes,
  isGalaxusCatalogReady,
  isGalaxusSellableStock,
  isGalaxusStockFeedInactiveSupplier,
  isXntFeedBlockedBrand,
  resetGalaxusStockFeedActiveSupplierCodesCache,
  resolveGalaxusDirectDeliverySupported,
  resolveGalaxusFeedSupplierCode,
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

  // XNT Pollin/Berrybase block is now enforced at the master + offer route
  // level (not inside isGalaxusCatalogReady) so the stock route can still push
  // stock=0 rows to delist. See isXntFeedBlockedBrand tests below.
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

describe("galaxus stock feed active suppliers", () => {
  const prevActive = process.env.GALAXUS_STOCK_FEED_ACTIVE_SUPPLIERS;

  afterEach(() => {
    if (prevActive === undefined) delete process.env.GALAXUS_STOCK_FEED_ACTIVE_SUPPLIERS;
    else process.env.GALAXUS_STOCK_FEED_ACTIVE_SUPPLIERS = prevActive;
    resetGalaxusStockFeedActiveSupplierCodesCache();
  });

  it("defaults to NER/STX/REI/WEL", () => {
    delete process.env.GALAXUS_STOCK_FEED_ACTIVE_SUPPLIERS;
    resetGalaxusStockFeedActiveSupplierCodesCache();
    expect([...galaxusStockFeedActiveSupplierCodes()].sort()).toEqual(["NER", "REI", "STX", "WEL"]);
  });

  it("marks GLD/XNT/THE inactive", () => {
    expect(
      isGalaxusStockFeedInactiveSupplier({ providerKey: "GLD_4018412327116" })
    ).toBe(true);
    expect(
      isGalaxusStockFeedInactiveSupplier({ providerKey: "XNT_4018412327116" })
    ).toBe(true);
    expect(
      isGalaxusStockFeedInactiveSupplier({ supplierVariantId: "the_123" })
    ).toBe(true);
  });

  it("keeps NER/STX/REI/WEL active", () => {
    expect(isGalaxusStockFeedInactiveSupplier({ providerKey: "NER_123" })).toBe(false);
    expect(isGalaxusStockFeedInactiveSupplier({ providerKey: "STX_123" })).toBe(false);
    expect(isGalaxusStockFeedInactiveSupplier({ providerKey: "REI_123" })).toBe(false);
    expect(isGalaxusStockFeedInactiveSupplier({ providerKey: "WEL_123" })).toBe(false);
  });

  it("resolves golden supplier id to GLD", () => {
    expect(resolveGalaxusFeedSupplierCode({ supplierVariantId: "golden_99" })).toBe("GLD");
  });

  it("builds zero-stock row", () => {
    const row = buildGalaxusForceZeroStockRow({
      providerKey: "GLD_4018412327116",
      supplierVariantId: "golden_99",
    });
    expect(row.ProviderKey).toBe("GLD_4018412327116");
    expect(row.QuantityOnStock).toBe("0");
    expect(row.DirectDeliverySupported).toBe("0");
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
