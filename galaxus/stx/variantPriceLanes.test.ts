import { afterEach, describe, expect, it } from "vitest";
import { selectStxActiveOffer, selectStxStandardOffer } from "@/galaxus/stx/offerSelection";
import { buildStxDualPriceFields, isStxMarketplacePublishableDeliveryType } from "@/galaxus/stx/variantPriceLanes";

describe("selectStxStandardOffer", () => {
  it("picks cheapest standard lane", () => {
    const selected = selectStxStandardOffer([
      { type: "standard", price: 380, asks: 3 },
      { type: "standard", price: 375, asks: 21 },
      { type: "express_standard", price: 410, asks: 9 },
    ]);
    expect(selected).toEqual({ deliveryType: "standard", price: 375, asks: 21 });
  });
});

describe("selectStxActiveOffer", () => {
  it("treats express_shipped as express lane", () => {
    const selected = selectStxActiveOffer([
      { type: "standard", price: 60, asks: 227 },
      { type: "express_shipped", price: 70, asks: 116 },
      { type: "express_expedited", price: 77, asks: 1 },
    ]);
    expect(selected).toEqual({ deliveryType: "express_standard", price: 70, asks: 116 });
  });
});

describe("buildStxDualPriceFields", () => {
  const payload = { slug: "lego-lion-knights-castle-set-10305", title: "LEGO Castle" };
  const prices = [
    { type: "express_expedited", price: 410, asks: 7 },
    { type: "express_standard", price: 410, asks: 9 },
    { type: "standard", price: 375, asks: 21 },
  ];

  it("stores both lanes for LEGO with 60 inbound ship on large set", () => {
    const lanes = buildStxDualPriceFields({ prices }, payload, "LEGO Castle", {
      slug: payload.slug,
    });
    expect(lanes).not.toBeNull();
    expect(lanes!.expressBuyPrice).toBeCloseTo(513.65, 1);
    expect(lanes!.standardBuyPrice).toBeCloseTo(474.94, 1);
    expect(lanes!.price).toBe(lanes!.expressBuyPrice);
    expect(lanes!.deliveryType).toBe("express_expedited");
  });

  it("ingests standard-only sneakers (no express lane)", () => {
    const lanes = buildStxDualPriceFields(
      { prices: [{ type: "standard", price: 168, asks: 6 }] },
      { slug: "asics-gel-1130-neon-pack-pink", title: "ASICS Gel-1130" },
      "ASICS Gel-1130"
    );
    expect(lanes).not.toBeNull();
    expect(lanes!.deliveryType).toBe("standard");
    expect(lanes!.stock).toBe(6);
  });
});

describe("isStxMarketplacePublishableDeliveryType", () => {
  const prev = process.env.GALAXUS_STX_ALLOW_STANDARD_SHIPPING;

  afterEach(() => {
    if (prev === undefined) delete process.env.GALAXUS_STX_ALLOW_STANDARD_SHIPPING;
    else process.env.GALAXUS_STX_ALLOW_STANDARD_SHIPPING = prev;
  });

  it("allows express for any product", () => {
    expect(isStxMarketplacePublishableDeliveryType("express_expedited")).toBe(true);
  });

  it("allows standard sneakers by default (volume restore)", () => {
    delete process.env.GALAXUS_STX_ALLOW_STANDARD_SHIPPING;
    expect(
      isStxMarketplacePublishableDeliveryType("standard", {
        slug: "asics-gel-1130-neon-pack-pink",
        productName: "ASICS Gel-1130",
      })
    ).toBe(true);
  });

  it("blocks standard sneakers when GALAXUS_STX_ALLOW_STANDARD_SHIPPING=0", () => {
    process.env.GALAXUS_STX_ALLOW_STANDARD_SHIPPING = "0";
    expect(
      isStxMarketplacePublishableDeliveryType("standard", {
        slug: "asics-gel-1130-neon-pack-pink",
        productName: "ASICS Gel-1130",
      })
    ).toBe(false);
  });

  it("allows standard for LEGO slugs even when standard gate is off", () => {
    process.env.GALAXUS_STX_ALLOW_STANDARD_SHIPPING = "0";
    expect(
      isStxMarketplacePublishableDeliveryType("standard", {
        slug: "lego-lion-knights-castle-set-10305",
        productName: "LEGO Castle",
      })
    ).toBe(true);
  });
});
