import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseOrderFromXml } from "./service";

const warehouseXml = `<?xml version="1.0" encoding="UTF-8"?>
<ORDER>
  <ORDER_HEADER>
    <ORDER_INFO>
      <ORDER_ID>210645477</ORDER_ID>
      <ORDER_DATE>2026-11-10T10:00:00</ORDER_DATE>
      <CURRENCY>CHF</CURRENCY>
      <PARTIES>
        <PARTY>
          <PARTY_ID type="buyer_specific">406802</PARTY_ID>
          <PARTY_ID type="gln">7640151820015</PARTY_ID>
          <PARTY_ROLE>delivery</PARTY_ROLE>
          <ADDRESS>
            <NAME>Digitec Galaxus AG</NAME>
            <DEPARTMENT>Dock A19 - A39</DEPARTMENT>
            <STREET>Ferroring 23</STREET>
            <ZIP>5612</ZIP>
            <CITY>Villmergen</CITY>
            <COUNTRY>Schweiz</COUNTRY>
            <COUNTRY_CODED>CH</COUNTRY_CODED>
          </ADDRESS>
        </PARTY>
        <PARTY>
          <PARTY_ROLE>buyer</PARTY_ROLE>
          <ADDRESS>
            <NAME>Digitec Galaxus AG</NAME>
            <STREET>Pfingstweidstrasse 60b</STREET>
            <ZIP>8005</ZIP>
            <CITY>Zürich</CITY>
            <COUNTRY>Schweiz</COUNTRY>
            <COUNTRY_CODED>CH</COUNTRY_CODED>
          </ADDRESS>
        </PARTY>
      </PARTIES>
      <HEADER_UDX>
        <UDX.DG.DELIVERY_TYPE>warehouse_delivery</UDX.DG.DELIVERY_TYPE>
      </HEADER_UDX>
    </ORDER_INFO>
  </ORDER_HEADER>
  <ORDER_ITEM_LIST>
    <ORDER_ITEM>
      <LINE_ITEM_ID>1</LINE_ITEM_ID>
      <PRODUCT_ID>
        <SUPPLIER_PID>sku-1</SUPPLIER_PID>
        <INTERNATIONAL_PID>00012345678905</INTERNATIONAL_PID>
        <DESCRIPTION_SHORT>Shoe</DESCRIPTION_SHORT>
      </PRODUCT_ID>
      <QUANTITY>1</QUANTITY>
      <PRODUCT_PRICE_FIX>
        <PRICE_AMOUNT>10.00</PRICE_AMOUNT>
      </PRODUCT_PRICE_FIX>
      <PRICE_LINE_AMOUNT>10.00</PRICE_LINE_AMOUNT>
    </ORDER_ITEM>
  </ORDER_ITEM_LIST>
</ORDER>`;

describe("parseOrderFromXml delivery party", () => {
  it("keeps the warehouse address and stores a numeric GLN as text", () => {
    const order = parseOrderFromXml(warehouseXml, "210645477");
    expect(order.deliveryType).toBe("warehouse_delivery");
    expect(order.recipientAddress1).toBe("Ferroring 23");
    expect(order.recipientAddress2).toBe("Dock A19 - A39");
    expect(order.recipientPostalCode).toBe("5612");
    expect(order.recipientCity).toBe("Villmergen");
    expect(order.customerCity).toBe("Zürich");
    expect(order.customerAddress1).toBe("Pfingstweidstrasse 60b");
    expect(order.deliveryPartyGln).toBe("7640151820015");
  });
});
