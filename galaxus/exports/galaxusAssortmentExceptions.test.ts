import { describe, expect, it } from "vitest";
import {
  GALAXUS_ASSORTMENT_EXCEPTIONS,
  formatGalaxusAssortmentExceptionsMail,
  galaxusDisabledSupplierExemptProviderKeys,
  galaxusFashionExemptProviderKeys,
} from "@/galaxus/exports/galaxusAssortmentExceptions";

describe("galaxusAssortmentExceptions ledger", () => {
  it("keeps Stanley fashion hole; BWZ Lansinoh + LEGO trials inactive after Monday rollback", () => {
    expect(galaxusFashionExemptProviderKeys().has("STX_041604418976")).toBe(true);
    expect(galaxusFashionExemptProviderKeys().has("BWZ_5060420232721")).toBe(false);
    expect(galaxusDisabledSupplierExemptProviderKeys().has("BWZ_5060420232721")).toBe(false);
    expect(galaxusDisabledSupplierExemptProviderKeys().has("BWZ_5060420233353")).toBe(false);
    expect(GALAXUS_ASSORTMENT_EXCEPTIONS.filter((e) => e.supplierKey === "bwz" && e.active)).toHaveLength(0);
  });

  it("mail body (incl. inactive) still documents Klimt + closed LEGO cap", () => {
    const live = formatGalaxusAssortmentExceptionsMail();
    expect(live).toContain("Stanley");
    expect(live).not.toContain("Klimt");
    const full = formatGalaxusAssortmentExceptionsMail({ includeInactive: true });
    expect(full).toContain("Klimt");
    expect(full).toContain("STX_5702018066386");
    expect(full).toContain("All LEGO sets");
    expect(full).toContain("[off]");
  });

  it("every active SKU has at least one gate", () => {
    for (const row of GALAXUS_ASSORTMENT_EXCEPTIONS.filter((e) => e.active)) {
      expect(row.gates.length).toBeGreaterThan(0);
    }
  });
});
