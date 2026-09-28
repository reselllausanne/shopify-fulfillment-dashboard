import { describe, expect, it } from "vitest";
import {
  buildShippingOptions,
  hasPublishableExpress,
  EXPRESS_SERVICE,
  STANDARD_SERVICE,
} from "@/adsanalytics/explorer/deliveryShipping";

describe("buildShippingOptions", () => {
  it("always publishes a named standard service with delivery times", () => {
    const options = buildShippingOptions({ standardSell: 245, expressSell: null });
    expect(options).toHaveLength(1);
    expect(options[0]!.service).toBe(STANDARD_SERVICE);
    expect(options[0]!.country).toBe("CH");
    expect(options[0]!.price.amountMicros).toBe("0");
    // Without item-level times Google drops the delivery estimate entirely.
    expect(options[0]!.minTransitTime).toBe("3");
    expect(options[0]!.maxTransitTime).toBe("6");
  });

  it("prices express as the gap to the standard lane, per pair", () => {
    const options = buildShippingOptions({ standardSell: 245, expressSell: 274 });
    expect(options).toHaveLength(2);
    const express = options[1]!;
    expect(express.service).toBe(EXPRESS_SERVICE);
    expect(express.price.amountMicros).toBe("29000000");
    expect(express.maxTransitTime).toBe("2");
  });

  it("keeps the gap variable across pairs", () => {
    const a = buildShippingOptions({ standardSell: 200, expressSell: 215 });
    const b = buildShippingOptions({ standardSell: 800, expressSell: 905 });
    expect(a[1]!.price.amountMicros).toBe("15000000");
    expect(b[1]!.price.amountMicros).toBe("105000000");
  });

  it("omits express when the lane is gone or not dearer", () => {
    expect(buildShippingOptions({ standardSell: 245, expressSell: null })).toHaveLength(1);
    expect(buildShippingOptions({ standardSell: 245, expressSell: 245 })).toHaveLength(1);
    // Stale data used to make express look cheaper than standard.
    expect(buildShippingOptions({ standardSell: 245, expressSell: 190 })).toHaveLength(1);
  });

  it("flags whether a pair carries a publishable express option", () => {
    expect(hasPublishableExpress(buildShippingOptions({ standardSell: 245, expressSell: 274 }))).toBe(
      true
    );
    expect(hasPublishableExpress(buildShippingOptions({ standardSell: 245, expressSell: null }))).toBe(
      false
    );
  });
});
