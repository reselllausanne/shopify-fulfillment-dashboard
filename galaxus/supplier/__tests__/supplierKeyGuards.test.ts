import { describe, expect, it } from "vitest";
import {
  isNerSupplierVariantId,
  isPartnerCatalogSupplierVariantId,
  isStxSupplierVariantId,
  supplierKeyFromVariantId,
} from "@/galaxus/supplier/supplierKeyGuards";

describe("supplierKeyGuards", () => {
  it("detects NER ids", () => {
    expect(isNerSupplierVariantId("ner:129421-44")).toBe(true);
    expect(isNerSupplierVariantId("NER_4052001426514")).toBe(true);
    expect(isPartnerCatalogSupplierVariantId("ner:foo")).toBe(true);
  });

  it("detects STX ids", () => {
    expect(isStxSupplierVariantId("stx_abc123")).toBe(true);
    expect(isStxSupplierVariantId("ner:129421-44")).toBe(false);
  });

  it("parses supplier keys", () => {
    expect(supplierKeyFromVariantId("stx_123")).toBe("stx");
    expect(supplierKeyFromVariantId("ner:129421-44")).toBe("ner");
  });
});
