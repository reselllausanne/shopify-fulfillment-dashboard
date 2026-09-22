import { afterEach, describe, expect, it } from "vitest";
import { selectStxActiveOffer, selectStxStandardOffer } from "@/galaxus/stx/offerSelection";
import {
  buildStxDualPriceFields,
  isOutlierStxOffer,
  isStxMarketplacePublishableDeliveryType,
  shouldPreferStandardOverExpress,
  stxProductAskMedian,
} from "@/galaxus/stx/variantPriceLanes";

describe("stxProductAskMedian", () => {
  it("takes the median across every size and lane", () => {
    expect(
      stxProductAskMedian([
        { prices: [{ type: "standard", price: 100, asks: 3 }] },
        { prices: [{ type: "standard", price: 200, asks: 3 }] },
        { prices: [{ type: "express_standard", price: 300, asks: 3 }] },
      ])
    ).toBe(200);
  });

  it("returns null when the product carries no usable ask", () => {
    expect(stxProductAskMedian([])).toBeNull();
    expect(stxProductAskMedian([{ prices: [] }])).toBeNull();
  });
});

describe("isOutlierStxOffer", () => {
  it("rejects a lone placeholder ask far above the product median", () => {
    // Supreme top parked at 542'799 CHF by a single seller.
    expect(isOutlierStxOffer({ price: 542799, asks: 1 }, 180)).toBe(true);
  });

  it("keeps a lone ask that stays close to the product median", () => {
    expect(isOutlierStxOffer({ price: 240, asks: 1 }, 180)).toBe(false);
  });

  it("keeps a genuinely expensive item when the lane is deep", () => {
    expect(isOutlierStxOffer({ price: 4000, asks: 12 }, 3800)).toBe(false);
  });

  it("still rejects anything above the absolute ceiling", () => {
    expect(isOutlierStxOffer({ price: 70000, asks: 40 }, 65000)).toBe(true);
  });

  it("does not judge a thin lane when no median is known", () => {
    expect(isOutlierStxOffer({ price: 900, asks: 1 }, null)).toBe(false);
  });
});

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

describe("shouldPreferStandardOverExpress", () => {
  it("flags express at exactly 2× standard (100% premium)", () => {
    expect(shouldPreferStandardOverExpress(424, 212, 2)).toBe(true);
  });

  it("keeps express when premium is under the ratio", () => {
    expect(shouldPreferStandardOverExpress(250, 212, 2)).toBe(false);
  });

  it("matches Hoka Clifton complaint (~5× express)", () => {
    expect(shouldPreferStandardOverExpress(1051.26, 212.53, 2)).toBe(true);
  });
});

describe("buildStxDualPriceFields — outlier asks", () => {
  it("drops a placeholder standard ask instead of publishing it", () => {
    const lanes = buildStxDualPriceFields(
      {
        prices: [
          { type: "standard", price: 63362, asks: 1 },
          { type: "express_expedited", price: 210, asks: 4 },
        ],
      },
      { slug: "nike-mercurial", title: "Nike Mercurial" },
      "Nike Mercurial",
      { productAskMedian: 200 }
    );
    expect(lanes?.standardBuyPrice).toBeNull();
    expect(lanes?.expressBuyPrice).toBeGreaterThan(0);
    expect(lanes?.deliveryType).toBe("express_expedited");
  });

  it("returns null when every lane of the variant is an outlier", () => {
    const lanes = buildStxDualPriceFields(
      { prices: [{ type: "standard", price: 542799, asks: 1 }] },
      { slug: "supreme-top", title: "Supreme Top" },
      "Supreme Top",
      { productAskMedian: 180 }
    );
    expect(lanes).toBeNull();
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

  it("falls back to standard when express ask is ≥2× standard (Hoka complaint)", () => {
    const lanes = buildStxDualPriceFields(
      {
        prices: [
          { type: "express_standard", price: 932, asks: 1 },
          { type: "standard", price: 175, asks: 12 },
        ],
      },
      { slug: "hoka-one-one-clifton-9-triple-black", title: "Hoka Clifton 9" },
      "Hoka One One Clifton 9 Triple Black"
    );
    expect(lanes).not.toBeNull();
    expect(lanes!.deliveryType).toBe("standard");
    expect(lanes!.price).toBe(lanes!.standardBuyPrice);
    expect(lanes!.expressBuyPrice).toBeGreaterThan(lanes!.standardBuyPrice! * 2);
    expect(lanes!.stock).toBe(12);
  });

  it("keeps express when premium is modest", () => {
    const lanes = buildStxDualPriceFields(
      {
        prices: [
          { type: "express_standard", price: 200, asks: 4 },
          { type: "standard", price: 175, asks: 12 },
        ],
      },
      { slug: "nike-dunk-low-panda", title: "Nike Dunk Low" },
      "Nike Dunk Low"
    );
    expect(lanes).not.toBeNull();
    expect(lanes!.deliveryType).toBe("express_standard");
    expect(lanes!.price).toBe(lanes!.expressBuyPrice);
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
