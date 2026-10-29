import { describe, expect, it } from "vitest";
import { sizeEuFromGalaxusLine } from "@/lib/stockxAutoCheckout/galaxusBuyCandidates";

describe("sizeEuFromGalaxusLine", () => {
  it("reads line.size", () => {
    expect(sizeEuFromGalaxusLine({ size: "EU 44.5" })).toBe("44.5");
    expect(sizeEuFromGalaxusLine({ size: "44" })).toBe("44");
  });

  it("parses trailing (44.5) from product name", () => {
    expect(
      sizeEuFromGalaxusLine({ productName: "New Balance BB480LGW (44.5)" })
    ).toBe("44.5");
  });

  it("parses (EU 39)", () => {
    expect(
      sizeEuFromGalaxusLine({ productName: "Converse Run Star Hike Ox (EU 39)" })
    ).toBe("39");
  });

  it("missing → null", () => {
    expect(sizeEuFromGalaxusLine({ productName: "LEGO City Space Shuttle" })).toBeNull();
  });
});
