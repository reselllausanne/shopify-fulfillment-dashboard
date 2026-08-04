import { describe, expect, it } from "vitest";
import {
  resolvePickupShipAddress,
  storeAddressAsShippingAddress,
} from "@/app/lib/pickupShipToStore";

describe("resolvePickupShipAddress", () => {
  it("returns null when not store pickup", () => {
    expect(
      resolvePickupShipAddress({
        isStorePickup: false,
        locationName: "THE LAB CONCEPT STORE",
      })
    ).toBeNull();
  });

  it("uses hardcoded Lab address over Shopify Admin", () => {
    const addr = resolvePickupShipAddress({
      isStorePickup: true,
      locationName: "THE LAB CONCEPT STORE",
      locationId: "gid://shopify/Location/111267250562",
      locationAddress: {
        address1: "Wrong Street 1",
        city: "Biel",
        zip: "2502",
        countryCode: "CH",
        country: "Switzerland",
      },
    });
    expect(addr).toEqual({
      company: "THE LAB CONCEPT",
      address1: "Rue Hans-Hugi 5",
      address2: null,
      zip: "2502",
      city: "Bienne",
      country: "Switzerland",
      countryCode: "CH",
      phone: null,
    });
  });

  it("falls back by location id when Shopify address empty (Bussigny)", () => {
    const addr = resolvePickupShipAddress({
      isStorePickup: true,
      locationName: "Warehouse Bussigny",
      locationId: "gid://shopify/Location/111267971458",
      locationAddress: {
        address1: "",
        city: "",
        zip: "",
        countryCode: "CH",
      },
    });
    expect(addr?.address1).toMatch(/Bas-de-Plan/i);
    expect(addr?.zip).toBe("1030");
    expect(addr?.city).toBe("Bussigny");
  });

  it("hardcodes Rare Bienne / Cold Bien → Maxime Schreur Sporting Bar", () => {
    const addr = resolvePickupShipAddress({
      isStorePickup: true,
      locationName: "Retrait · COLD BIEN",
    });
    expect(addr).toMatchObject({
      company: "Maxime Schreur Sporting Bar",
      address1: "Neumarktstrasse 14",
      zip: "2502",
      city: "Biel",
    });
  });

  it("hardcodes Antica → Alessio Russo La Chaux-de-Fonds", () => {
    const addr = resolvePickupShipAddress({
      isStorePickup: true,
      locationName: "Antica Bottegas",
    });
    expect(addr).toMatchObject({
      company: "Alessio Russo",
      address1: "Rue de l'arrosoir rouge 19",
      zip: "2300",
      city: "La Chaux-de-Fonds",
    });
  });
});

describe("storeAddressAsShippingAddress", () => {
  it("puts customer name on shipping name and store contact on company", () => {
    const store = resolvePickupShipAddress({
      isStorePickup: true,
      locationName: "Antica Bottegas",
    })!;
    const shipping = storeAddressAsShippingAddress(store, "Ada Lovelace");
    expect(shipping.company).toBe("Alessio Russo");
    expect(shipping.name).toBe("Ada Lovelace");
    expect(shipping.address1).toBe("Rue de l'arrosoir rouge 19");
  });
});
