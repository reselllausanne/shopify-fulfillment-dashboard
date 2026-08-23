import { describe, expect, it } from "vitest";
import { resolveOrderLineProductKey } from "@/galaxus/supplier/providerKey";

describe("resolveOrderLineProductKey", () => {
  it("returns stored CODE_gtin providerKey", () => {
    expect(
      resolveOrderLineProductKey({
        providerKey: "REI_4018412327116",
        gtin: "4018412327116",
      })
    ).toBe("REI_4018412327116");
  });

  it("accepts SUPPLIER_PID shaped as CODE_gtin", () => {
    expect(
      resolveOrderLineProductKey({
        providerKey: null,
        supplierPid: "REI_4018412327116",
        gtin: "4018412327116",
      })
    ).toBe("REI_4018412327116");
  });

  it("builds from gtin + rei supplierVariantId", () => {
    expect(
      resolveOrderLineProductKey({
        providerKey: null,
        supplierPid: null,
        supplierVariantId: "rei:27700405",
        gtin: "4018412327116",
      })
    ).toBe("REI_4018412327116");
  });

  it("returns null without valid gtin", () => {
    expect(
      resolveOrderLineProductKey({
        providerKey: "REI",
        supplierVariantId: "rei:1",
        gtin: null,
      })
    ).toBeNull();
  });
});
