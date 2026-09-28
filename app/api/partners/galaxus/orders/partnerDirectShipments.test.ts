import { describe, expect, it } from "vitest";
import {
  filterPartnerShipments,
  isFinalizedPartnerShipment,
  remainingPartnerLineSelection,
} from "./partnerDirectShipments";

const nerLine = (id: string, gtin: string, quantity = 1) => ({
  id,
  supplierPid: `NER_0${gtin}`,
  gtin,
  quantity,
});

describe("partnerDirectShipments", () => {
  it("ignores other suppliers' finalized shipments when computing partner remaining", () => {
    const lines = [nerLine("l1", "198729854827"), nerLine("l5", "198729735430")];
    const shipments = [
      {
        providerKey: "STX",
        status: "FULFILLED",
        delrSentAt: new Date(),
        delrStatus: "UPLOADED",
        items: [{ supplierPid: "STX_197601800419", gtin14: "197601800419", quantity: 1 }],
      },
    ];
    expect(remainingPartnerLineSelection(lines, shipments)).toEqual([
      { lineId: "l1", quantity: 1 },
      { lineId: "l5", quantity: 1 },
    ]);
    expect(filterPartnerShipments(shipments, "NER")).toEqual([]);
  });

  it("counts open MANUAL drafts and finalized shipments as consumed", () => {
    const lines = [nerLine("l1", "198729854827", 2), nerLine("l5", "198729735430")];
    const shipments = [
      {
        providerKey: "NER",
        status: "MANUAL",
        delrStatus: "PENDING",
        items: [{ supplierPid: "NER_0198729854827", gtin14: "198729854827", quantity: 1 }],
      },
      {
        providerKey: "NER",
        status: "FULFILLED",
        delrStatus: "UPLOADED",
        items: [{ supplierPid: "NER_0198729735430", gtin14: "198729735430", quantity: 1 }],
      },
    ];
    expect(remainingPartnerLineSelection(lines, shipments)).toEqual([{ lineId: "l1", quantity: 1 }]);
  });

  it("skips non-manual unfinalized shipments (purged on next create)", () => {
    const lines = [nerLine("l1", "198729854827")];
    const shipments = [
      {
        status: "DRAFT",
        delrStatus: null,
        items: [{ supplierPid: "NER_0198729854827", gtin14: "198729854827", quantity: 1 }],
      },
    ];
    expect(remainingPartnerLineSelection(lines, shipments)).toEqual([{ lineId: "l1", quantity: 1 }]);
  });

  it("detects finalized shipments", () => {
    expect(isFinalizedPartnerShipment({ delrStatus: "PENDING" })).toBe(false);
    expect(isFinalizedPartnerShipment({ delrStatus: "UPLOADED" })).toBe(true);
    expect(isFinalizedPartnerShipment({ delrSentAt: new Date() })).toBe(true);
  });
});
