import { describe, expect, it } from "vitest";
import { buildOrderResponseXml } from "./builder";
import type { EdiOrderResponseDocument } from "./types";

const party = {
  id: "14206883",
  name: "Solutions Manzinali",
  street: "Chemin de Bas-de-Plan 6",
  postalCode: "1030",
  city: "Bussigny",
  country: "Schweiz",
};

function baseDoc(lines: EdiOrderResponseDocument["lines"]): EdiOrderResponseDocument {
  return {
    docId: "GORDR-1",
    orderId: "200418165",
    orderDate: new Date("2026-08-23T11:36:00Z"),
    responseDate: new Date("2026-08-23T11:36:15Z"),
    currency: "CHF",
    buyer: party,
    supplier: party,
    lines,
    status: "ACCEPTED",
    supplierOrderId: "200418165",
  };
}

describe("buildOrderResponseXml", () => {
  it("confirms without positions (Galaxus minimum)", () => {
    const xml = buildOrderResponseXml(baseDoc([]));
    expect(xml).toContain("<ORDER_ID>200418165</ORDER_ID>");
    expect(xml).toContain("<SUPPLIER_ORDER_ID>200418165</SUPPLIER_ORDER_ID>");
    expect(xml).not.toContain("ORDERRESPONSE_ITEM_LIST");
  });

  it("pads INTERNATIONAL_PID to GTIN-14", () => {
    const xml = buildOrderResponseXml(
      baseDoc([
        {
          lineNumber: 1,
          description: "Alphafly",
          quantity: 1,
          unitNetPrice: 200,
          lineNetAmount: 200,
          vatRate: 8.1,
          supplierPid: "STX_198486779739",
          buyerPid: "70263025",
          gtin: "198486779739",
          arrivalDateStart: new Date("2026-09-09T22:00:00Z"),
          arrivalDateEnd: new Date("2026-09-09T22:00:00Z"),
        },
      ])
    );
    expect(xml).toContain("00198486779739");
    expect(xml).toContain("STX_198486779739");
    expect(xml).toContain("<QUANTITY>1</QUANTITY>");
  });
});
