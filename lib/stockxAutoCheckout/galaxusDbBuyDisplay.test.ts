import { describe, expect, it } from "vitest";
import { pickGalaxusDbBuyForDisplay } from "@/lib/stockxAutoCheckout/galaxusDbBuyDisplay";

describe("pickGalaxusDbBuyForDisplay", () => {
  it("1-ask express outlier: shows standard (LeBron TR 1 case)", () => {
    expect(pickGalaxusDbBuyForDisplay(105.39, 90.82, 221.38)).toEqual({ chf: 90.82, lane: "standard" });
  });

  it("Pegasus 42: express -34%, standard +7.7% → standard", () => {
    expect(pickGalaxusDbBuyForDisplay(158.37, 146.14, 212.53)).toEqual({ chf: 146.14, lane: "standard" });
  });

  it("express without loss wins over cheaper standard", () => {
    expect(pickGalaxusDbBuyForDisplay(140, 100, 130)).toEqual({ chf: 130, lane: "express" });
  });

  it("standard within 10% loss accepted", () => {
    expect(pickGalaxusDbBuyForDisplay(100, 108, 300)).toEqual({ chf: 108, lane: "standard" });
  });

  it("standard beyond loss, express within loss → express", () => {
    expect(pickGalaxusDbBuyForDisplay(100, 130, 105)).toEqual({ chf: 105, lane: "express" });
  });

  it("both beyond loss → cheapest lane", () => {
    expect(pickGalaxusDbBuyForDisplay(100, 150, 200)).toEqual({ chf: 150, lane: "standard" });
  });

  it("single lane", () => {
    expect(pickGalaxusDbBuyForDisplay(100, null, 120)).toEqual({ chf: 120, lane: "express" });
    expect(pickGalaxusDbBuyForDisplay(100, 90, null)).toEqual({ chf: 90, lane: "standard" });
    expect(pickGalaxusDbBuyForDisplay(100, null, null)).toBeNull();
  });

  it("no sell price → cheapest", () => {
    expect(pickGalaxusDbBuyForDisplay(null, 90, 200)).toEqual({ chf: 90, lane: "standard" });
  });
});
