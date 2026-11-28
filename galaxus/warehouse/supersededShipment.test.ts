import { describe, expect, it } from "vitest";
import {
  SUPERSEDED_WRONG_ITEM_STATUS,
  buildSupersedeUpdate,
  excludeSuperseded,
  isSupersededShipment,
} from "./supersededShipment";
import { assertOutgoingInvoiceAllowed, prepareOutgoingInvoiceLines } from "@/galaxus/edi/invoiceCoverage";

const shipment = {
  id: "s1",
  status: "FULFILLED",
  trackingNumber: "996015781700009375",
  delrStatus: "UPLOADED",
  delrSentAt: new Date("2026-11-18T10:19:00.747Z"),
  delrFileName: "GDELR_x.xml",
  galaxusShippedAt: new Date("2026-11-18T10:19:00.747Z"),
  manualNote: null,
};

describe("superseded wrong-item shipment", () => {
  it("clears every shipped signal and keeps audit in note + snapshot", () => {
    const { data, snapshot } = buildSupersedeUpdate(shipment, {
      reason: "Salomon shipped instead of jersey",
      ticket: "26530931",
      now: new Date("2026-11-27T17:00:00Z"),
    });
    expect(data.status).toBe(SUPERSEDED_WRONG_ITEM_STATUS);
    expect(data.delrStatus).toBe("PENDING");
    expect(data.delrSentAt).toBeNull();
    expect(data.galaxusShippedAt).toBeNull();
    expect(data.trackingNumber).toBeNull();
    expect(data.manualNote).toContain("996015781700009375");
    expect(data.manualNote).toContain("26530931");
    expect(snapshot.status).toBe("FULFILLED");
    expect(snapshot.delrSentAt).toBe("2026-11-18T10:19:00.747Z");
  });

  it("is excluded from active shipments", () => {
    const rows = [{ status: "SUPERSEDED_WRONG_ITEM" }, { status: "MANUAL" }];
    expect(isSupersededShipment(rows[0])).toBe(true);
    expect(excludeSuperseded(rows)).toEqual([{ status: "MANUAL" }]);
  });
});

describe("no double invoice after reship", () => {
  const line: any = {
    id: "l1",
    lineNumber: 1,
    productName: "Jersey",
    quantity: 1,
    qtyConfirmed: 1,
    buyerPid: "66803892",
    supplierPid: "STX_198730749518",
    gtin: "198730749518",
    unitNetPrice: 105.39,
    lineNetAmount: 105.39,
  };
  const invoiced = new Map([["l1", 1]]);

  it("rejects re-invoicing a fully invoiced line (reship must not re-invoice)", () => {
    const lines = prepareOutgoingInvoiceLines([line], null, undefined, invoiced);
    expect(() => assertOutgoingInvoiceAllowed([line], lines, invoiced)).toThrow(/already fully invoiced/);
  });
});
