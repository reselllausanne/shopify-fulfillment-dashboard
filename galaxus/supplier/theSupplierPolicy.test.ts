import { afterEach, describe, expect, it } from "vitest";
import {
  gatePartnerSyncForTheSupplier,
  isThePartnerUploadProviderKey,
  isTheSupplierEnabled,
  isTheSupplierPartnerKey,
  isTheSupplierProviderKey,
  isTheSupplierVariantId,
} from "./theSupplierPolicy";

describe("theSupplierPolicy", () => {
  afterEach(() => {
    delete process.env.THE_SUPPLIER_ENABLED;
  });

  it("defaults THE supplier to disabled", () => {
    expect(isTheSupplierEnabled()).toBe(false);
    expect(gatePartnerSyncForTheSupplier("THE")).toEqual({
      allowed: false,
      reason: "THE supplier is disabled",
    });
  });

  it("allows THE when THE_SUPPLIER_ENABLED=true", () => {
    process.env.THE_SUPPLIER_ENABLED = "true";
    expect(isTheSupplierEnabled()).toBe(true);
    expect(gatePartnerSyncForTheSupplier("THE")).toEqual({ allowed: true });
  });

  it("detects THE partner and variant ids", () => {
    expect(isTheSupplierPartnerKey("the")).toBe(true);
    expect(isTheSupplierPartnerKey("NER")).toBe(false);
    expect(isThePartnerUploadProviderKey("THE")).toBe(true);
    expect(isTheSupplierProviderKey("THE_7612345678901")).toBe(true);
    expect(isTheSupplierVariantId("the:IM4002-100-40")).toBe(true);
    expect(isTheSupplierVariantId("stx_abc")).toBe(false);
  });
});
