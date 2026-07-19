import { describe, expect, it } from "vitest";
import {
  mergeLineItemCustomAttributes,
  parseShopifyLineItemDelivery,
} from "@/app/lib/shopifyLineItemDelivery";

describe("parseShopifyLineItemDelivery", () => {
  it("reads standard delivery from line item custom attributes", () => {
    const result = parseShopifyLineItemDelivery({
      customAttributes: [
        { key: "Mode d'expédition", value: "Standard" },
        { key: "Estimation livraison", value: "5 à 12 jours ouvrés" },
        { key: "_delivery", value: "standard" },
        { key: "_express_price", value: "" },
      ],
      expressAvailableMetafield: "true",
      expressPriceMetafield: '{"amount":"199.00","currency_code":"CHF"}',
    });

    expect(result.deliveryMode).toBe("standard");
    expect(result.deliveryModeLabel).toBe("Standard");
    expect(result.deliveryEstimate).toBe("5 à 12 jours ouvrés");
    expect(result.expressAvailable).toBe(true);
    expect(result.expressPrice).toBeNull();
  });

  it("reads express delivery from line item group custom attributes", () => {
    const result = parseShopifyLineItemDelivery({
      customAttributes: mergeLineItemCustomAttributes([], [
        { key: "Mode d'expédition", value: "Livraison express 2 à 5 jours ouvrés" },
        { key: "Estimation livraison", value: "2 à 5 jours ouvrés" },
        { key: "_delivery", value: "express" },
        { key: "_express_price", value: "21900" },
      ]),
    });

    expect(result.deliveryMode).toBe("express");
    expect(result.deliveryModeLabel).toBe("Livraison express 2 à 5 jours ouvrés");
    expect(result.deliveryEstimate).toBe("2 à 5 jours ouvrés");
    expect(result.expressPrice).toBe("CHF 219.00");
  });

  it("reads express delivery from hidden attribute", () => {
    const result = parseShopifyLineItemDelivery({
      customAttributes: [
        { key: "Mode d'expédition", value: "Express" },
        { key: "Estimation livraison", value: "2 à 5 jours ouvrés" },
        { key: "_delivery", value: "express" },
        { key: "_express_price", value: '{"amount":"219.00","currency_code":"CHF"}' },
      ],
    });

    expect(result.deliveryMode).toBe("express");
    expect(result.deliveryModeLabel).toBe("Express");
    expect(result.expressPrice).toBe("CHF 219.00");
  });
});
