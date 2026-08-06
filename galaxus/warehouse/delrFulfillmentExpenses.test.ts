import { describe, expect, it } from "vitest";
import {
  GALAXUS_DELR_PACK_CHF,
  GALAXUS_DELR_SHIP_OVER_CHF,
  GALAXUS_DELR_SHIP_UNDER_CHF,
  galaxusDelrFeeBreakdown,
  isNerGalaxusDelrShipment,
} from "@/galaxus/warehouse/delrFulfillmentExpenses";

describe("galaxusDelrFeeBreakdown", () => {
  it("uses under-rate for 6 units or fewer", () => {
    expect(galaxusDelrFeeBreakdown(6)).toEqual({
      units: 6,
      packChf: GALAXUS_DELR_PACK_CHF,
      shipChf: GALAXUS_DELR_SHIP_UNDER_CHF,
      totalChf: 11,
      tier: "under",
    });
    expect(galaxusDelrFeeBreakdown(1).shipChf).toBe(6.5);
  });

  it("uses over-rate when units > 6", () => {
    expect(galaxusDelrFeeBreakdown(7)).toEqual({
      units: 7,
      packChf: GALAXUS_DELR_PACK_CHF,
      shipChf: GALAXUS_DELR_SHIP_OVER_CHF,
      totalChf: 14,
      tier: "over",
    });
  });
});

describe("isNerGalaxusDelrShipment", () => {
  it("detects shipment.providerKey NER", () => {
    expect(isNerGalaxusDelrShipment({ providerKey: "NER" })).toBe(true);
    expect(isNerGalaxusDelrShipment({ providerKey: "ner" })).toBe(true);
    expect(isNerGalaxusDelrShipment({ providerKey: "STX" })).toBe(false);
  });

  it("detects pure NER_STOCK items via supplierPid", () => {
    expect(
      isNerGalaxusDelrShipment({
        providerKey: null,
        items: [{ supplierPid: "NER_1234567890123" }, { supplierPid: "NER_999" }],
      })
    ).toBe(true);
  });

  it("does not treat maison/STX parcels as NER", () => {
    expect(
      isNerGalaxusDelrShipment({
        providerKey: null,
        items: [{ supplierPid: "THE_123" }, { supplierPid: "STX_456" }],
      })
    ).toBe(false);
    expect(
      isNerGalaxusDelrShipment({
        providerKey: null,
        items: [{ supplierPid: "NER_1" }, { supplierPid: "STX_2" }],
      })
    ).toBe(false);
  });
});
