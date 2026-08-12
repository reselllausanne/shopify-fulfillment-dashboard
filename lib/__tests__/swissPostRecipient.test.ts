import { describe, expect, it } from "vitest";
import {
  buildSwissPostRecipient,
  buildSwissPostRecipientFromGalaxusOrder,
  buildSwissPostRecipientNameFields,
} from "@/lib/swissPostRecipient";

describe("buildSwissPostRecipientNameFields", () => {
  it("particulier: splits first/last + personallyAddressed true", () => {
    expect(
      buildSwissPostRecipientNameFields({
        personName: "Hans Muster",
        customerType: "private_customer",
      })
    ).toEqual({
      personallyAddressed: true,
      name1: "Muster",
      firstName: "Hans",
      name2: null,
      name3: null,
    });
  });

  it("particulier: uses explicit first/last", () => {
    expect(
      buildSwissPostRecipientNameFields({
        firstName: "Melanie",
        lastName: "Steiner",
        customerType: "private_customer",
      })
    ).toEqual({
      personallyAddressed: true,
      name1: "Steiner",
      firstName: "Melanie",
      name2: null,
      name3: null,
    });
  });

  it("professionnel: company first, contact in name2, personallyAddressed false", () => {
    expect(
      buildSwissPostRecipientNameFields({
        company: "Digitec Galaxus AG",
        personName: "M. Haller",
        customerType: "company",
      })
    ).toEqual({
      personallyAddressed: false,
      name1: "Digitec Galaxus AG",
      firstName: null,
      name2: "M. Haller",
      name3: null,
    });
  });

  it("professionnel: Shopify company + customer full name always on label", () => {
    expect(
      buildSwissPostRecipientNameFields({
        company: "Meier AG",
        personName: "Hans Meier",
        firstName: "Hans",
        lastName: "Meier",
      })
    ).toEqual({
      personallyAddressed: false,
      name1: "Meier AG",
      firstName: null,
      name2: "Hans Meier",
      name3: null,
    });
  });

  it("professionnel: AG heuristic without customerType", () => {
    expect(
      buildSwissPostRecipientNameFields({
        personName: "Solutions Manzinali SA",
      })
    ).toMatchObject({
      personallyAddressed: false,
      name1: "Solutions Manzinali SA",
      firstName: null,
    });
  });

  it("private_customer wins over AG-looking name", () => {
    // Rare edge: force private even if suffix present
    expect(
      buildSwissPostRecipientNameFields({
        personName: "Hans Muster",
        customerType: "private_customer",
      }).personallyAddressed
    ).toBe(true);
  });
});

describe("buildSwissPostRecipientFromGalaxusOrder", () => {
  it("company + referencePerson → business layout", () => {
    const recipient = buildSwissPostRecipientFromGalaxusOrder({
      recipientName: "Digitec Galaxus AG",
      recipientAddress1: "Ferroring 23",
      recipientPostalCode: "5612",
      recipientCity: "Villmergen",
      recipientCountryCode: "CH",
      referencePerson: "Dock A19",
      customerType: "company",
    });
    expect(recipient.personallyAddressed).toBe(false);
    expect(recipient.name1).toBe("Digitec Galaxus AG");
    expect(recipient.name2).toBe("Dock A19");
    expect(recipient.firstName).toBeNull();
    expect(recipient.street).toBe("Ferroring 23");
  });

  it("private_customer → person layout with name always present", () => {
    const recipient = buildSwissPostRecipientFromGalaxusOrder({
      recipientName: "Anna Keller",
      recipientAddress1: "Bahnhofstrasse 1",
      recipientPostalCode: "8001",
      recipientCity: "Zürich",
      recipientCountryCode: "CH",
      customerType: "private_customer",
    });
    expect(recipient.personallyAddressed).toBe(true);
    expect(recipient.firstName).toBe("Anna");
    expect(recipient.name1).toBe("Keller");
  });
});

describe("buildSwissPostRecipient", () => {
  it("keeps customer name when company set", () => {
    const recipient = buildSwissPostRecipient({
      company: "THE LAB CONCEPT",
      personName: "Jean Dupont",
      firstName: "Jean",
      lastName: "Dupont",
      address1: "Rue Example 1",
      postalCode: "1000",
      city: "Lausanne",
      countryCodeOrName: "CH",
    });
    expect(recipient.personallyAddressed).toBe(false);
    expect(recipient.name1).toBe("THE LAB CONCEPT");
    expect(recipient.name2).toBe("Jean Dupont");
  });
});
