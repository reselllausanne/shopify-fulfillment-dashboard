import { describe, expect, it } from "vitest";
import {
  GALAXUS_ASSORTMENT_EXCEPTIONS,
  formatGalaxusAssortmentExceptionsMail,
  galaxusDisabledSupplierExemptProviderKeys,
  galaxusFashionExemptProviderKeys,
} from "@/galaxus/exports/galaxusAssortmentExceptions";

describe("galaxusAssortmentExceptions ledger", () => {
  it("exposes fashion + BWZ holes for active rows", () => {
    expect(galaxusFashionExemptProviderKeys().has("STX_041604418976")).toBe(true);
    expect(galaxusFashionExemptProviderKeys().has("BWZ_5060420232721")).toBe(true);
    expect(galaxusDisabledSupplierExemptProviderKeys().has("BWZ_5060420232721")).toBe(true);
    expect(galaxusDisabledSupplierExemptProviderKeys().has("STX_5702018066386")).toBe(false);
  });

  it("mail body lists Klimt + policy LEGO cap", () => {
    const body = formatGalaxusAssortmentExceptionsMail();
    expect(body).toContain("Klimt");
    expect(body).toContain("STX_5702018066386");
    expect(body).toContain("All LEGO sets");
    expect(body).toContain("price cap");
  });

  it("every active SKU has at least one gate", () => {
    for (const row of GALAXUS_ASSORTMENT_EXCEPTIONS.filter((e) => e.active)) {
      expect(row.gates.length).toBeGreaterThan(0);
    }
  });
});
