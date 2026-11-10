import { describe, expect, it } from "vitest";
import {
  describeGalaxusWarehouseShipTo,
  galaxusWarehouseShipToConflict,
  matchGalaxusWarehouseSite,
  ssccRecipientFromGalaxusOrder,
} from "./deliverySites";

describe("matchGalaxusWarehouseSite", () => {
  it("matches Wohlen by GLN when the street is not a known site", () => {
    const site = matchGalaxusWarehouseSite({
      deliveryPartyGln: "7640151820015",
      recipientAddress1: "Lagerweg 9",
      recipientPostalCode: "9999",
      recipientCity: "Somewhere",
    });
    expect(site?.key).toBe("wohlen");
  });

  it("matches Bülach by street and postal when GLN is missing", () => {
    const site = matchGalaxusWarehouseSite({
      recipientAddress1: "Schützenmattstrasse 133/137",
      recipientPostalCode: "CH-8180",
      recipientCity: "Buelach",
    });
    expect(site?.key).toBe("buelach");
  });

  it("follows the street when the GLN names the other warehouse", () => {
    const site = matchGalaxusWarehouseSite({
      deliveryPartyGln: "7640151820107",
      recipientAddress1: "Ferroring 23",
      recipientPostalCode: "5612",
      recipientCity: "Villmergen",
    });
    expect(site?.key).toBe("wohlen");
    const recipient = ssccRecipientFromGalaxusOrder({
      deliveryPartyGln: "7640151820107",
      recipientName: "Digitec Galaxus AG",
      recipientAddress1: "Ferroring 23",
      recipientAddress2: "Dock A19 - A39",
      recipientPostalCode: "5612",
      recipientCity: "Villmergen",
      recipientCountry: "Schweiz",
    });
    expect(recipient.city).toBe("Villmergen");
    expect(recipient.line2).toBe("Dock A19 - A39");
  });

  it("does not treat a Bülach end customer as the Fiege warehouse", () => {
    const site = matchGalaxusWarehouseSite({
      recipientAddress1: "Bahnhofstrasse 1",
      recipientPostalCode: "8180",
      recipientCity: "Bülach",
    });
    expect(site).toBeNull();
  });
});

describe("ssccRecipientFromGalaxusOrder", () => {
  it("prints the Villmergen dock from the order, not Bülach", () => {
    const recipient = ssccRecipientFromGalaxusOrder({
      galaxusOrderId: "210645477",
      recipientName: "Digitec Galaxus AG",
      recipientAddress1: "Ferroring 23",
      recipientAddress2: "Dock A19 - A39",
      recipientPostalCode: "5612",
      recipientCity: "Villmergen",
      recipientCountry: "Schweiz",
    });
    expect(recipient.line1).toBe("Ferroring 23");
    expect(recipient.line2).toBe("Dock A19 - A39");
    expect(recipient.postalCode).toBe("CH-5612");
    expect(recipient.city).toBe("Villmergen");
    expect(recipient.line2).not.toMatch(/Fiege/i);
  });

  it("prints Bülach and adds c/o Fiege when the order omits it", () => {
    const recipient = ssccRecipientFromGalaxusOrder({
      deliveryPartyGln: "7640151820107",
      recipientName: "Digitec Galaxus AG",
      recipientAddress1: "Schützenmattstrasse 133/137",
      recipientPostalCode: "8180",
      recipientCity: "Bülach",
      recipientCountry: "Schweiz",
    });
    expect(recipient.line1).toBe("Schützenmattstrasse 133/137");
    expect(recipient.line2).toBe("c/o Fiege Logistik Schweiz AG");
    expect(recipient.city).toBe("Bülach");
  });

  it("keeps the order care-of line instead of duplicating it", () => {
    const recipient = ssccRecipientFromGalaxusOrder({
      deliveryPartyGln: "7640151820107",
      recipientAddress1: "Schützenmattstrasse 133/137",
      recipientAddress2: "c/o Fiege Logistik Schweiz AG",
      recipientPostalCode: "8180",
      recipientCity: "Bülach",
    });
    expect(recipient.line2).toBe("c/o Fiege Logistik Schweiz AG");
  });

  it("refuses a warehouse label with no delivery address", () => {
    expect(() =>
      ssccRecipientFromGalaxusOrder({ galaxusOrderId: "1", recipientName: "Digitec Galaxus AG" })
    ).toThrow(/no delivery address/);
  });
});

describe("galaxusWarehouseShipToConflict", () => {
  const wohlen = {
    recipientAddress1: "Ferroring 23",
    recipientPostalCode: "5612",
    recipientCity: "Villmergen",
    deliveryPartyGln: "7640151820015",
  };
  const buelach = {
    recipientAddress1: "Schützenmattstrasse 133/137",
    recipientPostalCode: "8180",
    recipientCity: "Bülach",
    deliveryPartyGln: "7640151820107",
  };

  it("blocks Wohlen and Bülach in one box", () => {
    expect(galaxusWarehouseShipToConflict(wohlen, buelach)).toBe(true);
  });

  it("allows the same warehouse when only one side has a GLN yet", () => {
    expect(
      galaxusWarehouseShipToConflict(wohlen, {
        recipientAddress1: "Ferroring 23",
        recipientPostalCode: "CH-5612",
        recipientCity: "Villmergen",
      })
    ).toBe(false);
  });

  it("describes an unknown address without rewriting it", () => {
    const view = describeGalaxusWarehouseShipTo({
      recipientAddress1: "Neue Strasse 1",
      recipientPostalCode: "4000",
      recipientCity: "Basel",
    });
    expect(view.known).toBe(false);
    expect(view.label).toBe("Unknown warehouse");
    expect(view.line1).toBe("Neue Strasse 1");
    expect(view.city).toBe("Basel");
  });
});
