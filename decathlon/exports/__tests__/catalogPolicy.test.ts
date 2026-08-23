import { describe, expect, it } from "vitest";
import {
  isDecathlonBlockedSupplierKey,
  isDecathlonExpressExpeditedDelivery,
  isDecathlonPhysicalInstockEnabled,
  isDecathlonProductOnboardable,
  isDecathlonSalesPaused,
  isDecathlonSellableSupplierKey,
} from "../catalogPolicy";

describe("Decathlon catalog policy", () => {
  it("allows only express_expedited as STX dropship lane", () => {
    expect(isDecathlonExpressExpeditedDelivery("express_expedited")).toBe(true);
    expect(isDecathlonExpressExpeditedDelivery("express_standard")).toBe(false);
    expect(isDecathlonExpressExpeditedDelivery("express_shipped")).toBe(false);
    expect(isDecathlonExpressExpeditedDelivery("standard")).toBe(false);
  });

  it("blocks NER/SNL and only sells STX", () => {
    expect(isDecathlonSellableSupplierKey("stx")).toBe(true);
    expect(isDecathlonBlockedSupplierKey("ner")).toBe(true);
    expect(isDecathlonBlockedSupplierKey("snl")).toBe(true);
    expect(isDecathlonProductOnboardable({ providerKey: "NER_1", variant: { supplierVariantId: "ner_1" } } as any)).toBe(
      false
    );
    expect(isDecathlonProductOnboardable({ providerKey: "SNL_1", variant: { supplierVariantId: "snl_1" } } as any)).toBe(
      false
    );
    expect(isDecathlonProductOnboardable({ providerKey: "STX_1", variant: { supplierVariantId: "stx_1" } } as any)).toBe(
      true
    );
  });

  it("blocks Onitsuka from onboarding", () => {
    expect(
      isDecathlonProductOnboardable({
        providerKey: "STX_1",
        variant: { supplierVariantId: "stx_1", supplierBrand: "Onitsuka Tiger" },
        product: { brand: "Onitsuka Tiger" },
      } as any)
    ).toBe(false);
  });

  it("keeps physical instock merge always on", () => {
    expect(isDecathlonPhysicalInstockEnabled()).toBe(true);
  });

  it("pauses all Decathlon sales by default until explicitly reopened", () => {
    const prev = process.env.DECATHLON_SALES_PAUSED;
    delete process.env.DECATHLON_SALES_PAUSED;
    expect(isDecathlonSalesPaused()).toBe(true);
    process.env.DECATHLON_SALES_PAUSED = "0";
    expect(isDecathlonSalesPaused()).toBe(false);
    process.env.DECATHLON_SALES_PAUSED = "1";
    expect(isDecathlonSalesPaused()).toBe(true);
    if (prev === undefined) delete process.env.DECATHLON_SALES_PAUSED;
    else process.env.DECATHLON_SALES_PAUSED = prev;
  });
});
